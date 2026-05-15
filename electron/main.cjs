const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu, Tray, nativeImage, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const sharp = require("sharp");
const Store = require("electron-store");
const update = require("./services/update.cjs");
const trash = require("./services/trash.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "sqimg",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);


const os = require("os");

// Encryption helpers for sensitive credentials
function encryptCredential(plaintext) {
  try {
    if (!plaintext) return "";
    return safeStorage.encryptString(String(plaintext)).toString("base64");
  } catch (e) {
    logEvent("WARN", "Failed to encrypt credential", { error: String(e) });
    return "";
  }
}

function decryptCredential(encrypted) {
  try {
    if (!encrypted) return "";
    return safeStorage.decryptString(Buffer.from(String(encrypted), "base64")).toString("utf-8");
  } catch (e) {
    logEvent("WARN", "Failed to decrypt credential", { error: String(e) });
    return "";
  }
}

const ROOT_DIR = path.join(os.homedir(), ".shutterqueue");
const LOG_PATH = path.join(ROOT_DIR, "activity.log");
const THUMB_CACHE_DIR = path.join(ROOT_DIR, "thumb-cache");
const PREVIEW_CACHE_DIR = path.join(ROOT_DIR, "preview-cache");
const GITHUB_REPO = "pwnicholson/shutterqueue";
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const UPDATE_CHECK_CACHE_MS = 24 * 60 * 60 * 1000;
const GROUP_COUNT_REFRESH_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function ensureRootDir() {
  if (!fs.existsSync(ROOT_DIR)) fs.mkdirSync(ROOT_DIR, { recursive: true });
}

function ensureImageCacheDirs() {
  ensureRootDir();
  if (!fs.existsSync(THUMB_CACHE_DIR)) fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
  if (!fs.existsSync(PREVIEW_CACHE_DIR)) fs.mkdirSync(PREVIEW_CACHE_DIR, { recursive: true });
}

function toSqimgUrl(filePath) {
  if (!filePath) return null;
  return `sqimg://cache?path=${encodeURIComponent(String(filePath))}`;
}

function isPathInside(parentDir, targetPath) {
  const parent = path.resolve(parentDir);
  const target = path.resolve(targetPath);
  return target === parent || target.startsWith(parent + path.sep);
}

function getPhotoCacheKey(photoPath) {
  const p = String(photoPath || "");
  const stat = fs.statSync(p);
  const payload = `${p}|${Number(stat.size)}|${Number(stat.mtimeMs)}`;
  return crypto.createHash("sha1").update(payload).digest("hex");
}

function getPhotoPathHash(photoPath) {
  const p = String(photoPath || "");
  return crypto.createHash("sha1").update(p).digest("hex").slice(0, 16);
}

function deleteScratchFilePermanently(filePath) {
  const fp = String(filePath || "");
  if (!fp) return false;
  const allowed = isPathInside(THUMB_CACHE_DIR, fp) || isPathInside(PREVIEW_CACHE_DIR, fp);
  if (!allowed) {
    logEvent("WARN", "Blocked scratch delete outside cache dirs", { filePath: fp });
    return false;
  }
  try {
    // Use filesystem deletion directly so cache cleanup never uses OS trash/recycle flows.
    fs.rmSync(fp, { force: true });
    return true;
  } catch {
    return false;
  }
}

const thumbBuildsInFlight = new Map();
const previewBuildsInFlight = new Map();
const recentPhotoAccess = new Map();

function rememberPhotoAccess(photoPath, kind, details = {}) {
  const p = String(photoPath || "").trim();
  if (!p) return null;

  const nowIso = new Date().toISOString();
  const prev = recentPhotoAccess.get(p) || {
    photoPath: p,
    accessCount: 0,
    firstAccessIso: nowIso,
    lastAccessIso: nowIso,
    lastAccessKind: "",
    lastThumbVariant: "",
    lastPreviewMaxEdge: null,
  };

  const next = {
    ...prev,
    photoPath: p,
    accessCount: Number(prev.accessCount || 0) + 1,
    lastAccessIso: nowIso,
    lastAccessKind: String(kind || ""),
  };

  if (String(kind || "") === "thumb") {
    next.lastThumbVariant = String(details?.variant || "");
  }
  if (String(kind || "") === "preview") {
    next.lastPreviewMaxEdge = Number.isFinite(Number(details?.maxEdge)) ? Number(details.maxEdge) : null;
  }

  recentPhotoAccess.set(p, next);
  if (recentPhotoAccess.size > 1000) {
    const oldestKey = recentPhotoAccess.keys().next().value;
    if (oldestKey) recentPhotoAccess.delete(oldestKey);
  }

  return next;
}

function getRecentPhotoAccess(photoPath) {
  const p = String(photoPath || "").trim();
  if (!p) return null;
  const access = recentPhotoAccess.get(p);
  if (!access) return null;
  return {
    photoPath: access.photoPath,
    accessCount: Number(access.accessCount || 0),
    firstAccessIso: String(access.firstAccessIso || ""),
    lastAccessIso: String(access.lastAccessIso || ""),
    lastAccessKind: String(access.lastAccessKind || ""),
    lastThumbVariant: String(access.lastThumbVariant || ""),
    lastPreviewMaxEdge: Number.isFinite(Number(access.lastPreviewMaxEdge)) ? Number(access.lastPreviewMaxEdge) : null,
  };
}

function deleteCacheFilesForPathHash(pathHash) {
  if (!pathHash) return 0;
  let deleted = 0;
  const dirs = [THUMB_CACHE_DIR, PREVIEW_CACHE_DIR];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (!f.startsWith(`${pathHash}-`)) continue;
        try {
          if (deleteScratchFilePermanently(path.join(dir, f))) {
            deleted++;
          }
        } catch {
          // ignore per-file errors
        }
      }
    } catch {
      // ignore dir-level errors
    }
  }
  return deleted;
}

function pruneImageCacheForRemovedItems(beforeQueue, afterQueue) {
  const before = Array.isArray(beforeQueue) ? beforeQueue : [];
  const after = Array.isArray(afterQueue) ? afterQueue : [];
  const afterPaths = new Set(after.map((it) => String(it?.photoPath || "")).filter(Boolean));

  const removedPathHashes = new Set();
  for (const it of before) {
    const p = String(it?.photoPath || "");
    if (!p || afterPaths.has(p)) continue;
    removedPathHashes.add(getPhotoPathHash(p));
  }

  let deleted = 0;
  for (const h of removedPathHashes) {
    deleted += deleteCacheFilesForPathHash(h);
  }
  if (deleted > 0 || removedPathHashes.size > 0) {
    logEventVerbose("INFO", "Pruned image cache for removed queue items", {
      removedPaths: removedPathHashes.size,
      deletedFiles: deleted,
    });
  }
}

function clearAllImageCacheFiles() {
  ensureImageCacheDirs();
  let deletedFiles = 0;
  for (const dir of [THUMB_CACHE_DIR, PREVIEW_CACHE_DIR]) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const fullPath = path.join(dir, f);
        if (deleteScratchFilePermanently(fullPath)) {
          deletedFiles++;
        }
      }
    } catch {
      // Ignore per-dir errors and continue with best-effort cleanup.
    }
  }
  return { deletedFiles };
}

async function getOrCreateThumbPath(photoPath, variant = "square") {
  const p = String(photoPath || "");
  if (!p) return null;
  rememberPhotoAccess(p, "thumb", { variant });
  ensureImageCacheDirs();
  const pathHash = getPhotoPathHash(p);
  const key = getPhotoCacheKey(p);
  const thumbVariant = String(variant || "square").trim().toLowerCase() === "wide" ? "wide" : "square";
  const outPath = path.join(THUMB_CACHE_DIR, `${pathHash}-${key}-${thumbVariant}.jpg`);
  if (fs.existsSync(outPath)) return outPath;

  const existing = thumbBuildsInFlight.get(outPath);
  if (existing) return existing;

  const work = (async () => {
    try {
      if (thumbVariant === "wide") {
        // Crop to 3:2 aspect ratio at height 72 (108×72), center-cropped
        await sharp(p, { failOn: "none" })
          .rotate()
          .resize(108, 72, { fit: "cover", position: "centre" })
          .jpeg({ quality: 84 })
          .toFile(outPath);
      } else {
        // Center-crop to square, 96×96
        await sharp(p, { failOn: "none" })
          .rotate()
          .resize(96, 96, { fit: "cover", position: "centre" })
          .jpeg({ quality: 84 })
          .toFile(outPath);
      }
      return outPath;
    } catch {
      return null;
    }
  })();

  thumbBuildsInFlight.set(outPath, work);
  try {
    return await work;
  } finally {
    thumbBuildsInFlight.delete(outPath);
  }
}

async function getOrCreatePreviewPath(photoPath, maxEdge) {
  const p = String(photoPath || "");
  if (!p) return null;
  rememberPhotoAccess(p, "preview", { maxEdge });
  ensureImageCacheDirs();
  const cap = Math.max(512, Math.min(4096, Number(maxEdge) || 2560));
  const pathHash = getPhotoPathHash(p);
  const key = getPhotoCacheKey(p);
  const outPath = path.join(PREVIEW_CACHE_DIR, `${pathHash}-${key}-e${cap}.jpg`);
  if (fs.existsSync(outPath)) return outPath;

  const existing = previewBuildsInFlight.get(outPath);
  if (existing) return existing;

  const work = (async () => {
    try {
      await sharp(p, { failOn: "none" })
        .rotate()
        .resize(cap, cap, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(outPath);
      return outPath;
    } catch {
      return null;
    }
  })();

  previewBuildsInFlight.set(outPath, work);
  try {
    return await work;
  } finally {
    previewBuildsInFlight.delete(outPath);
  }
}

function logLine(line) {
  try {
    ensureRootDir();
    fs.appendFileSync(LOG_PATH, line + "\n", "utf-8");
  } catch { /* ignore */ }
}

function logEvent(level, msg, extra) {
  const ts = new Date().toISOString();
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  logLine(`${ts} [${level}] ${msg}${suffix}`);
}

function logEventVerbose(level, msg, extra) {
  if (!store.get("verboseLogging")) return;
  logEvent(level, msg, extra);
}

// Two-tier logging helpers:
//   logMode.operational — always-on, user-facing significant events
//   logMode.diagnostic  — verbose-only, developer/debug detail
const logMode = {
  operational: (msg, extra) => logEvent("INFO", msg, extra),
  diagnostic:  (msg, extra) => logEventVerbose("DEBUG", msg, extra),
};

// Display names for platform keys used in combined success messages.
const SERVICE_DISPLAY_NAMES = {
  flickr:   "Flickr",
  tumblr:   "Tumblr",
  bluesky:  "Bluesky",
  mastodon: "Mastodon",
  pixelfed: "PixelFed",
  lemmy:    "Lemmy",
};

// Format an array of names as "A, B, and C".
function formatServiceList(names) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function logApiCallVerbose(methodName, params, result, error) {
  if (!store.get("verboseLogging")) return;
  const ts = new Date().toISOString();
  const status = error ? "ERROR" : "OK";
  const details = {
    method: methodName,
    params: typeof params === "object" ? Object.keys(params).join(", ") : String(params),
    ...(error ? { error: String(error) } : { result: typeof result === "object" ? "received object" : String(result) })
  };
  logLine(`${ts} [API ${status}] ${methodName} - ${JSON.stringify(details)}`);
}

function fetchLatestReleaseFromGitHub() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      GITHUB_LATEST_RELEASE_API,
      {
        method: "GET",
        headers: {
          "User-Agent": "ShutterQueue",
          "Accept": "application/vnd.github+json"
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += String(chunk || "");
        });
        res.on("end", () => {
          const status = Number(res.statusCode || 0);
          if (status < 200 || status >= 300) {
            reject(new Error(`GitHub API HTTP ${status}`));
            return;
          }
          try {
            const json = JSON.parse(body || "{}");
            resolve({
              tagName: String(json.tag_name || ""),
              htmlUrl: String(json.html_url || `${GITHUB_REPO_URL}/releases/latest`),
              name: String(json.name || ""),
              publishedAt: String(json.published_at || ""),
            });
          } catch (e) {
            reject(new Error(`Failed to parse GitHub release response: ${String(e)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function checkForAppUpdates({ force = false } = {}) {
  const now = Date.now();
  const currentVersion = app.getVersion();
  const cached = store.get("updateCheckCache") || null;
  if (!force && cached && Number(cached.checkedAt || 0) > 0 && (now - Number(cached.checkedAt)) < UPDATE_CHECK_CACHE_MS) {
    const cachedResult = update.deriveCachedUpdateResult(cached, currentVersion);
    if (cachedResult) {
      if (
        String(cached.currentVersion || "") !== String(cachedResult.currentVersion || "") ||
        Boolean(cached.updateAvailable) !== Boolean(cachedResult.updateAvailable)
      ) {
        store.set("updateCheckCache", { ...cachedResult, cacheHit: false });
      }
      return cachedResult;
    }
  }

  const latest = await fetchLatestReleaseFromGitHub();
  const latestVersion = String(latest.tagName || "").replace(/^v/i, "");
  const cmp = update.compareSemverLoose(currentVersion, latestVersion);
  const isUpdateAvailable = cmp < 0;

  const result = {
    ok: true,
    checkedAt: now,
    currentVersion,
    latestVersion,
    latestTag: latest.tagName,
    updateAvailable: isUpdateAvailable,
    releaseUrl: latest.htmlUrl || `${GITHUB_REPO_URL}/releases/latest`,
    releaseName: latest.name || latest.tagName || latestVersion,
    publishedAt: latest.publishedAt || "",
    cacheHit: false,
    repoUrl: GITHUB_REPO_URL,
  };
  store.set("updateCheckCache", result);
  return result;
}

const queue = require("./services/queue.cjs");
const flickr = require("./services/flickr.cjs");
const tumblr = require("./services/tumblr.cjs");
const bluesky = require("./services/bluesky.cjs");
const pixelfed = require("./services/pixelfed.cjs");
const mastodon = require("./services/mastodon.cjs");
const lemmy = require("./services/lemmy.cjs");
const geo = require("./services/geocoding.cjs");

let win = null;
let tray = null;
let isQuitting = false;
let lastTraySchedulerState = null;
let pendingFilesToOpen = []; // Files to open when the app is ready
let tumblrOAuthLoopbackServer = null;
let tumblrOAuthLoopbackCloseTimer = null;

const TUMBLR_OAUTH_LOOPBACK_HOST = "127.0.0.1";
const TUMBLR_OAUTH_LOOPBACK_CALLBACK_HOST = "localhost";
const TUMBLR_OAUTH_LOOPBACK_PORT = 38945;
const TUMBLR_OAUTH_LOOPBACK_PATH = "/tumblr/callback";
const TUMBLR_OAUTH_LOOPBACK_URL = `http://${TUMBLR_OAUTH_LOOPBACK_CALLBACK_HOST}:${TUMBLR_OAUTH_LOOPBACK_PORT}${TUMBLR_OAUTH_LOOPBACK_PATH}`;
const TUMBLR_OAUTH_LOOPBACK_MAX_MS = 10 * 60 * 1000;

let pixelfedOAuthLoopbackServer = null;
let pixelfedOAuthLoopbackCloseTimer = null;

const PIXELFED_OAUTH_LOOPBACK_HOST = "127.0.0.1";
const PIXELFED_OAUTH_LOOPBACK_PORT = 38946;
const PIXELFED_OAUTH_LOOPBACK_PATH = "/pixelfed/callback";
const PIXELFED_OAUTH_REDIRECT_URI = `http://${PIXELFED_OAUTH_LOOPBACK_HOST}:${PIXELFED_OAUTH_LOOPBACK_PORT}${PIXELFED_OAUTH_LOOPBACK_PATH}`;
const PIXELFED_OAUTH_LOOPBACK_MAX_MS = 10 * 60 * 1000;

function getAppIconPath() {
  // Full-color app icon used for window and package-level icon usage.
  return path.join(__dirname, "..", "assets", "icon.png");
}

function getTrayIconPath(active) {
  // Windows/Linux tray icon can use a tighter crop than the app icon.
  const name = active ? "icon-tray-active.png" : "icon-tray-inactive.png";
  const candidate = path.join(__dirname, "..", "assets", name);
  if (fs.existsSync(candidate)) return candidate;
  return getAppIconPath();
}

function hasPendingWork() {
  try {
    const q = queue.loadQueue?.() || [];
    for (const it of q) {
      if (!it) continue;
      if (it.status && it.status !== "done") return true;
      if (it.groupAddStates && typeof it.groupAddStates === "object") {
        const states = it.groupAddStates;
        if (Object.values(states).some((gs) => gs && (gs.status === "retry" || gs.status === "pending"))) return true;
      }
    }
  } catch (_) {
    // ignore
  }
  return false;
}

function promptForPendingWorkBeforeQuit() {
  const schedulerOn = Boolean(store.get("schedulerOn"));
  const pendingWork = hasPendingWork();
  if (!schedulerOn || !pendingWork) return "quit";

  const choice = dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
    type: "warning",
    title: "Pending Uploads",
    message: "There are still files that haven't been uploaded. Are you sure you want to quit?",
    detail: "Scheduler is currently active and there are queue items that are not done yet.",
    buttons: ["Close the app", "Minimize to Tray", "Return to App"],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  });

  if (choice === 0) return "quit";
  if (choice === 1) return "tray";
  return "return";
}

function getManualScheduleMs(item) {
  const iso = item && item.scheduledUploadAt ? String(item.scheduledUploadAt) : "";
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getDueManualScheduledPendingItem(q, nowMs) {
  let best = null;
  for (let i = 0; i < q.length; i++) {
    const it = q[i];
    if (!it || it.status !== "pending") continue;
    const scheduleMs = getManualScheduleMs(it);
    if (scheduleMs == null || scheduleMs > nowMs) continue;
    if (!best || scheduleMs < best.scheduleMs || (scheduleMs === best.scheduleMs && i < best.index)) {
      best = { item: it, index: i, scheduleMs };
    }
  }
  return best ? best.item : null;
}

function updateWindowIcon() {
  if (!win || win.isDestroyed()) return;
  const iconPath = getAppIconPath();
  try {
    // setIcon is supported on Windows/Linux. On macOS it is ignored.
    win.setIcon(iconPath);
  } catch (_) {
    // ignore
  }
}

function getMenuBarIconPath(schedulerOn) {
  const filename = schedulerOn ? "ShutterQueue-IconMenu.png" : "ShutterQueue-IconMenu-Inactive.png";
  return path.join(__dirname, "..", "assets", filename);
}

function getMenuBarImage(schedulerOn) {
  const iconPath = getMenuBarIconPath(schedulerOn);
  if (!fs.existsSync(iconPath)) return null;
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return null;
  image.setTemplateImage(true);
  return image;
}

const store = new Store({
  name: "shutterqueue",
  defaults: {
    apiKey: "",
    apiSecret: "",
    token: "",
    tokenSecret: "",
    userNsid: "",
    username: "",
    fullname: "",
    oauthTmp: null,
    tumblrApiKey: "",
    tumblrApiSecretEnc: "",
    tumblrHasApiSecret: false,
    tumblrTokenEnc: "",
    tumblrTokenSecretEnc: "",
    tumblrHasToken: false,
    tumblrOauthTmp: null,
    tumblrPendingVerifier: "",
    tumblrPendingOauthToken: "",
    tumblrUsername: "",
    tumblrPrimaryBlogId: "",
    tumblrPostTextMode: "bold_title_then_description",
    tumblrPostTimingMode: "publish_now",
    tumblrUseDescriptionAsImageDescription: true,
    tumblrBlogsCache: [],
    blueskyIdentifier: "",
    blueskyAppPasswordEnc: "",
    blueskyHasAppPassword: false,
    blueskyAccessJwtEnc: "",
    blueskyRefreshJwtEnc: "",
    blueskyDid: "",
    blueskyHandle: "",
    blueskyServiceUrl: "https://bsky.social",
    blueskyPostTextMode: "merge_title_description_tags",
    blueskyLongPostMode: "truncate",
    blueskyUseDescriptionAsAltText: true,
    blueskyImageResizeEnabled: false,
    blueskyImageResizeMaxWidth: 0,
    blueskyImageResizeMaxHeight: 0,
    pixelfedInstanceUrl: pixelfed.DEFAULT_PIXELFED_INSTANCE,
    pixelfedAccessTokenEnc: "",
    pixelfedHasAccessToken: false,
    pixelfedUsername: "",
    pixelfedPostTextMode: "merge_title_description_tags",
    pixelfedUseDescriptionAsAltText: true,
    pixelfedMastodonReshareEnabled: true,
    pixelfedImageResizeEnabled: false,
    pixelfedImageResizeMaxWidth: 0,
    pixelfedImageResizeMaxHeight: 0,
    pixelfedClientId: "",
    pixelfedClientSecretEnc: "",
    pixelfedHasClientSecret: false,
    pixelfedOauthInstanceUrl: "",
    pixelfedPendingCode: "",
    mastodonInstanceUrl: mastodon.DEFAULT_MASTODON_INSTANCE,
    mastodonAccessTokenEnc: "",
    mastodonHasAccessToken: false,
    mastodonUsername: "",
    mastodonPostTextMode: "merge_title_description_tags",
    mastodonUseDescriptionAsAltText: true,
    mastodonImageResizeEnabled: false,
    mastodonImageResizeMaxWidth: 0,
    mastodonImageResizeMaxHeight: 0,
    lemmyInstanceUrl: lemmy.DEFAULT_LEMMY_INSTANCE,
    lemmyAccessTokenEnc: "",
    lemmyHasAccessToken: false,
    lemmyUsername: "",
    lemmyPostTextMode: "merge_title_description_tags",
    lemmyImageResizeEnabled: true,
    lemmyImageResizeMaxWidth: 2000,
    lemmyImageResizeMaxHeight: 2000,
    lemmyCommunitiesCache: [],
    blueskyPrependText: "",
    blueskyAppendText: "",
    mastodonPrependText: "",
    mastodonAppendText: "",
    lemmyPrependText: "",
    lemmyAppendText: "",
    pixelfedPrependText: "",
    pixelfedAppendText: "",
    pixelfedInstanceLimitsCache: {},
    mastodonInstanceLimitsCache: {},
    lemmyInstanceLimitsCache: {},
    lemmyInstanceUploadConfigCache: {},
    tumblrPrependText: "",
    tumblrAppendText: "",
    tumblrGlobalTags: "",
    flickrGlobalTags: "",
    flickrQueueNewUploadsBehindExistingGroupQueues: false,
    intervalHours: 24,
    schedulerOn: false,
    nextRunAt: null,
    lastError: "",
    skipOvernight: false,
    timeWindowEnabled: false,
    windowStart: "07:00",
    windowEnd: "22:00",
    daysEnabled: false,
    allowedDays: [1,2,3,4,5],
    resumeOnLaunch: false,
    verboseLogging: false,
    minimizeToTray: false,
    checkUpdatesOnLaunch: true,
    useLargeThumbnails: true,
    useLargeFonts: false,
    addShutterQueueTagToAllUploads: true,
    afterUploadAction: "nothing",
    savedGroupSets: [],
    savedAlbumSets: [],
    savedTagSets: [],
    savedLemmyCommunitySets: [],
    updateCheckCache: null,
    fileDialogLastDir: "",
    queueJsonDialogDir: ""
  }
});

function getLastFileDialogDir() {
  const stored = String(store.get("fileDialogLastDir") || store.get("queueJsonDialogDir") || "").trim();
  if (stored && fs.existsSync(stored)) return stored;
  return path.join(os.homedir(), "Downloads");
}

function rememberLastFileDialogDir(filePath) {
  const fp = String(filePath || "").trim();
  if (!fp) return;
  try {
    const dir = path.dirname(fp);
    if (dir && fs.existsSync(dir)) {
      store.set("fileDialogLastDir", dir);
      store.set("queueJsonDialogDir", dir);
    }
  } catch {
    // Ignore invalid path values.
  }
}

function collectFilesRecursive(rootDir, maxFiles = 50000) {
  const out = [];
  const stack = [String(rootDir || "")];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (ent.isFile()) out.push(full);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

function isFlickrAuthed() {
  return Boolean(store.get("apiKey")) && Boolean(store.get("hasApiSecret")) && Boolean(store.get("hasToken"));
}

function isTumblrAuthed() {
  return Boolean(store.get("tumblrApiKey")) && Boolean(store.get("tumblrHasApiSecret")) && Boolean(store.get("tumblrHasToken"));
}

function isBlueskyAuthed() {
  return Boolean(store.get("blueskyIdentifier")) && Boolean(store.get("blueskyHasAppPassword")) && Boolean(store.get("blueskyAccessJwtEnc")) && Boolean(store.get("blueskyDid"));
}

function isPixelfedAuthed() {
  return Boolean(store.get("pixelfedInstanceUrl")) && Boolean(store.get("pixelfedHasAccessToken")) && Boolean(store.get("pixelfedUsername"));
}

function isMastodonAuthed() {
  return Boolean(store.get("mastodonInstanceUrl")) && Boolean(store.get("mastodonHasAccessToken")) && Boolean(store.get("mastodonUsername"));
}

function isLemmyAuthed() {
  return Boolean(store.get("lemmyInstanceUrl")) && Boolean(store.get("lemmyHasAccessToken")) && Boolean(store.get("lemmyUsername"));
}

// Returns true for HTTP 5xx, HTTP 429 rate limits, and common network-level transient failures.
// Used to decide whether to schedule an automatic retry instead of permanently failing.
function isTransientNetworkError(msg) {
  const s = String(msg || "").toLowerCase();
  if (/http 5\d\d|\bstatus[: ]+5\d\d|\b500\b|\b502\b|\b503\b|\b504\b/.test(s)) return true;
  if (/\b429\b|too.?many.?requests?|rate.?limit/.test(s)) return true;
  if (/notenoughresources|not enough resources/.test(s)) return true;
  if (/socket hang.?up|econnreset|etimedout|econnrefused|enotfound/.test(s)) return true;
  if (/connection.*reset|connection.*refused|network.*err|read econnreset/.test(s)) return true;
  return false;
}

// Lemmy transient error check delegates to the shared detector.
function isLemmyTransientError(msg) {
  return isTransientNetworkError(msg);
}

// Maximum automatic retries for transient platform errors (Tumblr, Bluesky, PixelFed, Mastodon).
const MAX_PLATFORM_AUTO_RETRIES = 5;

// Sets serviceStates[svc] to "retry" (with hourly backoff) when a transient error occurs,
// or to "failed" once MAX_PLATFORM_AUTO_RETRIES is exhausted.
function applyTransientRetry(serviceStates, svc, msg, warningParts, errorParts, itemId) {
  const displayName = { tumblr: "Tumblr", bluesky: "Bluesky", pixelfed: "PixelFed", mastodon: "Mastodon" }[svc] || svc;
  const prev = serviceStates[svc] || {};
  const retryCount = (Number(prev.retryCount) || 0) + 1;
  if (retryCount <= MAX_PLATFORM_AUTO_RETRIES) {
    const retryAfter = new Date(Date.now() + 3600000).toISOString();
    serviceStates[svc] = {
      status: "retry",
      retryAfter,
      retryCount,
      firstFailedAt: prev.firstFailedAt || new Date().toISOString(),
      lastError: msg,
    };
    warningParts.push(`${displayName}: Server temporarily unavailable — will retry automatically at ${retryAfter}. (attempt ${retryCount} of ${MAX_PLATFORM_AUTO_RETRIES})`);
    logEvent("WARN", `${displayName} upload will retry (transient error)`, { id: itemId, retryCount, error: msg });
  } else {
    serviceStates[svc] = { status: "failed", lastError: msg };
    errorParts.push(`${displayName}: ${msg}`);
    logEvent("WARN", `${displayName} upload failed after max retries`, { id: itemId, error: msg });
  }
}

// Returns true when a Lemmy upload failure looks like it was caused by the image being too large.
// Pict-rs and its reverse proxy return 502 or drop the connection when the server is overwhelmed
// processing a large file — distinct from a server that is simply down (ECONNREFUSED/ENOTFOUND)
// or rejecting the request for auth reasons (401/403).
function looksLikeLemmySizeLimitError(msg) {
  const s = String(msg || "");
  // 502 in the per-endpoint trial list = reverse proxy got no response from pict-rs (processing overload)
  if (/error code: 502|: HTTP 502/.test(s)) return true;
  // Socket hang-up on valid endpoints alongside 404s on wrong endpoints (not auth errors)
  if (/socket hang.?up/.test(s) && /HTTP 404/.test(s) && !/401|403|unauthorized|forbidden/i.test(s)) return true;
  return false;
}

const LOCATION_UNSUPPORTED_ONLY_WARNING_RE = /location data was set on this item, but none of the selected platforms support location tagging\./i;

function isLocationUnsupportedOnlyWarning(warningParts, errorParts) {
  const warnings = Array.isArray(warningParts) ? warningParts.map((w) => String(w || "").trim()).filter(Boolean) : [];
  const errors = Array.isArray(errorParts) ? errorParts.map((e) => String(e || "").trim()).filter(Boolean) : [];
  if (!warnings.length || errors.length > 0) return false;
  return warnings.every((msg) => LOCATION_UNSUPPORTED_ONLY_WARNING_RE.test(msg));
}

function getItemLemmyCommunityIds(item) {
  const fromArray = Array.isArray(item?.lemmyCommunityIds)
    ? item.lemmyCommunityIds.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const legacyCommunityId = String(item?.lemmyCommunityId || "").trim();
  return Array.from(new Set([...fromArray, ...(legacyCommunityId ? [legacyCommunityId] : [])]));
}

function getItemLemmyOriginalCommunityId(item, communityIds = getItemLemmyCommunityIds(item)) {
  const stored = String(item?.lemmyOriginalCommunityId || "").trim();
  if (stored && communityIds.includes(stored)) return stored;
  return communityIds[0] || "";
}

function isAuthed() {
  return isFlickrAuthed() || isTumblrAuthed() || isBlueskyAuthed() || isPixelfedAuthed() || isMastodonAuthed() || isLemmyAuthed();
}

// Helper to retrieve decrypted Flickr credentials for API calls
function getFlickrAuth() {
  return {
    apiKey: store.get("apiKey") || "",
    apiSecret: decryptCredential(store.get("apiSecretEnc") || ""),
    token: decryptCredential(store.get("tokenEnc") || ""),
    tokenSecret: decryptCredential(store.get("tokenSecretEnc") || ""),
    userNsid: store.get("userNsid") || "",
  };
}

function getTumblrAuth() {
  return {
    consumerKey: store.get("tumblrApiKey") || "",
    consumerSecret: decryptCredential(store.get("tumblrApiSecretEnc") || ""),
    token: decryptCredential(store.get("tumblrTokenEnc") || ""),
    tokenSecret: decryptCredential(store.get("tumblrTokenSecretEnc") || ""),
    username: store.get("tumblrUsername") || "",
    primaryBlogId: store.get("tumblrPrimaryBlogId") || "",
  };
}

function getBlueskyAuth() {
  return {
    identifier: store.get("blueskyIdentifier") || "",
    appPassword: decryptCredential(store.get("blueskyAppPasswordEnc") || ""),
    accessJwt: decryptCredential(store.get("blueskyAccessJwtEnc") || ""),
    refreshJwt: decryptCredential(store.get("blueskyRefreshJwtEnc") || ""),
    did: store.get("blueskyDid") || "",
    handle: store.get("blueskyHandle") || "",
    serviceUrl: store.get("blueskyServiceUrl") || bluesky.DEFAULT_BSKY_SERVICE,
  };
}

function getPixelfedAuth() {
  return {
    instanceUrl: String(store.get("pixelfedInstanceUrl") || pixelfed.DEFAULT_PIXELFED_INSTANCE),
    accessToken: decryptCredential(store.get("pixelfedAccessTokenEnc") || ""),
    username: String(store.get("pixelfedUsername") || ""),
  };
}

function getMastodonAuth() {
  return {
    instanceUrl: String(store.get("mastodonInstanceUrl") || mastodon.DEFAULT_MASTODON_INSTANCE),
    accessToken: decryptCredential(store.get("mastodonAccessTokenEnc") || ""),
    username: String(store.get("mastodonUsername") || ""),
  };
}

function getLemmyAuth() {
  return {
    instanceUrl: String(store.get("lemmyInstanceUrl") || lemmy.DEFAULT_LEMMY_INSTANCE),
    accessToken: decryptCredential(store.get("lemmyAccessTokenEnc") || ""),
    username: String(store.get("lemmyUsername") || ""),
  };
}

function stopTumblrOAuthLoopbackServer() {
  if (tumblrOAuthLoopbackCloseTimer) {
    clearTimeout(tumblrOAuthLoopbackCloseTimer);
    tumblrOAuthLoopbackCloseTimer = null;
  }
  if (tumblrOAuthLoopbackServer) {
    try {
      tumblrOAuthLoopbackServer.close();
    } catch {
      // ignore close errors
    }
    tumblrOAuthLoopbackServer = null;
  }
}

function startTumblrOAuthLoopbackServer() {
  stopTumblrOAuthLoopbackServer();

  tumblrOAuthLoopbackServer = http.createServer((req, res) => {
    try {
      const incomingUrl = new URL(String(req.url || "/"), `http://${TUMBLR_OAUTH_LOOPBACK_HOST}:${TUMBLR_OAUTH_LOOPBACK_PORT}`);
      if (incomingUrl.pathname !== TUMBLR_OAUTH_LOOPBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const oauthVerifier = String(incomingUrl.searchParams.get("oauth_verifier") || "").trim();
      const oauthToken = String(incomingUrl.searchParams.get("oauth_token") || "").trim();
      if (oauthVerifier) {
        store.set("tumblrPendingVerifier", oauthVerifier);
        if (oauthToken) store.set("tumblrPendingOauthToken", oauthToken);
        logEvent("INFO", "Tumblr authorization received via callback", {});
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><head><meta charset="utf-8"><title>ShutterQueue Authorization</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#0f1115;color:#e8eef7;"><h2 style="margin:0 0 10px;">Tumblr authorization received</h2><p style="margin:0;color:#aeb8c8;">You can close this tab and return to ShutterQueue.</p></body></html>`);
        return;
      }

      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>ShutterQueue Authorization</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#0f1115;color:#e8eef7;"><h2 style="margin:0 0 10px;">Authorization missing verifier</h2><p style="margin:0;color:#aeb8c8;">Return to ShutterQueue and complete authorization manually.</p></body></html>`);
    } catch (e) {
      logEvent("WARN", "Tumblr OAuth loopback callback handling failed", { error: String(e?.message || e) });
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal error");
    }
  });

  tumblrOAuthLoopbackServer.on("error", (e) => {
    logEvent("WARN", "Tumblr OAuth loopback server error", { error: String(e?.message || e) });
  });

  tumblrOAuthLoopbackServer.listen(TUMBLR_OAUTH_LOOPBACK_PORT, TUMBLR_OAUTH_LOOPBACK_HOST, () => {
    logEventVerbose("INFO", "Tumblr OAuth loopback listener started", {
      host: TUMBLR_OAUTH_LOOPBACK_HOST,
      port: TUMBLR_OAUTH_LOOPBACK_PORT,
      path: TUMBLR_OAUTH_LOOPBACK_PATH,
    });
  });

  tumblrOAuthLoopbackCloseTimer = setTimeout(() => {
    stopTumblrOAuthLoopbackServer();
  }, TUMBLR_OAUTH_LOOPBACK_MAX_MS);
}

function stopPixelfedOAuthLoopbackServer() {
  if (pixelfedOAuthLoopbackCloseTimer) {
    clearTimeout(pixelfedOAuthLoopbackCloseTimer);
    pixelfedOAuthLoopbackCloseTimer = null;
  }
  if (pixelfedOAuthLoopbackServer) {
    try {
      pixelfedOAuthLoopbackServer.close();
    } catch {
      // ignore close errors
    }
    pixelfedOAuthLoopbackServer = null;
  }
}

function startPixelfedOAuthLoopbackServer() {
  stopPixelfedOAuthLoopbackServer();
  store.set("pixelfedPendingCode", "");

  pixelfedOAuthLoopbackServer = http.createServer((req, res) => {
    try {
      const incomingUrl = new URL(String(req.url || "/"), `http://${PIXELFED_OAUTH_LOOPBACK_HOST}:${PIXELFED_OAUTH_LOOPBACK_PORT}`);
      if (incomingUrl.pathname !== PIXELFED_OAUTH_LOOPBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const code = String(incomingUrl.searchParams.get("code") || "").trim();
      if (code) {
        store.set("pixelfedPendingCode", code);
        logEventVerbose("INFO", "Captured PixelFed OAuth code from loopback callback");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><head><meta charset="utf-8"><title>ShutterQueue Authorization</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#0f1115;color:#e8eef7;"><h2 style="margin:0 0 10px;">PixelFed authorization received</h2><p style="margin:0;color:#aeb8c8;">You can close this tab and return to ShutterQueue, then click "Complete Authorization".</p></body></html>`);
        return;
      }

      const error = String(incomingUrl.searchParams.get("error") || "").trim();
      const errorDesc = String(incomingUrl.searchParams.get("error_description") || "").trim();
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>ShutterQueue Authorization</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#0f1115;color:#e8eef7;"><h2 style="margin:0 0 10px;">Authorization failed</h2><p style="margin:0;color:#aeb8c8;">${error ? `${error}: ${errorDesc}` : "No authorization code received."} Return to ShutterQueue.</p></body></html>`);
    } catch (e) {
      logEvent("WARN", "PixelFed OAuth loopback callback handling failed", { error: String(e?.message || e) });
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal error");
    }
  });

  pixelfedOAuthLoopbackServer.on("error", (e) => {
    logEvent("WARN", "PixelFed OAuth loopback server error", { error: String(e?.message || e) });
  });

  pixelfedOAuthLoopbackServer.listen(PIXELFED_OAUTH_LOOPBACK_PORT, PIXELFED_OAUTH_LOOPBACK_HOST, () => {
    logEventVerbose("INFO", "PixelFed OAuth loopback listener started", {
      host: PIXELFED_OAUTH_LOOPBACK_HOST,
      port: PIXELFED_OAUTH_LOOPBACK_PORT,
      path: PIXELFED_OAUTH_LOOPBACK_PATH,
    });
  });

  pixelfedOAuthLoopbackCloseTimer = setTimeout(() => {
    stopPixelfedOAuthLoopbackServer();
  }, PIXELFED_OAUTH_LOOPBACK_MAX_MS);
}


const GROUP_COUNTS_REFRESH_INTERVAL_MS = GROUP_COUNT_REFRESH_MAX_AGE_MS;
const GROUP_COUNTS_REFRESH_DELAY_MS = 900;
let groupCountsRefreshPromise = null;
let groupCountsRefreshState = {
  inProgress: false,
  total: 0,
  completed: 0,
  startedAt: 0,
};

function decodeHtmlEntities(input) {
  let text = String(input == null ? "" : input);
  if (!text.includes("&")) return text;

  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  for (let pass = 0; pass < 3; pass++) {
    const next = text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code) => {
      if (!code) return m;
      if (code[0] === "#") {
        const isHex = code[1]?.toLowerCase() === "x";
        const raw = isHex ? code.slice(2) : code.slice(1);
        const value = parseInt(raw, isHex ? 16 : 10);
        if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return m;
        try {
          return String.fromCodePoint(value);
        } catch {
          return m;
        }
      }
      const lower = String(code).toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : m;
    });
    if (next === text) break;
    text = next;
    if (!text.includes("&")) break;
  }

  return text;
}

function normalizeGroupNames(groups) {
  return (Array.isArray(groups) ? groups : []).map((g) => ({
    ...g,
    name: decodeHtmlEntities(g?.name || ""),
  }));
}

function hasGroupCountValue(group) {
  const members = Number(group?.memberCount || 0);
  const photos = Number(group?.photoCount || 0);
  return members > 0 || photos > 0;
}

function mergeGroupCounts(baseGroups, cachedGroups) {
  const cachedById = new Map((Array.isArray(cachedGroups) ? cachedGroups : []).map((g) => [String(g.id), g]));
  return (Array.isArray(baseGroups) ? baseGroups : []).map((g) => {
    const cached = cachedById.get(String(g.id));
    if (!cached) return g;
    return {
      ...g,
      ...(Number.isFinite(Number(cached.memberCount)) ? { memberCount: Number(cached.memberCount) } : {}),
      ...(Number.isFinite(Number(cached.photoCount)) ? { photoCount: Number(cached.photoCount) } : {}),
    };
  });
}

function startGroupCountsRefreshInBackground(groups) {
  if (groupCountsRefreshPromise) return;
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) return;

  const perGroupFetchedAt = store.get("groupCountFetchedAtById") || {};
  const fallbackFetchedAt = Number(store.get("groupsCountsFetchedAt") || 0);
  const now = Date.now();

  const needsRefresh = list.some((group) => {
    const gid = String(group?.id || "");
    if (!gid) return false;
    const countExists = hasGroupCountValue(group);
    if (!countExists) return true;
    const fetchedAt = Number(perGroupFetchedAt[gid] || fallbackFetchedAt || 0);
    if (!fetchedAt) return true;
    return (now - fetchedAt) > GROUP_COUNT_REFRESH_MAX_AGE_MS;
  });
  if (!needsRefresh) return;

  logEventVerbose("INFO", "Refreshing group sizes", { totalGroups: list.length, cacheMaxAgeDays: 14 });

  groupCountsRefreshState = {
    inProgress: true,
    total: list.length,
    completed: 0,
    startedAt: Date.now(),
  };

  groupCountsRefreshPromise = (async () => {
    try {
      const auth = getFlickrAuth();
      const updated = [];
      const fetchedAtById = { ...(store.get("groupCountFetchedAtById") || {}) };
      let refreshedCount = 0;
      let skippedFreshCount = 0;
      for (let i = 0; i < list.length; i++) {
        const group = list[i];
        const gid = String(group?.id || "");
        const countExists = hasGroupCountValue(group);
        const fetchedAt = Number(fetchedAtById[gid] || store.get("groupsCountsFetchedAt") || 0);
        const isFresh = countExists && fetchedAt > 0 && (Date.now() - fetchedAt) <= GROUP_COUNT_REFRESH_MAX_AGE_MS;

        if (isFresh) {
          updated.push({ ...group });
          groupCountsRefreshState.completed = i + 1;
          skippedFreshCount++;
          continue;
        }

        let info = {
          memberCount: Number(group?.memberCount || 0),
          photoCount: Number(group?.photoCount || 0),
        };
        try {
          info = await flickr.getGroupInfo({
            apiKey: auth.apiKey,
            apiSecret: auth.apiSecret,
            token: auth.token,
            tokenSecret: auth.tokenSecret,
            groupId: group.id,
          });
          fetchedAtById[gid] = Date.now();
          refreshedCount++;
        } catch (_) {
          // ignore per-group failures
        }

        updated.push({
          ...group,
          ...(Number.isFinite(Number(info.memberCount)) ? { memberCount: Number(info.memberCount) } : {}),
          ...(Number.isFinite(Number(info.photoCount)) ? { photoCount: Number(info.photoCount) } : {}),
        });
        groupCountsRefreshState.completed = i + 1;

        // Persist progress periodically so UI polls can pick up partial updates.
        if (i % 10 === 0 || i === list.length - 1) {
          store.set("groupsCache", updated.concat(list.slice(i + 1)));
          store.set("groupCountFetchedAtById", fetchedAtById);
        }

        if (i < list.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, GROUP_COUNTS_REFRESH_DELAY_MS));
        }
      }
      store.set("groupsCache", updated);
      store.set("groupCountFetchedAtById", fetchedAtById);
      store.set("groupsCountsFetchedAt", Date.now());
      logEventVerbose("INFO", "Group size refresh complete", {
        totalGroups: list.length,
        refreshedGroups: refreshedCount,
        skippedFreshGroups: skippedFreshCount,
      });
    } catch (e) {
      logEvent("WARN", "Background group counts refresh failed", { error: String(e) });
    } finally {
      groupCountsRefreshState = {
        ...groupCountsRefreshState,
        inProgress: false,
        completed: Math.max(groupCountsRefreshState.completed, groupCountsRefreshState.total),
      };
      groupCountsRefreshPromise = null;
    }
  })();
}

function parseHHMM(s) {
  const m = String(s || "").match(/^(\d\d):(\d\d)$/);
  if (!m) return { h: 0, min: 0 };
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const min = Math.max(0, Math.min(59, Number(m[2])));
  return { h, min };
}

function isAllowedByDays(d) {
  const enabled = Boolean(store.get("daysEnabled"));
  if (!enabled) return true;
  const allowed = store.get("allowedDays") || [];
  return Array.isArray(allowed) && allowed.includes(d.getDay());
}

function isAllowedByTimeWindow(d) {
  const enabled = Boolean(store.get("timeWindowEnabled"));
  if (!enabled) return true;
  const start = parseHHMM(store.get("windowStart") || "07:00");
  const end = parseHHMM(store.get("windowEnd") || "22:00");
  const mins = d.getHours() * 60 + d.getMinutes();
  const startM = start.h * 60 + start.min;
  const endM = end.h * 60 + end.min;
  if (startM === endM) return true; // treat as "all day"
  if (startM < endM) return mins >= startM && mins < endM;
  // overnight window (e.g., 15:00 -> 05:00)
  return mins >= startM || mins < endM;
}

function isAllowedNow(d) {
  // If time window is enabled, days are disabled per UI spec
  return isAllowedByTimeWindow(d) && isAllowedByDays(d);
}

function bumpToNextAllowed(d) {
  let cur = new Date(d);
  // hard limit to prevent infinite loops
  for (let i = 0; i < 5000; i++) {
    if (isAllowedNow(cur)) return cur;

    // If time window enabled, jump to next window start
    if (Boolean(store.get("timeWindowEnabled"))) {
      const start = parseHHMM(store.get("windowStart") || "07:00");
      const startM = start.h * 60 + start.min;
      const mins = cur.getHours() * 60 + cur.getMinutes();
      if (isAllowedByTimeWindow(cur)) {
        // within window but blocked by days (shouldn't happen because UI disables days), move 1 day
        cur.setDate(cur.getDate() + 1);
      } else {
        // move to next start boundary
        if (mins < startM) {
          cur.setHours(start.h, start.min, 0, 0);
        } else {
          cur.setDate(cur.getDate() + 1);
          cur.setHours(start.h, start.min, 0, 0);
        }
      }
      continue;
    }

    // If days enabled, advance day until allowed day; keep same time
    if (Boolean(store.get("daysEnabled"))) {
      cur.setDate(cur.getDate() + 1);
      continue;
    }

    // fallback: minute step
    cur = new Date(cur.getTime() + 60 * 1000);
  }
  return cur;
}

function isOvernightBlocked(d) {
  const h = d.getHours();
  return h >= 22 || h < 7;
}
function nextAllowedTime(fromDate) {
  const d = new Date(fromDate);
  if (!isOvernightBlocked(d)) return d;
  const out = new Date(d);
  if (out.getHours() >= 22) out.setDate(out.getDate() + 1);
  out.setHours(7, 0, 0, 0);
  return out;
}

function scheduleNext(hours) {
  const raw = new Date(Date.now() + hours * 3600 * 1000);
  // New rule system
  const bumped = bumpToNextAllowed(raw);
  // Legacy skipOvernight remains for backward compat (if user has it on, apply after bumps)
  const skip = Boolean(store.get("skipOvernight"));
  const next = skip ? nextAllowedTime(bumped) : bumped;
  store.set("nextRunAt", next.toISOString());
  return next;
}

// -----------------------------
// Group add retry logic
// -----------------------------

function nowIso() {
  return new Date().toISOString();
}

function computeNextGroupRetryAt(firstFailedAtIso, retryCount) {
  // retryCount is the number of retryable failures so far (after increment).
  // Schedule: 1h, 6h, 12h, then every 24h.
  const base = Date.now();
  const hours = retryCount === 1 ? 1 : (retryCount === 2 ? 6 : (retryCount === 3 ? 12 : 24));
  const next = new Date(base + hours * 3600 * 1000);

  // Stop retries after 7 days from first retryable failure.
  const first = firstFailedAtIso ? new Date(firstFailedAtIso).getTime() : base;
  const ageMs = base - first;
  if (ageMs >= 7 * 24 * 3600 * 1000) return null;
  return next.toISOString();
}

function normalizeGroupAddState(it) {
  if (!it.groupAddStates || typeof it.groupAddStates !== "object") it.groupAddStates = {};
  return it.groupAddStates;
}

function setItemLastErrorFromGroupStates(item, baseParts) {
  const states = item.groupAddStates || {};
  const errorParts = Array.isArray(baseParts) ? [...baseParts] : [];
  const infoParts = [];
  
  for (const [gid, st] of Object.entries(states)) {
    if (!st) continue;
    if (st.status === "retry") {
      const when = st.nextRetryAt ? formatLocal(st.nextRetryAt) : "—";
      const base = st.message || `Photo will be retried for group ${gid}.`;
      errorParts.push(`${base} Will attempt again at ${when}`);
    } else if (st.status === "gave_up") {
      errorParts.push(`Adding to group ${gid} failed for 1 week. No more retries.`);
    } else if (st.status === "failed") {
      // st.message is already user-facing.
      errorParts.push(st.message || `Group add failed for group ${gid}.`);
    } else if (st.status === "done" && st.message) {
      // Informational messages (e.g., already in pool, moderation queue) – not warnings
      infoParts.push(st.message);
    }
  }
  
  // Combine error parts and info parts, but only set done_warn if there are actual errors
  const allParts = [...errorParts, ...infoParts];
  item.lastError = allParts.join(" | ");
  
  // Only set done_warn if there are actual problems (retries, gave_up, failed)
  // Informational messages (moderation queue, already in pool) don't trigger warning status
  // Preserve group_only status — items detached from main queue but kept for group retries
  if (errorParts.length > 0 && item.status !== "group_only") {
    item.status = "done_warn";
  }
}

function formatLocal(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function interpretGroupAddError(code) {
  // Returns { status, message, retryable }
  // Based on Flickr groups.pools.add error codes.
  const c = Number(code);
  if (c === 3) return { status: "done", retryable: false, message: "Photo already in pool for group {gid}." };
  if (c === 5) return { status: "retry", retryable: true, message: "User limit reached for group {gid}. Photo will be retried." };
  if (c === 6) return { status: "done", retryable: false, message: "Photo added to group moderation queue for group {gid}." };
  if (c === 7) return { status: "done", retryable: false, message: "Photo added to group moderation queue for group {gid}." };
  if (c === 8) return { status: "failed", retryable: false, message: "Group Add Failed ({gid}): Photo doesn't meet group requirements." };
  if (c === 10) return { status: "failed", retryable: false, message: "Group Add Failed ({gid}): Group Limit Reached." };
  if (c === 11) return { status: "failed", retryable: false, message: "Group pool disabled for {gid}." };
  if (c === 105) return { status: "retry", retryable: true, message: "Flickr API problem, will retry group {gid}." };
  if (c === 106) return { status: "retry", retryable: true, message: "Flickr API problem, will retry group {gid}." };
  return { status: "failed", retryable: false, message: "Group add failed for group {gid}." };
}

async function attemptAddToGroup({ apiKey, apiSecret, token, tokenSecret, item, groupId }) {
  const photoId = item.photoId;
  const states = normalizeGroupAddState(item);
  const prev = states[groupId] || null;
  states[groupId] = prev || { status: "pending", retryCount: 0, firstFailedAt: "", nextRetryAt: "", message: "" };

  try {
    await flickr.addPhotoToGroup({ apiKey, apiSecret, token, tokenSecret, photoId, groupId });
    states[groupId] = { status: "done", message: "", retryCount: 0, firstFailedAt: "", nextRetryAt: "", lastAttemptAt: nowIso() };
    logEvent("INFO", "Added to group", { id: item.id, photoId, groupId });
    return { ok: true };
  } catch (e) {
    const code = e && e.code !== undefined ? e.code : undefined;
    const interp = interpretGroupAddError(code);
    const msg = interp.message.replaceAll("{gid}", String(groupId));

    if (interp.status === "retry") {
      const prevRetryCount = Number(prev && prev.retryCount ? prev.retryCount : 0);
      const retryCount = prevRetryCount + 1;
      const firstFailedAt = (prev && prev.firstFailedAt) ? prev.firstFailedAt : nowIso();
      const nextRetryAt = computeNextGroupRetryAt(firstFailedAt, retryCount);
      if (!nextRetryAt) {
        states[groupId] = {
          status: "gave_up",
          message: `Adding to group ${groupId} failed for 1 week. No more retries.`,
          retryCount,
          firstFailedAt,
          nextRetryAt: "",
          lastAttemptAt: nowIso(),
          code
        };
      } else {
        states[groupId] = {
          status: "retry",
          message: msg,
          retryCount,
          firstFailedAt,
          nextRetryAt,
          lastAttemptAt: nowIso(),
          code,
          retryPriority: Number.isFinite(Number(prev?.retryPriority)) ? Number(prev.retryPriority) : undefined
        };
      }
      logEvent("WARN", "Group add retry scheduled", { id: item.id, photoId, groupId, code, nextRetryAt: states[groupId].nextRetryAt });
      return { ok: false, code, message: msg, retry: true };
    }

    if (interp.status === "done") {
      // Terminal but non-error outcomes (already in pool, moderation queue)
      states[groupId] = {
        status: "done",
        message: msg,
        retryCount: 0,
        firstFailedAt: "",
        nextRetryAt: "",
        lastAttemptAt: nowIso(),
        code
      };
      logEvent("INFO", "Group add completed with info", { id: item.id, photoId, groupId, code, info: msg });
      return { ok: true, code, message: msg, info: true };
    } else {
      states[groupId] = {
        status: interp.status,
        message: msg,
        retryCount: 0,
        firstFailedAt: "",
        nextRetryAt: "",
        lastAttemptAt: nowIso(),
        code
      };
      logEvent("WARN", "Group add failed", { id: item.id, photoId, groupId, code, error: msg });
    }
    return { ok: false, code, message: msg, retry: false };
  }
}

async function processDueGroupRetries({ apiKey, apiSecret, token, tokenSecret, maxAttempts, forceDue, preserveTimerOnRejection, groupsFilter }) {
  const q = queue.loadQueue();
  let attempts = 0;
  let groupsProcessed = 0;
  let changed = false;
  const maxGroupsPerCycle = Math.max(1, Math.floor(Number(maxAttempts) || 5));
  const includeNotYetDue = Boolean(forceDue);
  const doPreserveTimer = Boolean(preserveTimerOnRejection);
  const allowedGroups = groupsFilter instanceof Set ? groupsFilter : null;
  const blockedGroupIds = new Set();

  function collectDueGroups(nowTs) {
    const dueByGroup = new Map();
    for (let idx = 0; idx < q.length; idx++) {
      const it = q[idx];
      if (!it || !it.photoId || !it.groupAddStates) continue;
      for (const [gid, st] of Object.entries(it.groupAddStates)) {
        if (blockedGroupIds.has(gid)) continue;
        if (allowedGroups && !allowedGroups.has(gid)) continue;
        if (!st || st.status !== "retry") continue;
        const due = st.nextRetryAt ? new Date(st.nextRetryAt).getTime() : 0;
        const isDue = includeNotYetDue || !due || due <= nowTs;
        if (!isDue) continue;
        const retryPriority = Number.isFinite(Number(st.retryPriority)) ? Number(st.retryPriority) : Number.MAX_SAFE_INTEGER;
        const prev = dueByGroup.get(gid);
        if (!prev) {
          dueByGroup.set(gid, { groupId: gid, due, retryPriority, queueIndex: idx });
          continue;
        }
        const better =
          (due < prev.due) ||
          (due === prev.due && retryPriority < prev.retryPriority) ||
          (due === prev.due && retryPriority === prev.retryPriority && idx < prev.queueIndex);
        if (better) {
          dueByGroup.set(gid, { groupId: gid, due, retryPriority, queueIndex: idx });
        }
      }
    }
    return Array.from(dueByGroup.values()).sort((a, b) => {
      if (a.due !== b.due) return a.due - b.due;
      if (a.retryPriority !== b.retryPriority) return a.retryPriority - b.retryPriority;
      return a.queueIndex - b.queueIndex;
    });
  }

  function pickDueCandidateForGroup(groupId, nowTs) {
    let best = null;
    for (let idx = 0; idx < q.length; idx++) {
      const it = q[idx];
      if (!it || !it.photoId || !it.groupAddStates) continue;
      const st = it.groupAddStates[groupId];
      if (!st || st.status !== "retry") continue;
      const due = st.nextRetryAt ? new Date(st.nextRetryAt).getTime() : 0;
      const isDue = includeNotYetDue || !due || due <= nowTs;
      if (!isDue) continue;
      const retryPriority = Number.isFinite(Number(st.retryPriority)) ? Number(st.retryPriority) : Number.MAX_SAFE_INTEGER;
      const cand = { item: it, queueIndex: idx, due, retryPriority, groupId };
      if (!best) {
        best = cand;
        continue;
      }
      const better =
        (cand.retryPriority < best.retryPriority) ||
        (cand.retryPriority === best.retryPriority && cand.due < best.due) ||
        (cand.retryPriority === best.retryPriority && cand.due === best.due && cand.queueIndex < best.queueIndex);
      if (better) best = cand;
    }
    return best;
  }

  while (groupsProcessed < maxGroupsPerCycle) {
    const dueGroups = collectDueGroups(Date.now());
    if (!dueGroups.length) {
      let retryStateCount = 0;
      let earliestPendingRetryAt = "";
      let earliestPendingRetryAtMs = Number.POSITIVE_INFINITY;
      if (!includeNotYetDue) {
        for (const it of q) {
          if (!it || !it.groupAddStates) continue;
          for (const st of Object.values(it.groupAddStates)) {
            if (!st || st.status !== "retry") continue;
            retryStateCount++;
            const retryMs = st.nextRetryAt ? new Date(st.nextRetryAt).getTime() : NaN;
            if (Number.isFinite(retryMs) && retryMs < earliestPendingRetryAtMs) {
              earliestPendingRetryAtMs = retryMs;
              earliestPendingRetryAt = String(st.nextRetryAt || "");
            }
          }
        }
      }
      logEventVerbose("DEBUG", "processDueGroupRetries: no due groups found", {
        forceDue,
        maxAttempts,
        queueLength: q.length,
        retryStateCount,
        earliestPendingRetryAt: earliestPendingRetryAt || null
      });
      break;
    }
    logEventVerbose("INFO", "processDueGroupRetries: attempting group retries", { dueGroupCount: dueGroups.length, forceDue });
    const activeGroupId = dueGroups[0].groupId;
    groupsProcessed++;

    let groupBlocked = false;
    let groupSuccessCount = 0;
    // Snapshot existing nextRetryAt for all items in this group, so we can restore
    // them if the very first attempt is rejected and preserveTimerOnRejection is set.
    const savedGroupTimers = new Map();
    if (doPreserveTimer) {
      for (const it of q) {
        const st = it.groupAddStates?.[activeGroupId];
        if (!st || st.status !== "retry") continue;
        savedGroupTimers.set(it.id, st.nextRetryAt);
      }
    }
    while (!groupBlocked) {
      const job = pickDueCandidateForGroup(activeGroupId, Date.now());
      if (!job) break;

      attempts++;
      await attemptAddToGroup({ apiKey, apiSecret, token, tokenSecret, item: job.item, groupId: activeGroupId });

      const attemptedState = job.item.groupAddStates?.[activeGroupId];
      if (attemptedState && attemptedState.status === "retry") {
        // A retryable rejection means this group is back in cooldown.
        if (doPreserveTimer && groupSuccessCount === 0) {
          // No successful adds yet for this group — restore saved timers so the
          // existing backoff schedule is not disrupted by a forced sweep.
          // Exception: if the saved timer is more than 24h in the future, cap it to 1h.
          const nowMs = Date.now();
          const cap24h = nowMs + 24 * 60 * 60 * 1000;
          for (const it of q) {
            const st = it.groupAddStates?.[activeGroupId];
            if (!st || st.status !== "retry") continue;
            const saved = savedGroupTimers.get(it.id);
            const savedMs = saved ? new Date(saved).getTime() : NaN;
            if (Number.isFinite(savedMs) && savedMs <= cap24h) {
              st.nextRetryAt = saved;
            } else {
              st.nextRetryAt = new Date(nowMs + 60 * 60 * 1000).toISOString();
            }
          }
          logEventVerbose("DEBUG", "Group retry: preserved existing timer (immediate rejection on forced sweep)", { groupId: activeGroupId });
        } else {
          // Keep all retrying photos aligned to the same group-level retry slot.
          const nextRetryAt = attemptedState.nextRetryAt || new Date(Date.now() + 60 * 60 * 1000).toISOString();
          for (const it of q) {
            const st = it.groupAddStates?.[activeGroupId];
            if (!st || st.status !== "retry") continue;
            st.nextRetryAt = nextRetryAt;
          }
        }
        blockedGroupIds.add(activeGroupId);
        groupBlocked = true;
      } else {
        groupSuccessCount++;
      }

      const existingNonGroupParts = String(job.item.lastError || "")
      .split("|")
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !/^user limit reached for group\s/i.test(s) && !/^adding to group\s/i.test(s) && !/^group add failed/i.test(s) && !/^photo already in pool/i.test(s) && !/^photo added to group moderation/i.test(s));
      setItemLastErrorFromGroupStates(job.item, existingNonGroupParts);
      changed = true;
    }
  }

  if (changed) {
    // Merge into latest queue to avoid resurrecting items removed by the UI while retries are processing.
    const latest = queue.loadQueue();
    const byId = new Map(latest.map((x) => [x.id, x]));
    for (const it of q) {
      const cur = byId.get(it.id);
      if (!cur) continue; // item was removed
      byId.set(it.id, it);
    }
    // Auto-remove group_only items that have no remaining retry states.
    const merged = Array.from(byId.values()).filter(it => {
      if (it.status !== "group_only") return true;
      return Object.values(it.groupAddStates || {}).some(st => st?.status === "retry");
    });
    queue.saveQueue(merged);
  }
  return { ok: true, attempts, groupsProcessed };
}

async function runImmediateGroupRetrySweep(reason) {
  if (!store.get("schedulerOn")) return;
  if (!isFlickrAuthed()) {
    logEventVerbose("DEBUG", "Immediate group retry sweep skipped (Flickr not authed)", { reason });
    return;
  }
  try {
    const auth = getFlickrAuth();
    // On launch/start/scheduler-start: attempt ALL groups regardless of due time,
    // but if a group is immediately rejected with no prior success, preserve its
    // existing timer (don't reset the backoff schedule from a forced attempt).
    await processDueGroupRetries({
      apiKey: auth.apiKey,
      apiSecret: auth.apiSecret,
      token: auth.token,
      tokenSecret: auth.tokenSecret,
      maxAttempts: 999,
      forceDue: true,
      preserveTimerOnRejection: true
    });
    logEventVerbose("INFO", "Immediate group retry sweep completed", { reason });
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    logEvent("WARN", "Immediate group retry sweep failed", { reason, error: msg });
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#0b1020",
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // When the app is packaged the JS files are bundled inside an ASAR archive.
    // __dirname will point at something like
    //   /Applications/ShutterQueue.app/Contents/Resources/app.asar/electron
    // and joining "..", "dist", "index.html" generally works, but we saw
    // a rare macOS issue where this produced a malformed path (missing the
    // "s" in "Applications") and the renderer would silently fail with
    // "Not allowed to load local resource".  The preload script fix earlier
    // used app.getAppPath(), which is more trustworthy in the packaged app,
    // so do the same for the index file.

    const indexFile = path.join(app.getAppPath(), "dist", "index.html");
    console.log("[main] loading index file", indexFile);
    win.loadFile(indexFile).catch((err) => {
      logEvent("ERROR", "Failed to load index.html", { error: String(err), path: indexFile });
    });
  }

  // Keep icon in sync (Windows/Linux). Safe no-op on macOS.
  updateWindowIcon();

  // Provide native-style edit context menu (copy/paste/etc.) for all text inputs.
  win.webContents.on("context-menu", (_event, params) => {
    const template = [];
    const canCopy = Boolean(params.selectionText);
    const canPaste = Boolean(params.isEditable);
    const misspelledWord = String(params.misspelledWord || "").trim();
    const dictionarySuggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [];

    if (params.isEditable && misspelledWord) {
      if (dictionarySuggestions.length) {
        for (const suggestion of dictionarySuggestions.slice(0, 6)) {
          template.push({
            label: String(suggestion),
            click: () => {
              try {
                win.webContents.replaceMisspelling(String(suggestion));
              } catch {
                // ignore replace failures
              }
            }
          });
        }
      } else {
        template.push({
          label: "No spelling suggestions",
          enabled: false,
        });
      }

      template.push({
        label: `Add \"${misspelledWord}\" to Dictionary`,
        click: () => {
          try {
            win.webContents.session.addWordToSpellCheckerDictionary(misspelledWord);
          } catch {
            // ignore dictionary add failures
          }
        }
      });
      template.push({ type: "separator" });
    }

    if (params.isEditable) {
      template.push(
        { label: "Undo", role: "undo", enabled: Boolean(params.editFlags?.canUndo) },
        { label: "Redo", role: "redo", enabled: Boolean(params.editFlags?.canRedo) },
        { type: "separator" },
        { label: "Cut", role: "cut", enabled: Boolean(params.editFlags?.canCut) },
        { label: "Copy", role: "copy", enabled: canCopy },
        { label: "Paste", role: "paste", enabled: canPaste },
        { label: "Delete", role: "delete", enabled: Boolean(params.editFlags?.canDelete) },
        { type: "separator" },
        { label: "Select All", role: "selectAll", enabled: Boolean(params.editFlags?.canSelectAll) }
      );
    } else if (canCopy) {
      template.push(
        { label: "Copy", role: "copy", enabled: true },
        { type: "separator" },
        { label: "Select All", role: "selectAll", enabled: true }
      );
    }

    if (!template.length) return;
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });

  // Handle window close: honor minimize-to-tray first, otherwise warn about pending scheduled work.
  win.on("close", (event) => {
    if (!isQuitting && store.get("minimizeToTray")) {
      event.preventDefault();
      win.hide();
      // Ensure tray icon exists when minimizing
      if (!tray) createTray();
      return;
    }

    if (!isQuitting) {
      const action = promptForPendingWorkBeforeQuit();
      if (action !== "quit") {
        event.preventDefault();
        if (action === "tray") {
          win.hide();
          if (!tray) createTray();
          return;
        }

        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        return;
      }
    }
  });

  // When the window finishes loading, send any pending files that were queued from command-line or "open with"
  win.webContents.on("did-finish-load", () => {
    // Small delay to ensure React app is mounted and listening for events
    setTimeout(() => {
      sendFilesToRenderer();
    }, 500);
  });

  // Keep BrowserWindow focus and renderer (webContents) focus in sync.
  // This mitigates intermittent cases where text fields stop accepting input
  // until the app is alt-tabbed away and back.
  const syncWebContentsFocus = (reason) => {
    if (!win || win.isDestroyed()) return;
    if (!win.isFocused()) return;

    const tryFocus = () => {
      if (!win || win.isDestroyed()) return;
      if (!win.isFocused()) return;
      if (win.webContents && !win.webContents.isDestroyed() && !win.webContents.isFocused()) {
        try {
          win.webContents.focus();
          logEventVerbose("DEBUG", "Re-focused renderer webContents", { reason });
        } catch (_) {
          // keep focus recovery best-effort only
        }
      }
    };

    // Try immediately and once more shortly after focus transitions settle.
    setTimeout(tryFocus, 0);
    setTimeout(tryFocus, 60);
  };

  win.on("focus", () => syncWebContentsFocus("window_focus"));
  win.on("show", () => syncWebContentsFocus("window_show"));
  win.on("restore", () => syncWebContentsFocus("window_restore"));
}

function createTray() {
  try {
    if (tray) return; // Already exists
    
    let iconPath;
    if (process.platform === "darwin") {
      const schedulerOn = !!store.get("schedulerOn");
      const menuImage = getMenuBarImage(schedulerOn);
      if (menuImage) {
        tray = new Tray(menuImage);
      } else {
        iconPath = getAppIconPath();
        tray = new Tray(iconPath);
      }
      lastTraySchedulerState = schedulerOn;
    } else {
      // Windows/Linux: use dedicated tray icon assets (active/inactive).
      iconPath = getTrayIconPath(!!store.get("schedulerOn"));
      tray = new Tray(iconPath);
    }
    
    if (!tray) return;
  } catch (err) {
    logEvent("ERROR", "Failed to create tray", { error: String(err), platform: process.platform });
    return;
  }
  
  const updateTrayMenu = () => {
    const schedulerOn = store.get("schedulerOn");
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show ShutterQueue",
        click: () => {
          if (win) {
            win.show();
            win.focus();
          } else {
            createWindow();
          }
        }
      },
      { type: "separator" },
      {
        label: schedulerOn ? "Stop Scheduler" : "Start Scheduler",
        click: async () => {
          if (schedulerOn) {
            if (schedTimer) {
              clearInterval(schedTimer);
              schedTimer = null;
            }
            store.set("schedulerOn", false);
            store.set("nextRunAt", null);
          } else {
            // Start scheduler with saved settings
            const hours = store.get("intervalHours") || 24;
            store.set("schedulerOn", true);
            if (schedTimer) clearInterval(schedTimer);
            schedTimer = setInterval(() => tickScheduler().catch(() => {}), 600000);
            runImmediateGroupRetrySweep("tray_start").catch(() => {});
          }
          updateTrayMenu();
          updateTrayIcon();
        }
      },
      { type: "separator" },
      {
        label: "Quit ShutterQueue",
        click: () => {
          const action = promptForPendingWorkBeforeQuit();
          if (action === "tray") {
            if (win && !win.isDestroyed()) {
              win.hide();
            }
            if (!tray) createTray();
            return;
          }
          if (action === "return") {
            if (win && !win.isDestroyed()) {
              win.show();
              win.focus();
            } else {
              createWindow();
            }
            return;
          }

          // Force quit without triggering minimize-to-tray.
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };
  
  updateTrayMenu();
  tray.setToolTip("ShutterQueue");
  
  // Single click shows window
  tray.on("click", () => {
    if (win) {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
        win.focus();
      }
    } else {
      createWindow();
    }
  });

  // Update menu periodically to reflect scheduler state
  setInterval(() => {
    if (tray) updateTrayMenu();
  }, 2000);
}

function updateTrayIcon() {
  if (tray) {
    const schedulerOn = !!store.get("schedulerOn");
    if (lastTraySchedulerState === schedulerOn) return;

    if (process.platform === "darwin") {
      const menuImage = getMenuBarImage(schedulerOn);
      if (menuImage) {
        tray.setImage(menuImage);
      } else {
        tray.setImage(getAppIconPath());
      }
    } else {
      const iconPath = getTrayIconPath(schedulerOn);
      tray.setImage(iconPath);
    }

    lastTraySchedulerState = schedulerOn;
  }
}


ipcMain.handle("open-third-party-licenses", async () => {
  try {
    const inAppPath = path.join(app.getAppPath(), "THIRD_PARTY_LICENSES.txt");
    const outPath = path.join(app.getPath("userData"), "THIRD_PARTY_LICENSES.txt");
    const content = fs.readFileSync(inAppPath, "utf8");
    fs.writeFileSync(outPath, content, "utf8");
    await shell.openPath(outPath);
    return { ok: true, path: outPath };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Prevent multiple instances on Windows/Linux
if (process.platform !== "darwin") {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    process.exit(0);
  }
}

// Handle files opened via "open with" or command line (macOS)
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (filePath && typeof filePath === "string") {
    pendingFilesToOpen.push(filePath);
    // If window is already open, send the files immediately
    if (win && !win.isDestroyed()) {
      sendFilesToRenderer();
    }
  }
});

// Handle files opened via command line or second instance (Windows/Linux)
app.on("second-instance", (event, commandLine, workingDirectory) => {
  // commandLine includes the app path as first arg, so skip it
  const filePaths = commandLine.slice(1).filter(arg => {
    return arg && typeof arg === "string" && !arg.startsWith("-");
  });
  
  if (filePaths.length > 0) {
    pendingFilesToOpen.push(...filePaths);
    if (win && !win.isDestroyed()) {
      sendFilesToRenderer();
    }
  }
  
  // Bring existing window to front
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Handle command-line arguments on first instance (Windows/Linux)
if (process.platform !== "darwin") {
  const args = process.argv.slice(1);
  for (const arg of args) {
    if (!arg || typeof arg !== "string") continue;
    const trimmed = String(arg).trim();
    if (!trimmed || trimmed === "." || trimmed === "./" || trimmed === ".\\") continue;
    // Skip flags (start with -)
    if (trimmed.startsWith("-")) continue;
    // Skip if it looks like an electron dev/build argument
    if (trimmed.includes("=") || trimmed.includes("@")) continue;
    // Skip the executable path itself
    if (trimmed.endsWith(".exe") || trimmed.endsWith(".js") || trimmed.includes("electron")) continue;
    // This should be a file path - add it
    // We'll let the queue handler validate if it exists and is a valid image
    pendingFilesToOpen.push(trimmed);
    console.log("[main] Command-line file to open:", trimmed);
  }
  if (pendingFilesToOpen.length > 0) {
    console.log("[main] Queued", pendingFilesToOpen.length, "file(s) from command line");
  }
}

// Send pending files to renderer
function sendFilesToRenderer() {
  if (win && !win.isDestroyed() && pendingFilesToOpen.length > 0) {
    const validFiles = [];
    const imageExtensions = /\.(jpg|jpeg|png|webp|gif|tif|tiff|heic)$/i;
    
    console.log("[main] sendFilesToRenderer: Processing", pendingFilesToOpen.length, "pending files");
    
    for (const file of pendingFilesToOpen) {
      // Validate file path
      if (file && typeof file === "string" && !file.startsWith("-")) {
        // Only accept if it looks like an image file
        if (imageExtensions.test(file)) {
          validFiles.push(file);
          console.log("[main] Valid image file:", file);
        } else {
          console.log("[main] Skipping non-image file:", file);
        }
      }
    }
    
    if (validFiles.length > 0) {
      console.log("[main] Sending", validFiles.length, "file(s) to renderer");
      win.webContents.send("app:open-files", { paths: validFiles });
      pendingFilesToOpen = []; // Clear after sending
    } else {
      console.log("[main] No valid image files to send");
    }
  } else {
    if (!win || win.isDestroyed()) {
      console.log("[main] Cannot send files: window not ready");
    } else if (pendingFilesToOpen.length === 0) {
      console.log("[main] No pending files to send");
    }
  }
}

app.whenReady().then(() => {
  // Remove default app menu (File/Edit/View...) on all platforms.
  Menu.setApplicationMenu(null);

  protocol.handle("sqimg", async (request) => {
    try {
      const url = new URL(request.url);
      const requestedPath = url.searchParams.get("path");
      if (!requestedPath) return new Response("Missing image path", { status: 400 });

      const decodedPath = decodeURIComponent(requestedPath);
      if (!fs.existsSync(decodedPath)) return new Response("Image not found", { status: 404 });

      const allowed = isPathInside(THUMB_CACHE_DIR, decodedPath) || isPathInside(PREVIEW_CACHE_DIR, decodedPath);
      if (!allowed) return new Response("Forbidden", { status: 403 });

      return net.fetch(pathToFileURL(decodedPath).toString());
    } catch (e) {
      logEvent("WARN", "sqimg protocol failed", { error: String(e) });
      return new Response("Image load failed", { status: 500 });
    }
  });

  createWindow();
  
  // Create tray if minimize-to-tray is enabled
  if (store.get("minimizeToTray")) {
    createTray();
  }
  
  // Keep icon in sync with scheduler/work state.
  setInterval(() => {
    updateWindowIcon();
  }, 2000);
  // Prevent stale group/album warnings from persisting across launches.
  // Per-item warnings live on queue items; global lastError should be reserved for fatal/authorization errors.
  const le = String(store.get("lastError") || "");
  if (/\b(group|album)\s+[^\s:]+\s*:/i.test(le)) {
    store.set("lastError", "");
  }
  if (!store.get("resumeOnLaunch")) {
    // Do not keep scheduler running across restarts unless explicitly enabled.
    store.set("schedulerOn", false);
  }
  if (store.get("resumeOnLaunch") && store.get("schedulerOn")) {
    // Resume scheduler loop
    if (schedTimer) clearInterval(schedTimer);
    schedTimer = setInterval(() => tickScheduler().catch(() => {}), 600000);
    runImmediateGroupRetrySweep("resume_on_launch").catch(() => {});
  }
  // Always run Lemmy retry processing independently of the upload scheduler.
  // Transient Lemmy failures must retry even when the user hasn't started the scheduler.
  if (lemmyRetryTimer) clearInterval(lemmyRetryTimer);
  lemmyRetryTimer = setInterval(() => processLemmyRetries().catch(() => {}), 10000);
  // Run immediately on launch in case there are already-due retries.
  processLemmyRetries().catch(() => {});
  if (transientRetryTimer) clearInterval(transientRetryTimer);
  transientRetryTimer = setInterval(() => processTransientRetries().catch(() => {}), 10000);
  processTransientRetries().catch(() => {});
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopTumblrOAuthLoopbackServer();
  // Clear global error on graceful exit (keeps errors only for crashes)
  store.set("lastError", "");
});

ipcMain.handle("shell:openExternal", async (_e, { url }) => {
  if (!url || typeof url !== "string") return { ok: false, error: "Invalid URL" };
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("app:version", async () => {
  return app.getVersion();
});

ipcMain.handle("app:checkForUpdates", async (_e, { force } = {}) => {
  try {
    const result = await checkForAppUpdates({ force: Boolean(force) });
    logEvent("INFO", "Checked for app updates", {
      force: Boolean(force),
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      updateAvailable: Boolean(result.updateAvailable),
      cacheHit: Boolean(result.cacheHit),
    });
    return result;
  } catch (e) {
    logEvent("WARN", "App update check failed", { force: Boolean(force), error: String(e?.message || e) });
    return {
      ok: false,
      checkedAt: Date.now(),
      currentVersion: app.getVersion(),
      updateAvailable: false,
      error: String(e?.message || e),
      releaseUrl: `${GITHUB_REPO_URL}/releases/latest`,
      repoUrl: GITHUB_REPO_URL,
      cacheHit: false,
    };
  }
});
ipcMain.handle("cfg:get", async () => ({
  apiKey: store.get("apiKey"),
  hasApiSecret: Boolean(store.get("hasApiSecret")),
  hasToken: Boolean(store.get("hasToken")),
  flickrAuthed: isFlickrAuthed(),
  tumblrApiKey: store.get("tumblrApiKey") || "",
  tumblrHasApiSecret: Boolean(store.get("tumblrHasApiSecret")),
  tumblrHasToken: Boolean(store.get("tumblrHasToken")),
  tumblrAuthed: isTumblrAuthed(),
  tumblrUsername: store.get("tumblrUsername") || "",
  tumblrPrimaryBlogId: store.get("tumblrPrimaryBlogId") || "",
  tumblrPostTextMode: String(store.get("tumblrPostTextMode") || "bold_title_then_description"),
  tumblrPostTimingMode: String(store.get("tumblrPostTimingMode") || "publish_now"),
  tumblrUseDescriptionAsImageDescription: store.get("tumblrUseDescriptionAsImageDescription") !== false,
  blueskyIdentifier: store.get("blueskyIdentifier") || "",
  blueskyHasAppPassword: Boolean(store.get("blueskyHasAppPassword")),
  blueskyAuthed: isBlueskyAuthed(),
  blueskyHandle: store.get("blueskyHandle") || "",
  blueskyPostTextMode: String(store.get("blueskyPostTextMode") || "merge_title_description_tags"),
  blueskyLongPostMode: String(store.get("blueskyLongPostMode") || "truncate"),
  blueskyUseDescriptionAsAltText: store.get("blueskyUseDescriptionAsAltText") !== false,
  blueskyImageResizeEnabled: Boolean(store.get("blueskyImageResizeEnabled")),
  blueskyImageResizeMaxWidth: Math.max(0, Math.round(Number(store.get("blueskyImageResizeMaxWidth") || 0))),
  blueskyImageResizeMaxHeight: Math.max(0, Math.round(Number(store.get("blueskyImageResizeMaxHeight") || 0))),
  pixelfedInstanceUrl: String(store.get("pixelfedInstanceUrl") || pixelfed.DEFAULT_PIXELFED_INSTANCE),
  pixelfedHasAccessToken: Boolean(store.get("pixelfedHasAccessToken")),
  pixelfedAuthed: isPixelfedAuthed(),
  pixelfedUsername: String(store.get("pixelfedUsername") || ""),
  pixelfedPostTextMode: String(store.get("pixelfedPostTextMode") || "merge_title_description_tags"),
  pixelfedUseDescriptionAsAltText: store.get("pixelfedUseDescriptionAsAltText") !== false,
  pixelfedMastodonReshareEnabled: store.get("pixelfedMastodonReshareEnabled") !== false,
  pixelfedImageResizeEnabled: Boolean(store.get("pixelfedImageResizeEnabled")),
  pixelfedImageResizeMaxWidth: Math.max(0, Math.round(Number(store.get("pixelfedImageResizeMaxWidth") || 0))),
  pixelfedImageResizeMaxHeight: Math.max(0, Math.round(Number(store.get("pixelfedImageResizeMaxHeight") || 0))),
  pixelfedInstanceLimitsCache: store.get("pixelfedInstanceLimitsCache") || {},
  mastodonInstanceUrl: String(store.get("mastodonInstanceUrl") || mastodon.DEFAULT_MASTODON_INSTANCE),
  mastodonHasAccessToken: Boolean(store.get("mastodonHasAccessToken")),
  mastodonAuthed: isMastodonAuthed(),
  mastodonUsername: String(store.get("mastodonUsername") || ""),
  mastodonPostTextMode: String(store.get("mastodonPostTextMode") || "merge_title_description_tags"),
  mastodonUseDescriptionAsAltText: store.get("mastodonUseDescriptionAsAltText") !== false,
  mastodonImageResizeEnabled: Boolean(store.get("mastodonImageResizeEnabled")),
  mastodonImageResizeMaxWidth: Math.max(0, Math.round(Number(store.get("mastodonImageResizeMaxWidth") || 0))),
  mastodonImageResizeMaxHeight: Math.max(0, Math.round(Number(store.get("mastodonImageResizeMaxHeight") || 0))),
  mastodonInstanceLimitsCache: store.get("mastodonInstanceLimitsCache") || {},
  lemmyInstanceUrl: String(store.get("lemmyInstanceUrl") || lemmy.DEFAULT_LEMMY_INSTANCE),
  lemmyHasAccessToken: Boolean(store.get("lemmyHasAccessToken")),
  lemmyAuthed: isLemmyAuthed(),
  lemmyUsername: String(store.get("lemmyUsername") || ""),
  lemmyPostTextMode: String(store.get("lemmyPostTextMode") || "merge_title_description_tags"),
  lemmyImageResizeEnabled: Boolean(store.get("lemmyImageResizeEnabled")),
  lemmyImageResizeMaxWidth: Math.max(0, Math.round(Number(store.get("lemmyImageResizeMaxWidth") || 0))),
  lemmyImageResizeMaxHeight: Math.max(0, Math.round(Number(store.get("lemmyImageResizeMaxHeight") || 0))),
  lemmyInstanceLimitsCache: store.get("lemmyInstanceLimitsCache") || {},
  lemmyCommunitiesCache: Array.isArray(store.get("lemmyCommunitiesCache")) ? store.get("lemmyCommunitiesCache") : [],
  blueskyPrependText: String(store.get("blueskyPrependText") || ""),
  blueskyAppendText: String(store.get("blueskyAppendText") || ""),
  mastodonPrependText: String(store.get("mastodonPrependText") || ""),
  mastodonAppendText: String(store.get("mastodonAppendText") || ""),
  lemmyPrependText: String(store.get("lemmyPrependText") || ""),
  lemmyAppendText: String(store.get("lemmyAppendText") || ""),
  pixelfedPrependText: String(store.get("pixelfedPrependText") || ""),
  pixelfedAppendText: String(store.get("pixelfedAppendText") || ""),
  tumblrPrependText: String(store.get("tumblrPrependText") || ""),
  tumblrAppendText: String(store.get("tumblrAppendText") || ""),
  tumblrGlobalTags: String(store.get("tumblrGlobalTags") || ""),
  flickrGlobalTags: String(store.get("flickrGlobalTags") || ""),
  flickrQueueNewUploadsBehindExistingGroupQueues: Boolean(store.get("flickrQueueNewUploadsBehindExistingGroupQueues")),
  authed: isAuthed(),
  username: store.get("username") || "",
  fullname: store.get("fullname") || "",
  intervalHours: store.get("intervalHours") || 24,
  schedulerOn: Boolean(store.get("schedulerOn")),
  nextRunAt: store.get("nextRunAt"),
  lastError: store.get("lastError") || "",
  skipOvernight: Boolean(store.get("skipOvernight")),
  timeWindowEnabled: Boolean(store.get("timeWindowEnabled")),
  windowStart: store.get("windowStart") || "07:00",
  windowEnd: store.get("windowEnd") || "22:00",
  daysEnabled: Boolean(store.get("daysEnabled")),
  allowedDays: store.get("allowedDays") || [1,2,3,4,5],
  resumeOnLaunch: Boolean(store.get("resumeOnLaunch")),
  uploadBatchSize: Math.max(1, Math.min(999, Math.round(Number(store.get("uploadBatchSize") || 1)))),
  verboseLogging: Boolean(store.get("verboseLogging")),
  minimizeToTray: Boolean(store.get("minimizeToTray")),
  checkUpdatesOnLaunch: Boolean(store.get("checkUpdatesOnLaunch")),
  useLargeThumbnails: Boolean(store.get("useLargeThumbnails")),
  useLargeFonts: Boolean(store.get("useLargeFonts")),
  useLightTheme: Boolean(store.get("useLightTheme")),
  addShutterQueueTagToAllUploads: store.get("addShutterQueueTagToAllUploads") !== false,
  afterUploadAction: ["nothing", "remove", "delete"].includes(String(store.get("afterUploadAction") || "")) ? String(store.get("afterUploadAction")) : "nothing",
  savedGroupSets: Array.isArray(store.get("savedGroupSets")) ? store.get("savedGroupSets") : [],
  savedAlbumSets: Array.isArray(store.get("savedAlbumSets")) ? store.get("savedAlbumSets") : [],
  savedTagSets: Array.isArray(store.get("savedTagSets")) ? store.get("savedTagSets") : [],
  savedLemmyCommunitySets: Array.isArray(store.get("savedLemmyCommunitySets")) ? store.get("savedLemmyCommunitySets") : []
}));

ipcMain.handle("cfg:setKeys", async (_e, { apiKey, apiSecret }) => {
  if (typeof apiKey === "string" && apiKey.length) store.set("apiKey", apiKey);
  // Encrypt apiSecret and store flag indicating presence
  if (typeof apiSecret === "string" && apiSecret.trim().length) {
    const encrypted = encryptCredential(apiSecret.trim());
    store.set("apiSecretEnc", encrypted);
    store.set("hasApiSecret", true);
  }
  return { ok: true };
});

ipcMain.handle("cfg:setTumblrKeys", async (_e, { consumerKey, consumerSecret }) => {
  if (typeof consumerKey === "string" && consumerKey.length) store.set("tumblrApiKey", consumerKey);
  if (typeof consumerSecret === "string" && consumerSecret.trim().length) {
    const encrypted = encryptCredential(consumerSecret.trim());
    store.set("tumblrApiSecretEnc", encrypted);
    store.set("tumblrHasApiSecret", true);
  }
  return { ok: true };
});

ipcMain.handle("cfg:setBlueskyCredentials", async (_e, { identifier, appPassword }) => {
  if (typeof identifier === "string" && identifier.trim().length) {
    store.set("blueskyIdentifier", identifier.trim());
  }
  if (typeof appPassword === "string" && appPassword.trim().length) {
    const encrypted = encryptCredential(appPassword.trim());
    store.set("blueskyAppPasswordEnc", encrypted);
    store.set("blueskyHasAppPassword", true);
  }
  return { ok: true };
});

ipcMain.handle("cfg:setPixelfedCredentials", async (_e, { instanceUrl, accessToken }) => {
  if (typeof instanceUrl === "string" && instanceUrl.trim().length) {
    store.set("pixelfedInstanceUrl", pixelfed.normalizeInstanceUrl(instanceUrl.trim()));
  }
  if (typeof accessToken === "string" && accessToken.trim().length) {
    const encrypted = encryptCredential(accessToken.trim());
    store.set("pixelfedAccessTokenEnc", encrypted);
    store.set("pixelfedHasAccessToken", true);
    // Force re-verification with new token.
    store.set("pixelfedUsername", "");
  }
  return { ok: true };
});

ipcMain.handle("cfg:setMastodonCredentials", async (_e, { instanceUrl, accessToken }) => {
  if (typeof instanceUrl === "string" && instanceUrl.trim().length) {
    store.set("mastodonInstanceUrl", mastodon.normalizeInstanceUrl(instanceUrl.trim()));
  }
  if (typeof accessToken === "string" && accessToken.trim().length) {
    const encrypted = encryptCredential(accessToken.trim());
    store.set("mastodonAccessTokenEnc", encrypted);
    store.set("mastodonHasAccessToken", true);
    // Force re-verification with new token.
    store.set("mastodonUsername", "");
  }
  return { ok: true };
});

ipcMain.handle("cfg:setLemmyCredentials", async (_e, { instanceUrl, accessToken }) => {
  if (typeof instanceUrl === "string" && instanceUrl.trim().length) {
    store.set("lemmyInstanceUrl", lemmy.normalizeInstanceUrl(instanceUrl.trim()));
  }
  if (typeof accessToken === "string" && accessToken.trim().length) {
    const encrypted = encryptCredential(accessToken.trim());
    store.set("lemmyAccessTokenEnc", encrypted);
    store.set("lemmyHasAccessToken", true);
    // Force re-verification and refetch communities with new token.
    store.set("lemmyUsername", "");
    store.set("lemmyCommunitiesCache", []);
  }
  return { ok: true };
});


ipcMain.handle("cfg:setUploadBatchSize", async (_e, { uploadBatchSize }) => {
  const v = Math.max(1, Math.min(999, Math.round(Number(uploadBatchSize || 1))));
  store.set("uploadBatchSize", v);
  return { ok: true, uploadBatchSize: v };
});

ipcMain.handle("cfg:setSchedulerSettings", async (_e, payload) => {
  const out = {};
  // intervalHours: 1–168
  if (payload && Object.prototype.hasOwnProperty.call(payload, "intervalHours")) {
    const h = Math.max(1, Math.min(168, Math.round(Number(payload.intervalHours || 24))));
    store.set("intervalHours", h);
    out.intervalHours = h;
  }

  // uploadBatchSize: 1–999
  if (payload && Object.prototype.hasOwnProperty.call(payload, "uploadBatchSize")) {
    const v = Math.max(1, Math.min(999, Math.round(Number(payload.uploadBatchSize || 1))));
    store.set("uploadBatchSize", v);
    out.uploadBatchSize = v;
  }

  // resumeOnLaunch
  if (payload && Object.prototype.hasOwnProperty.call(payload, "resumeOnLaunch")) {
    const v = Boolean(payload.resumeOnLaunch);
    store.set("resumeOnLaunch", v);
    out.resumeOnLaunch = v;
    if (!v) {
      // If user disables resume-on-launch, scheduler must not remain "on" across restarts.
      store.set("schedulerOn", false);
      out.schedulerOn = false;
    }
  }

  // time window settings
  if (payload && Object.prototype.hasOwnProperty.call(payload, "timeWindowEnabled")) {
    const v = Boolean(payload.timeWindowEnabled);
    store.set("timeWindowEnabled", v);
    out.timeWindowEnabled = v;
    // mutual exclusion is handled in UI, but keep store sane if both get set
    if (v) {
      store.set("daysEnabled", false);
      out.daysEnabled = false;
    }
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, "windowStart")) {
    const v = String(payload.windowStart || "07:00");
    store.set("windowStart", v);
    out.windowStart = v;
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, "windowEnd")) {
    const v = String(payload.windowEnd || "22:00");
    store.set("windowEnd", v);
    out.windowEnd = v;
  }

  // day-of-week settings
  if (payload && Object.prototype.hasOwnProperty.call(payload, "daysEnabled")) {
    const v = Boolean(payload.daysEnabled);
    store.set("daysEnabled", v);
    out.daysEnabled = v;
    if (v) {
      store.set("timeWindowEnabled", false);
      out.timeWindowEnabled = false;
    }
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, "allowedDays")) {
    const a = Array.isArray(payload.allowedDays) ? payload.allowedDays : [1,2,3,4,5];
    // sanitize: integers 0–6, unique
    const uniq = [];
    for (const x of a) {
      const n = Number(x);
      if (!Number.isFinite(n)) continue;
      const i = Math.max(0, Math.min(6, Math.trunc(n)));
      if (!uniq.includes(i)) uniq.push(i);
    }
    const v = uniq.length ? uniq : [1,2,3,4,5];
    store.set("allowedDays", v);
    out.allowedDays = v;
  }

  return { ok: true, updated: out };
});

ipcMain.handle("cfg:setSavedSets", async (_e, payload) => {
  const kind = ["album", "tag", "lemmy_community"].includes(payload?.kind) ? payload.kind : "group";
  const key = kind === "group"
    ? "savedGroupSets"
    : kind === "album"
      ? "savedAlbumSets"
      : kind === "tag"
        ? "savedTagSets"
        : "savedLemmyCommunitySets";
  const incoming = Array.isArray(payload?.sets) ? payload.sets : [];
  const out = [];
  const seen = new Set();
  for (const raw of incoming) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const ids = Array.isArray(raw?.ids)
      ? Array.from(new Set(raw.ids.map((x) => String(x)).filter(Boolean)))
      : [];
    out.push({ name, ids });
  }
  out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  store.set(key, out);
  return { ok: true, kind, sets: out };
});



ipcMain.handle("oauth:start", async () => {
  const apiKey = store.get("apiKey");
  const apiSecret = decryptCredential(store.get("apiSecretEnc") || "");
  if (!apiKey || !apiSecret) throw new Error("Missing API key/secret");

  const tmp = await flickr.getRequestToken(apiKey, apiSecret);
  store.set("oauthTmp", tmp);
  const url = flickr.getAuthorizeUrl(tmp.oauthToken);
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("tumblr:oauth:start", async () => {
  const consumerKey = store.get("tumblrApiKey") || "";
  const consumerSecret = decryptCredential(store.get("tumblrApiSecretEnc") || "");
  if (!consumerKey || !consumerSecret) throw new Error("Missing Tumblr API key/secret");

  store.set("tumblrPendingVerifier", "");
  store.set("tumblrPendingOauthToken", "");
  startTumblrOAuthLoopbackServer();
  try {
    const tmp = await tumblr.getRequestToken(consumerKey, consumerSecret, {
      callbackUrl: TUMBLR_OAUTH_LOOPBACK_URL,
    });
    store.set("tumblrOauthTmp", tmp);
    const url = tumblr.getAuthorizeUrl(tmp.oauthToken);
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    stopTumblrOAuthLoopbackServer();
    throw e;
  }
});

ipcMain.handle("tumblr:oauth:consumeVerifier", async () => {
  const verifier = String(store.get("tumblrPendingVerifier") || "").trim();
  const oauthToken = String(store.get("tumblrPendingOauthToken") || "").trim();
  store.set("tumblrPendingVerifier", "");
  store.set("tumblrPendingOauthToken", "");
  return { verifier, oauthToken };
});

ipcMain.handle("tumblr:oauth:finish", async (_e, { verifier }) => {
  const consumerKey = store.get("tumblrApiKey") || "";
  const consumerSecret = decryptCredential(store.get("tumblrApiSecretEnc") || "");
  const tmp = store.get("tumblrOauthTmp");
  if (!tmp) throw new Error("No Tumblr OAuth session. Click Start Authorization first.");

  const tok = await tumblr.getAccessToken(
    consumerKey,
    consumerSecret,
    tmp.oauthToken,
    tmp.oauthTokenSecret,
    verifier
  );

  store.set("tumblrTokenEnc", encryptCredential(tok.token));
  store.set("tumblrTokenSecretEnc", encryptCredential(tok.tokenSecret));
  store.set("tumblrHasToken", true);
  store.set("tumblrUsername", tok.name || "");
  store.set("tumblrOauthTmp", null);
  store.set("tumblrPendingVerifier", "");
  store.set("tumblrPendingOauthToken", "");
  stopTumblrOAuthLoopbackServer();

  try {
    const blogs = await tumblr.listBlogs({
      consumerKey,
      consumerSecret,
      token: tok.token,
      tokenSecret: tok.tokenSecret,
    });
    store.set("tumblrBlogsCache", blogs);
    if (!store.get("tumblrPrimaryBlogId") && blogs.length) {
      store.set("tumblrPrimaryBlogId", blogs[0].id);
    }
  } catch (e) {
    logEvent("WARN", "Tumblr authorized but blog fetch failed", { error: String(e?.message || e) });
  }

  store.set("lastError", "");
  return { ok: true };
});

ipcMain.handle("tumblr:oauth:logout", async () => {
  store.set("tumblrTokenEnc", "");
  store.set("tumblrTokenSecretEnc", "");
  store.set("tumblrHasToken", false);
  store.set("tumblrOauthTmp", null);
  store.set("tumblrUsername", "");
  store.set("tumblrBlogsCache", []);
  store.set("tumblrPrimaryBlogId", "");
  store.set("tumblrPendingVerifier", "");
  store.set("tumblrPendingOauthToken", "");
  stopTumblrOAuthLoopbackServer();
  store.set("lastError", "");
  return { ok: true };
});

ipcMain.handle("tumblr:blogs", async (_e, { force } = {}) => {
  if (!isTumblrAuthed()) throw new Error("Tumblr is not authorized");
  const cached = store.get("tumblrBlogsCache") || [];
  if (!force && Array.isArray(cached) && cached.length) return cached;

  const auth = getTumblrAuth();
  const blogs = await tumblr.listBlogs({
    consumerKey: auth.consumerKey,
    consumerSecret: auth.consumerSecret,
    token: auth.token,
    tokenSecret: auth.tokenSecret,
  });
  store.set("tumblrBlogsCache", blogs);
  const selectedBlogId = String(store.get("tumblrPrimaryBlogId") || "");
  if (!selectedBlogId || !blogs.some((b) => String(b.id) === selectedBlogId)) {
    store.set("tumblrPrimaryBlogId", blogs[0]?.id || "");
  }
  return blogs;
});

ipcMain.handle("tumblr:setPrimaryBlog", async (_e, { blogId }) => {
  const clean = String(blogId || "").trim();
  store.set("tumblrPrimaryBlogId", clean);
  return { ok: true, blogId: clean };
});

ipcMain.handle("oauth:finish", async (_e, { verifier }) => {
  const apiKey = store.get("apiKey");
  const apiSecret = decryptCredential(store.get("apiSecretEnc") || "");
  const tmp = store.get("oauthTmp");
  if (!tmp) throw new Error("No OAuth session. Click Start Authorization first.");
  const tok = await flickr.getAccessToken(apiKey, apiSecret, tmp.oauthToken, tmp.oauthTokenSecret, verifier);
  store.set("tokenEnc", encryptCredential(tok.token));
  store.set("tokenSecretEnc", encryptCredential(tok.tokenSecret));
  store.set("hasToken", true);
  store.set("userNsid", tok.userNsid);
  store.set("username", tok.username);
  store.set("fullname", tok.fullname);
  store.set("oauthTmp", null);
  store.set("lastError", "");
  return { ok: true };
});

ipcMain.handle("oauth:logout", async () => {
  store.set("tokenEnc", "");
  store.set("tokenSecretEnc", "");
  store.set("hasToken", false);
  store.set("userNsid", "");
  store.set("username", "");
  store.set("fullname", "");
  store.set("oauthTmp", null);
  store.set("lastError", "");
  return { ok: true };
});

ipcMain.handle("flickr:groups", async (_e, opts = {}) => {
  if (!isFlickrAuthed()) throw new Error("Flickr is not authorized");
  const auth = getFlickrAuth();
  const force = Boolean(opts && opts.force);
  try {
    const cachedGroupsRaw = store.get("groupsCache") || [];
    const cachedGroups = normalizeGroupNames(cachedGroupsRaw);
    if (JSON.stringify(cachedGroupsRaw) !== JSON.stringify(cachedGroups)) {
      store.set("groupsCache", cachedGroups);
    }
    const countsFetchedAt = Number(store.get("groupsCountsFetchedAt") || 0);
    const countsStale = !countsFetchedAt || (Date.now() - countsFetchedAt) > GROUP_COUNTS_REFRESH_INTERVAL_MS;

    if (!force && Array.isArray(cachedGroups) && cachedGroups.length) {
      if (countsStale) {
        startGroupCountsRefreshInBackground(cachedGroups);
      }
      logApiCallVerbose("flickr.groups.pools.getGroups", { cache: true }, cachedGroups);
      return cachedGroups;
    }

    const baseGroups = await flickr.listGroups({
      apiKey: auth.apiKey,
      apiSecret: auth.apiSecret,
      token: auth.token,
      tokenSecret: auth.tokenSecret,
    });

    const merged = normalizeGroupNames(mergeGroupCounts(baseGroups, cachedGroups));
    store.set("groupsCache", merged);
    store.set("groupsListFetchedAt", Date.now());

    startGroupCountsRefreshInBackground(merged);

    logApiCallVerbose("flickr.groups.pools.getGroups", { cache: false }, merged);
    logEventVerbose("INFO", "Loaded groups list", { source: "flickr", count: merged.length, forceRefresh: force });
    return merged;
  } catch (e) {
    logApiCallVerbose("flickr.groups.pools.getGroups", { cache: false }, null, e);
    logEvent("WARN", "Failed to load groups list", { forceRefresh: force, error: String(e?.message || e) });
    throw e;
  }
});

ipcMain.handle("flickr:groupsRefreshStatus", async () => {
  return {
    inProgress: Boolean(groupCountsRefreshState.inProgress),
    total: Number(groupCountsRefreshState.total || 0),
    completed: Number(groupCountsRefreshState.completed || 0),
    startedAt: Number(groupCountsRefreshState.startedAt || 0),
  };
});

ipcMain.handle("flickr:groupInfo", async (_e, { groupId } = {}) => {
  if (!isFlickrAuthed()) throw new Error("Flickr is not authorized");
  const id = String(groupId || "").trim();
  if (!id) throw new Error("Missing group id");

  const auth = getFlickrAuth();
  try {
    const result = await flickr.getGroupInfo({
      apiKey: auth.apiKey,
      apiSecret: auth.apiSecret,
      token: auth.token,
      tokenSecret: auth.tokenSecret,
      groupId: id,
    });
    logApiCallVerbose("flickr.groups.getInfo", { groupId: id }, result);
    return result;
  } catch (e) {
    logApiCallVerbose("flickr.groups.getInfo", { groupId: id }, null, e);
    throw e;
  }
});

ipcMain.handle("flickr:albums", async () => {
  if (!isFlickrAuthed()) throw new Error("Flickr is not authorized");
  const auth = getFlickrAuth();
  try {
    const result = await flickr.listAlbums({
      apiKey: auth.apiKey,
      apiSecret: auth.apiSecret,
      token: auth.token,
      tokenSecret: auth.tokenSecret,
      userNsid: auth.userNsid,
    });
    const reconcileResult = await reconcileQueuedCreateAlbumsAgainstExisting({ auth });
    if (Number(reconcileResult?.updatedItems || 0) > 0) {
      logEvent("INFO", "Reconciled queued create-album titles to existing albums", {
        updatedItems: Number(reconcileResult.updatedItems || 0),
        matchedTitles: Number(reconcileResult.matchedTitles || 0),
      });
    }
    logApiCallVerbose("flickr.photosets.getList", {}, result);
    logEventVerbose("INFO", "Loaded albums list", { count: Array.isArray(result) ? result.length : 0 });
    return result;
  } catch (e) {
    logApiCallVerbose("flickr.photosets.getList", {}, null, e);
    logEvent("WARN", "Failed to load albums list", { error: String(e?.message || e) });
    throw e;
  }
});
ipcMain.handle("flickr:photoUrls", async (_e, { photoId }) => {
  if (!isFlickrAuthed()) throw new Error("Flickr is not authorized");
  if (!photoId) return { thumbUrl: "", previewUrl: "" };

  const cache = store.get("photoUrlCache") || {};
  const cached = cache[photoId];
  if (cached && cached.thumbUrl && cached.previewUrl) return cached;

  const auth = getFlickrAuth();
  const urls = await flickr.getPhotoUrls({
    apiKey: auth.apiKey,
    apiSecret: auth.apiSecret,
    token: auth.token,
    tokenSecret: auth.tokenSecret,
    photoId
  });

  const compact = { thumbUrl: urls.thumbUrl || "", previewUrl: urls.previewUrl || "" };
  cache[photoId] = compact;
  store.set("photoUrlCache", cache);
  return compact;
});


ipcMain.handle("thumb:getSrc", async (_e, { photoPath, variant }) => {
  try {
    return toSqimgUrl(await getOrCreateThumbPath(photoPath, variant));
  } catch {
    return null;
  }
});

ipcMain.handle("image:getPreviewSrc", async (_e, { photoPath, maxEdge }) => {
  try {
    return toSqimgUrl(await getOrCreatePreviewPath(photoPath, maxEdge));
  } catch {
    return null;
  }
});

ipcMain.handle("cache:clearImageCache", async () => {
  try {
    const result = clearAllImageCacheFiles();
    logEventVerbose("INFO", "Cleared image cache files", result);
    return { ok: true, ...result };
  } catch (e) {
    logEventVerbose("ERROR", "Failed to clear image cache files", { error: String(e) });
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("queue:get", async () => queue.loadQueue());
ipcMain.handle("queue:add", async (_e, { paths }) => {
  const list = Array.isArray(paths) ? paths : [];
  const out = await queue.addPaths(list);
  logEvent("INFO", "Added items to queue", { requested: list.length, queueSize: Array.isArray(out) ? out.length : 0 });
  return out;
});
ipcMain.handle("queue:remove", async (_e, { ids }) => {
  const list = Array.isArray(ids) ? ids : [];
  const before = queue.loadQueue();
  const out = await queue.removeIds(list);
  pruneImageCacheForRemovedItems(before, out);
  logEvent("INFO", "Removed items from queue", { removed: list.length, queueSize: Array.isArray(out) ? out.length : 0 });
  return out;
});
ipcMain.handle("queue:removeHard", async (_e, { ids }) => {
  const list = Array.isArray(ids) ? ids : [];
  const before = queue.loadQueue();
  const out = await queue.removeIdsHard(list);
  pruneImageCacheForRemovedItems(before, out);
  logEvent("INFO", "Removed items from queue (hard)", { removed: list.length, queueSize: Array.isArray(out) ? out.length : 0 });
  return out;
});
ipcMain.handle("queue:cloneItem", async (_e, { sourceId, options } = {}) => {
  const src = String(sourceId || "").trim();
  const result = await queue.cloneItemBelow(src, options || {});
  logEvent("INFO", "Cloned queue item", {
    sourceId: src,
    clonedId: String(result?.clonedId || ""),
    queueSize: Array.isArray(result?.queue) ? result.queue.length : 0,
  });
  return result;
});

function resolvePhotoPathOnDisk(photoPath) {
  const original = String(photoPath || "").trim();
  if (!original) return "";
  try {
    if (fs.existsSync(original)) return original;
  } catch {
    // ignore
  }
  return "";
}

function checkAccess(filePath, mode) {
  try {
    fs.accessSync(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

function summarizeActiveHandleTypes() {
  try {
    if (typeof process._getActiveHandles !== "function") return {};
    const handles = process._getActiveHandles();
    const out = {};
    for (const h of Array.isArray(handles) ? handles : []) {
      const name = String(h?.constructor?.name || typeof h || "unknown");
      out[name] = Number(out[name] || 0) + 1;
    }
    return out;
  } catch {
    return {};
  }
}

function probeRenameRoundTrip(photoPath) {
  const p = String(photoPath || "").trim();
  if (!p) return { canRenameRoundTrip: false, renameRoundTripError: "Missing path" };
  if (!fs.existsSync(p)) return { canRenameRoundTrip: false, renameRoundTripError: "Path missing on disk" };

  const probeSuffix = `.sqdiag-rename-probe-${process.pid}-${Date.now()}`;
  const probePath = `${p}${probeSuffix}`;

  try {
    fs.renameSync(p, probePath);
    fs.renameSync(probePath, p);
    return { canRenameRoundTrip: true, renameRoundTripError: "" };
  } catch (e) {
    try {
      if (fs.existsSync(probePath) && !fs.existsSync(p)) {
        fs.renameSync(probePath, p);
      }
    } catch {
      // Ignore restore probe errors and keep original failure reason.
    }
    return {
      canRenameRoundTrip: false,
      renameRoundTripError: String(e?.message || e || "rename probe failed"),
    };
  }
}

function probeExclusiveOpenWindows(photoPath) {
  if (process.platform !== "win32") {
    return Promise.resolve({ canOpenExclusive: null, exclusiveOpenError: "exclusive-open probe only runs on Windows" });
  }

  const p = String(photoPath || "").trim();
  if (!p) {
    return Promise.resolve({ canOpenExclusive: false, exclusiveOpenError: "Missing path" });
  }

  const escapedPath = p.replace(/'/g, "''");
  const script = [
    `$path = '${escapedPath}'`,
    "if (-not (Test-Path -LiteralPath $path)) { Write-Output 'MISSING'; exit 0 }",
    "try {",
    "  $f = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)",
    "  $f.Close()",
    "  $f.Dispose()",
    "  Write-Output 'OK'",
    "} catch {",
    "  Write-Output ('ERR:' + $_.Exception.Message)",
    "}",
  ].join(";");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 5000 },
      (error, stdout, stderr) => {
        const out = String(stdout || "").trim();
        const err = String(stderr || "").trim();
        if (out === "OK") {
          resolve({ canOpenExclusive: true, exclusiveOpenError: "" });
          return;
        }
        if (out === "MISSING") {
          resolve({ canOpenExclusive: false, exclusiveOpenError: "Path missing on disk" });
          return;
        }
        if (out.startsWith("ERR:")) {
          resolve({ canOpenExclusive: false, exclusiveOpenError: out.slice(4).trim() });
          return;
        }
        const fallbackError = String(error?.message || "") || err || out || "exclusive-open probe failed";
        resolve({ canOpenExclusive: false, exclusiveOpenError: fallbackError });
      }
    );
  });
}

function probeWindowsLockingProcesses(photoPath) {
  if (process.platform !== "win32") {
    return Promise.resolve({ lockers: [], error: "locker probe only runs on Windows" });
  }

  const p = String(photoPath || "").trim();
  if (!p) {
    return Promise.resolve({ lockers: [], error: "Missing path" });
  }

  const escapedPath = p.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$path = '${escapedPath}'`,
    "if (-not (Test-Path -LiteralPath $path)) { Write-Output '{\"lockers\":[],\"error\":\"Path missing on disk\"}'; exit 0 }",
    "$src = @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class RmProbe {",
    "  public const int CCH_RM_SESSION_KEY = 32;",
    "  public const int CCH_RM_MAX_APP_NAME = 255;",
    "  public const int CCH_RM_MAX_SVC_NAME = 63;",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct RM_UNIQUE_PROCESS {",
    "    public int dwProcessId;",
    "    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;",
    "  }",
    "  public enum RM_APP_TYPE {",
    "    RmUnknownApp = 0, RmMainWindow = 1, RmOtherWindow = 2, RmService = 3, RmExplorer = 4, RmConsole = 5, RmCritical = 1000",
    "  }",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  public struct RM_PROCESS_INFO {",
    "    public RM_UNIQUE_PROCESS Process;",
    "    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)] public string strAppName;",
    "    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)] public string strServiceShortName;",
    "    public RM_APP_TYPE ApplicationType;",
    "    public uint AppStatus;",
    "    public uint TSSessionId;",
    "    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;",
    "  }",
    "  [DllImport(\"rstrtmgr.dll\", CharSet = CharSet.Unicode)]",
    "  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);",
    "  [DllImport(\"rstrtmgr.dll\")]",
    "  public static extern int RmEndSession(uint pSessionHandle);",
    "  [DllImport(\"rstrtmgr.dll\", CharSet = CharSet.Unicode)]",
    "  public static extern int RmRegisterResources(uint dwSessionHandle, uint nFiles, string[] rgsFileNames, uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);",
    "  [DllImport(\"rstrtmgr.dll\", CharSet = CharSet.Unicode)]",
    "  public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);",
    "}",
    "\"@",
    "Add-Type -TypeDefinition $src -Language CSharp | Out-Null",
    "$handle = 0",
    "$key = [Guid]::NewGuid().ToString('N')",
    "$startRes = [RmProbe]::RmStartSession([ref]$handle, 0, $key)",
    "if ($startRes -ne 0) { Write-Output ('{\"lockers\":[],\"error\":\"RmStartSession failed: ' + $startRes + '\"}'); exit 0 }",
    "try {",
    "  $registerRes = [RmProbe]::RmRegisterResources($handle, 1, [string[]]@($path), 0, [IntPtr]::Zero, 0, $null)",
    "  if ($registerRes -ne 0) { Write-Output ('{\"lockers\":[],\"error\":\"RmRegisterResources failed: ' + $registerRes + '\"}'); exit 0 }",
    "  $needed = 0",
    "  $count = 0",
    "  $reboot = 0",
    "  $first = [RmProbe]::RmGetList($handle, [ref]$needed, [ref]$count, $null, [ref]$reboot)",
    "  if ($first -ne 0 -and $first -ne 234) { Write-Output ('{\"lockers\":[],\"error\":\"RmGetList(1) failed: ' + $first + '\"}'); exit 0 }",
    "  $count = $needed",
    "  if ($count -le 0) { Write-Output '{\"lockers\":[],\"error\":\"\"}'; exit 0 }",
    "  $arr = New-Object RmProbe+RM_PROCESS_INFO[] ($count)",
    "  $second = [RmProbe]::RmGetList($handle, [ref]$needed, [ref]$count, $arr, [ref]$reboot)",
    "  if ($second -ne 0) { Write-Output ('{\"lockers\":[],\"error\":\"RmGetList(2) failed: ' + $second + '\"}'); exit 0 }",
    "  $out = @()",
    "  foreach ($pi in $arr) {",
    "    $pid = [int]$pi.Process.dwProcessId",
    "    if ($pid -le 0) { continue }",
    "    $procName = ''",
    "    try { $procName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch { $procName = '' }",
    "    $out += [PSCustomObject]@{ pid = $pid; appName = [string]$pi.strAppName; processName = [string]$procName; service = [string]$pi.strServiceShortName; appType = [string]$pi.ApplicationType }",
    "  }",
    "  $json = [PSCustomObject]@{ lockers = $out; error = '' } | ConvertTo-Json -Compress -Depth 4",
    "  Write-Output $json",
    "} finally {",
    "  [RmProbe]::RmEndSession($handle) | Out-Null",
    "}",
  ].join("\n");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 7000 },
      (_error, stdout, stderr) => {
        const stdoutText = String(stdout || "").trim();
        const stderrText = String(stderr || "").trim();
        let parsed = null;
        try {
          parsed = stdoutText ? JSON.parse(stdoutText) : null;
        } catch {
          parsed = null;
        }

        const lockers = Array.isArray(parsed?.lockers)
          ? parsed.lockers.map((it) => ({
              pid: Number(it?.pid || 0),
              processName: String(it?.processName || ""),
              appName: String(it?.appName || ""),
              service: String(it?.service || ""),
              appType: String(it?.appType || ""),
            })).filter((it) => it.pid > 0)
          : [];
        const probeError = String(parsed?.error || stderrText || "").trim();
        resolve({
          lockers,
          error: probeError,
          parsed: Boolean(parsed),
          rawStdout: stdoutText,
          rawStderr: stderrText,
        });
      }
    );
  });
}

function probeWindowsPathEnvironment(photoPath) {
  if (process.platform !== "win32") {
    return Promise.resolve({
      isUncPath: false,
      rootPath: "",
      driveType: "",
      driveFormat: "",
      driveIsReady: null,
      driveError: "path-environment probe only runs on Windows",
    });
  }

  const p = String(photoPath || "").trim();
  if (!p) {
    return Promise.resolve({
      isUncPath: false,
      rootPath: "",
      driveType: "",
      driveFormat: "",
      driveIsReady: null,
      driveError: "Missing path",
    });
  }

  const escapedPath = p.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$path = '${escapedPath}'`,
    "$root = [System.IO.Path]::GetPathRoot($path)",
    "$driveType = ''",
    "$driveFormat = ''",
    "$isReady = $null",
    "$driveError = ''",
    "try {",
    "  if (-not [string]::IsNullOrWhiteSpace($root)) {",
    "    $di = New-Object System.IO.DriveInfo($root)",
    "    $driveType = [string]$di.DriveType",
    "    $driveFormat = [string]$di.DriveFormat",
    "    $isReady = [bool]$di.IsReady",
    "  }",
    "} catch {",
    "  $driveError = [string]$_.Exception.Message",
    "}",
    "$out = [PSCustomObject]@{",
    "  isUncPath = [bool]$path.StartsWith('\\\\')",
    "  rootPath = [string]$root",
    "  driveType = [string]$driveType",
    "  driveFormat = [string]$driveFormat",
    "  driveIsReady = $isReady",
    "  driveError = [string]$driveError",
    "}",
    "$out | ConvertTo-Json -Compress -Depth 3",
  ].join("\n");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 5000 },
      (_error, stdout, stderr) => {
        const stdoutText = String(stdout || "").trim();
        const stderrText = String(stderr || "").trim();
        let parsed = null;
        try {
          parsed = stdoutText ? JSON.parse(stdoutText) : null;
        } catch {
          parsed = null;
        }

        resolve({
          isUncPath: Boolean(parsed?.isUncPath),
          rootPath: String(parsed?.rootPath || ""),
          driveType: String(parsed?.driveType || ""),
          driveFormat: String(parsed?.driveFormat || ""),
          driveIsReady: typeof parsed?.driveIsReady === "boolean" ? parsed.driveIsReady : null,
          driveError: String(parsed?.driveError || stderrText || "").trim(),
        });
      }
    );
  });
}

async function buildVerboseUploadFileReleaseDiagnostics(photoPath) {
  const p = String(photoPath || "").trim();
  const info = {
    photoPath: p,
    exists: false,
    fileReadable: false,
    fileWritable: false,
    sizeBytes: null,
    mtimeIso: "",
    canOpenExclusive: null,
    exclusiveOpenError: "",
    activeHandleTypes: summarizeActiveHandleTypes(),
    recentPhotoAccess: getRecentPhotoAccess(p),
  };

  if (!p) {
    info.exclusiveOpenError = "Missing path";
    return info;
  }

  try {
    info.exists = fs.existsSync(p);
  } catch {
    info.exists = false;
  }

  if (info.exists) {
    info.fileReadable = checkAccess(p, fs.constants.R_OK);
    info.fileWritable = checkAccess(p, fs.constants.W_OK);
    try {
      const stat = fs.statSync(p);
      info.sizeBytes = Number(stat.size);
      info.mtimeIso = new Date(stat.mtimeMs || stat.mtime || Date.now()).toISOString();
    } catch (e) {
      info.exclusiveOpenError = String(e?.message || e || "stat failed");
    }
  } else {
    info.exclusiveOpenError = "Path missing on disk";
  }

  const exclusive = await probeExclusiveOpenWindows(p);
  info.canOpenExclusive = exclusive.canOpenExclusive;
  if (exclusive.exclusiveOpenError) {
    info.exclusiveOpenError = String(exclusive.exclusiveOpenError || "");
  }

  return info;
}

async function logVerboseUploadFileReleaseProbe({ itemId, photoPath, outcome, finalStatus, successfulServices, retryingServices }) {
  if (!store.get("verboseLogging")) return;

  const diagnostics = await buildVerboseUploadFileReleaseDiagnostics(photoPath);
  logEvent("DEBUG", "Post-upload file release probe", {
    id: String(itemId || ""),
    outcome: String(outcome || ""),
    finalStatus: String(finalStatus || ""),
    successfulServices: Number(successfulServices || 0),
    retryingServices: Number(retryingServices || 0),
    ...diagnostics,
  });
}

async function buildTrashFailureDiagnostics(photoPath) {
  const p = String(photoPath || "").trim();
  const parentDir = path.dirname(p);
  const root = path.parse(p).root;
  const info = {
    diagnosticsVersion: 4,
    capturedAtIso: new Date().toISOString(),
    nodePid: Number(process.pid || 0),
    appVersion: app.getVersion(),
    processUptimeSec: Math.round(Number(process.uptime?.() || 0)),
    activeHandleTypes: summarizeActiveHandleTypes(),
    pathLength: p.length,
    parentDir,
    root,
    isUncPath: false,
    driveType: "",
    driveFormat: "",
    driveIsReady: null,
    driveProbeError: "",
    exists: false,
    parentExists: false,
    rootExists: false,
    fileReadable: false,
    fileWritable: false,
    parentReadable: false,
    parentWritable: false,
    canOpenRead: false,
    canOpenReadWrite: false,
    canOpenExclusive: null,
    exclusiveOpenError: "",
    canRenameRoundTrip: null,
    renameRoundTripError: "",
    lockingProcesses: [],
    lockingProcessProbeError: "",
    lockingProcessProbeParsed: null,
    lockingProcessProbeStdoutSnippet: "",
    lockingProcessProbeStderrSnippet: "",
    recentPhotoAccess: getRecentPhotoAccess(p),
    isFile: false,
    sizeBytes: null,
    mtimeIso: "",
    statError: "",
    realPath: "",
    realPathError: "",
  };

  try {
    info.exists = fs.existsSync(p);
  } catch {
    info.exists = false;
  }

  try {
    info.parentExists = fs.existsSync(parentDir);
  } catch {
    info.parentExists = false;
  }

  try {
    info.rootExists = root ? fs.existsSync(root) : false;
  } catch {
    info.rootExists = false;
  }

  if (info.exists) {
    info.fileReadable = checkAccess(p, fs.constants.R_OK);
    info.fileWritable = checkAccess(p, fs.constants.W_OK);
    try {
      const stat = fs.statSync(p);
      info.isFile = stat.isFile();
      info.sizeBytes = Number(stat.size);
      info.mtimeIso = new Date(stat.mtimeMs || stat.mtime || Date.now()).toISOString();
    } catch (e) {
      info.statError = String(e?.message || e || "stat failed");
    }
    try {
      const fd = fs.openSync(p, "r");
      fs.closeSync(fd);
      info.canOpenRead = true;
    } catch {
      info.canOpenRead = false;
    }
    try {
      const fd = fs.openSync(p, "r+");
      fs.closeSync(fd);
      info.canOpenReadWrite = true;
    } catch {
      info.canOpenReadWrite = false;
    }
    try {
      info.realPath = fs.realpathSync(p);
    } catch (e) {
      info.realPathError = String(e?.message || e || "realpath failed");
    }
  }

  if (info.parentExists) {
    info.parentReadable = checkAccess(parentDir, fs.constants.R_OK);
    info.parentWritable = checkAccess(parentDir, fs.constants.W_OK);
  }

  const exclusive = await probeExclusiveOpenWindows(p);
  info.canOpenExclusive = exclusive.canOpenExclusive;
  info.exclusiveOpenError = String(exclusive.exclusiveOpenError || "");

  const driveProbe = await probeWindowsPathEnvironment(p);
  info.isUncPath = Boolean(driveProbe?.isUncPath);
  info.driveType = String(driveProbe?.driveType || "");
  info.driveFormat = String(driveProbe?.driveFormat || "");
  info.driveIsReady = typeof driveProbe?.driveIsReady === "boolean" ? driveProbe.driveIsReady : null;
  info.driveProbeError = String(driveProbe?.driveError || "");

  const renameProbe = probeRenameRoundTrip(p);
  info.canRenameRoundTrip = renameProbe.canRenameRoundTrip;
  info.renameRoundTripError = String(renameProbe.renameRoundTripError || "");

  const lockProbe = await probeWindowsLockingProcesses(p);
  info.lockingProcesses = Array.isArray(lockProbe?.lockers) ? lockProbe.lockers : [];
  info.lockingProcessProbeError = String(lockProbe?.error || "");
  info.lockingProcessProbeParsed = typeof lockProbe?.parsed === "boolean" ? lockProbe.parsed : null;
  info.lockingProcessProbeStdoutSnippet = String(lockProbe?.rawStdout || "").slice(0, 300);
  info.lockingProcessProbeStderrSnippet = String(lockProbe?.rawStderr || "").slice(0, 300);

  return info;
}

function moveToRecycleBinViaPowerShell(photoPath) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("PowerShell recycle fallback is only available on Windows."));
  }

  const target = String(photoPath || "").trim();
  if (!target) {
    return Promise.reject(new Error("Missing photo path for PowerShell recycle fallback."));
  }

  const escapedTarget = target.replace(/'/g, "''");

  // Bypass Windows Shell SHFileOperation entirely by directly renaming the file into
  // the $Recycle.Bin folder. This uses System.IO.File.Move (equivalent to fs.rename),
  // which the canRenameRoundTrip probe proves works even when Shell COM methods fail.
  // We also write the standard $I metadata file so Windows Explorer shows the item correctly.
  const script = [
    `$path = '${escapedTarget}'`,
    "if (-not (Test-Path -LiteralPath $path)) { exit 0 }",
    "$moved = $false",
    "try {",
    "  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "  $drive = [System.IO.Path]::GetPathRoot($path)",
    "  $rbRoot = [System.IO.Path]::Combine($drive, '$Recycle.Bin', $sid)",
    "  if (-not (Test-Path -LiteralPath $rbRoot)) { throw 'Recycle Bin SID folder not found.' }",
    "  $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'",
    "  $rand = -join (1..6 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })",
    "  $ext = [System.IO.Path]::GetExtension($path)",
    "  $rFile = [System.IO.Path]::Combine($rbRoot, '$R' + $rand + $ext)",
    "  $iFile = [System.IO.Path]::Combine($rbRoot, '$I' + $rand)",
    "  $fileSize = (Get-Item -LiteralPath $path).Length",
    "  $pathNullTerm = $path + [char]0",
    "  $pathBytes = [System.Text.Encoding]::Unicode.GetBytes($pathNullTerm)",
    "  $pathCharCount = $pathNullTerm.Length",
    "  $buf = New-Object byte[] (28 + $pathBytes.Length)",
    "  $buf[0] = 1",
    "  [System.BitConverter]::GetBytes([int64]$fileSize).CopyTo($buf, 8)",
    "  [System.BitConverter]::GetBytes([int64]([System.DateTime]::UtcNow.ToFileTimeUtc())).CopyTo($buf, 16)",
    "  [System.BitConverter]::GetBytes([int32]$pathCharCount).CopyTo($buf, 24)",
    "  $pathBytes.CopyTo($buf, 28)",
    "  [System.IO.File]::WriteAllBytes($iFile, $buf)",
    "  [System.IO.File]::Move($path, $rFile)",
    "  if (-not (Test-Path -LiteralPath $path)) { $moved = $true }",
    "  if (-not $moved) { Remove-Item -LiteralPath $iFile -Force -ErrorAction SilentlyContinue }",
    "} catch {",
    "  $null = $null",
    "}",
    "if ($moved) { exit 0 }",
    "throw 'PowerShell recycle fallback did not move file.'",
  ].join("\n");

  const summarizePowerShellFallbackFailure = (rawText) => {
    const text = String(rawText || "").trim();
    if (!text) return "PowerShell recycle fallback failed.";

    const known = text.match(/PowerShell recycle fallback did not move file\.|Recycle Bin SID folder not found\.|Missing closing '\}' in statement block or type definition\./i);
    if (known && known[0]) {
      return `PowerShell recycle fallback failed: ${known[0]}`;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^Command failed:/i.test(line))
      .filter((line) => !/^powershell\.exe\b/i.test(line))
      .filter((line) => !/^\$[a-z_]/i.test(line))
      .filter((line) => !/^if\s*\(/i.test(line))
      .filter((line) => !/^while\s*\(/i.test(line))
      .filter((line) => !/^\}\s*catch/i.test(line))
      .filter((line) => !/^CategoryInfo:/i.test(line))
      .filter((line) => !/^FullyQualifiedErrorId:/i.test(line));

    const first = String(lines[0] || "").replace(/^Error:\s*/i, "").trim();
    if (!first) return "PowerShell recycle fallback failed.";
    const compact = first.replace(/\s+/g, " ").trim();
    if (compact.length <= 220) return `PowerShell recycle fallback failed: ${compact}`;
    return `PowerShell recycle fallback failed: ${compact.slice(0, 217)}...`;
  };

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 8000 },
      (error, stdout, stderr) => {
        if (error) {
          const stdoutText = String(stdout || "").trim();
          const stderrText = String(stderr || "").trim();
          const message = summarizePowerShellFallbackFailure(`${stderrText}\n${stdoutText}\n${String(error?.message || "")}`);
          reject(new Error(message));
          return;
        }
        resolve();
      }
    );
  });
}

function normalizeIdList(ids) {
  return Array.isArray(ids) ? ids.map((id) => String(id || "")).filter(Boolean) : [];
}

function normalizePhotoPathKeyForDelete(photoPath) {
  return String(photoPath || "").trim().toLowerCase();
}

function summarizeDeleteRequestDiagnostics(queueItems, ids, diagnostics = {}) {
  const list = normalizeIdList(ids);
  const byId = new Map((Array.isArray(queueItems) ? queueItems : []).map((it) => [String(it?.id || ""), it]));
  const targetItems = list
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((it) => ({
      id: String(it.id || ""),
      photoPath: String(it.photoPath || ""),
      status: String(it.status || ""),
      uploadedAt: String(it.uploadedAt || ""),
      serviceStates: it.serviceStates && typeof it.serviceStates === "object"
        ? Object.fromEntries(Object.entries(it.serviceStates).map(([service, state]) => [service, String(state?.status || "")]))
        : {},
      recentPhotoAccess: getRecentPhotoAccess(it.photoPath),
    }));

  return {
    requestedIds: list,
    renderer: diagnostics && typeof diagnostics === "object" ? {
      displayTab: String(diagnostics.displayTab || ""),
      platformEditorTab: String(diagnostics.platformEditorTab || ""),
      activeId: diagnostics.activeId == null ? null : String(diagnostics.activeId || ""),
      activePhotoPath: String(diagnostics.activePhotoPath || ""),
      selectedIds: Array.isArray(diagnostics.selectedIds) ? diagnostics.selectedIds.map((id) => String(id || "")).filter(Boolean) : [],
      selectedCount: Number(diagnostics.selectedCount || 0),
      previewOpen: diagnostics.previewOpen === true,
      previewLoading: diagnostics.previewLoading === true,
      previewSrcKind: String(diagnostics.previewSrcKind || ""),
      previewTitle: String(diagnostics.previewTitle || ""),
      previewCachedPathCount: Number(diagnostics.previewCachedPathCount || 0),
      thumbCachedPathCount: Number(diagnostics.thumbCachedPathCount || 0),
      documentHasFocus: diagnostics.documentHasFocus === true,
      focusedElementTag: String(diagnostics.focusedElementTag || ""),
      focusedElementType: String(diagnostics.focusedElementType || ""),
      targetItems: Array.isArray(diagnostics.targetItems)
        ? diagnostics.targetItems.map((entry) => ({
            id: String(entry?.id || ""),
            photoPath: String(entry?.photoPath || ""),
            status: String(entry?.status || ""),
            isActive: entry?.isActive === true,
            isSelected: entry?.isSelected === true,
            hasThumbCached: entry?.hasThumbCached === true,
            hasPreviewCached: entry?.hasPreviewCached === true,
          }))
        : [],
    } : null,
    queueTargets: targetItems,
  };
}

async function buildDeletePreflightDiagnostics(queueItems, ids) {
  const list = normalizeIdList(ids);
  const byId = new Map((Array.isArray(queueItems) ? queueItems : []).map((it) => [String(it?.id || ""), it]));
  const out = [];

  for (const id of list) {
    const item = byId.get(id);
    if (!item) continue;
    const resolvedPath = resolvePhotoPathOnDisk(item.photoPath) || String(item.photoPath || "");
    const diag = await buildVerboseUploadFileReleaseDiagnostics(resolvedPath);
    out.push({
      id: String(item.id || ""),
      photoPath: String(item.photoPath || ""),
      resolvedPath,
      status: String(item.status || ""),
      uploadedAt: String(item.uploadedAt || ""),
      recentPhotoAccess: getRecentPhotoAccess(item.photoPath),
      preflight: diag,
    });
  }

  return out;
}

async function trashOriginalsForQueueIds(queueItems, ids, options = {}) {
  const list = normalizeIdList(ids);
  const rejectUploading = options.rejectUploading === true;
  const byId = new Map((Array.isArray(queueItems) ? queueItems : []).map((it) => [String(it?.id || ""), it]));

  const targetPathKeys = new Set(
    list
      .map((id) => byId.get(id))
      .map((it) => normalizePhotoPathKeyForDelete(it?.photoPath))
      .filter(Boolean)
  );

  if (rejectUploading && targetPathKeys.size > 0) {
    const blockedIds = (Array.isArray(queueItems) ? queueItems : [])
      .filter((it) => String(it?.status || "") === "uploading")
      .filter((it) => targetPathKeys.has(normalizePhotoPathKeyForDelete(it?.photoPath)))
      .map((it) => String(it?.id || ""))
      .filter(Boolean);

    if (blockedIds.length > 0) {
      return {
        ok: false,
        blocked: true,
        blockedIds,
        error: "One or more selected files are actively uploading. Cancel the upload before deleting the original file.",
      };
    }
  }

  let movedCount = 0;
  let skippedMissing = 0;
  let failedCount = 0;
  const photoPaths = [];
  const seen = new Set();
  const initialMissingIds = [];
  const resolvedPathById = new Map();

  for (const id of list) {
    const it = byId.get(String(id || ""));
    if (!it) continue;
    const p = resolvePhotoPathOnDisk(it.photoPath);
    if (!p) {
      skippedMissing++;
      initialMissingIds.push(String(id || ""));
      continue;
    }
    resolvedPathById.set(String(id || ""), p);
    if (seen.has(p)) continue;
    seen.add(p);
    photoPaths.push(p);
  }

  const trashMove = await trash.movePathsToTrash(photoPaths, {
    trashItem: (photoPath) => shell.trashItem(photoPath),
    fallbackTrashItem: process.platform === "win32" ? (photoPath) => moveToRecycleBinViaPowerShell(photoPath) : null,
    maxAttempts: 5,
    retryDelayMs: 180,
    fallbackMaxAttempts: 3,
    fallbackRetryDelayMs: 250,
    enableFinalGraceRetry: true,
  });

  movedCount += Number(trashMove?.movedCount || 0);
  skippedMissing += Number(trashMove?.skippedMissing || 0);
  failedCount += Number(trashMove?.failedCount || 0);

  const failedPathSet = new Set(
    (Array.isArray(trashMove?.failed) ? trashMove.failed : [])
      .map((f) => String(f?.photoPath || "").trim())
      .filter(Boolean)
  );
  const deletedIds = [];
  const failedIds = [];
  const initialMissingIdSet = new Set(initialMissingIds);
  for (const id of list) {
    const sid = String(id || "");
    if (initialMissingIdSet.has(sid)) {
      deletedIds.push(sid);
      continue;
    }
    const p = String(resolvedPathById.get(sid) || "").trim();
    if (!p) continue;
    if (failedPathSet.has(p)) failedIds.push(sid);
    else deletedIds.push(sid);
  }

  for (const failure of Array.isArray(trashMove?.failed) ? trashMove.failed : []) {
    const failedPath = String(failure?.photoPath || "");
    const errorText = String(failure?.error || "Unknown trash move failure");
    const diagnostics = await buildTrashFailureDiagnostics(failedPath);
    const likelyRecyclePathIssue =
      /recycle fallback did not move file/i.test(errorText) &&
      diagnostics?.canOpenExclusive === true &&
      diagnostics?.canRenameRoundTrip === true;
    logEvent("WARN", "Failed to move original file to trash", {
      photoPath: failedPath,
      error: errorText,
      errorName: String(failure?.errorName || ""),
      errorCode: String(failure?.errorCode || ""),
      errorErrno: Number.isFinite(Number(failure?.errorErrno)) ? Number(failure.errorErrno) : null,
      errorSyscall: String(failure?.errorSyscall || ""),
      attempts: Number(failure?.attempts || 1),
      likelyRecyclePathIssue,
      likelyRecyclePathIssueHint: likelyRecyclePathIssue
        ? "Fallback recycle move reported did-not-move while exclusive-open and rename probes succeeded."
        : "",
      diagnostics,
    });
  }

  const retriedPaths = Array.isArray(trashMove?.retried) ? trashMove.retried.length : 0;
  if (retriedPaths > 0) {
    logEventVerbose("INFO", "Retried moving original files to trash after transient abort", { retriedPaths });
  }
  const fallbackRecoveredPaths = Array.isArray(trashMove?.fallbackMoved) ? trashMove.fallbackMoved.length : 0;
  if (fallbackRecoveredPaths > 0) {
    logEventVerbose("INFO", "Recovered trash move using PowerShell recycle fallback", { fallbackRecoveredPaths });
  }

  return {
    ok: true,
    movedCount,
    skippedMissing,
    failedCount,
    deletedIds,
    failedIds,
    failed: Array.isArray(trashMove?.failed)
      ? trashMove.failed.map((entry) => ({
          photoPath: String(entry?.photoPath || ""),
          error: String(entry?.error || ""),
          attempts: Number(entry?.attempts || 1),
        }))
      : [],
    trashLabel: trash.getTrashLabel(process.platform),
  };
}

ipcMain.handle("queue:detachToGroupOnly", async (_e, { ids }) => {
  const list = Array.isArray(ids) ? ids.map((id) => String(id || "")).filter(Boolean) : [];
  const out = queue.detachToGroupOnly(list);
  logEvent("INFO", "Detached items to group-only mode", { detached: list.length, queueSize: Array.isArray(out) ? out.length : 0 });
  return out;
});

ipcMain.handle("queue:removeAndTrash", async (_e, { ids }) => {
  const list = normalizeIdList(ids);
  const before = queue.loadQueue();
  const trashResult = await trashOriginalsForQueueIds(before, list);
  const out = await queue.removeIds(trashResult.deletedIds);
  pruneImageCacheForRemovedItems(before, out);
  logEvent("INFO", "Removed queue items and moved originals to trash", {
    removed: trashResult.deletedIds.length,
    movedCount: trashResult.movedCount,
    skippedMissing: trashResult.skippedMissing,
    failedCount: trashResult.failedCount,
    keptInQueue: trashResult.failedIds.length,
    queueSize: Array.isArray(out) ? out.length : 0,
  });

  return {
    ...trashResult,
    queue: out,
  };
});
ipcMain.handle("queue:trashOriginalsByIds", async (_e, { ids }) => {
  const list = normalizeIdList(ids);
  const current = queue.loadQueue();
  const trashResult = await trashOriginalsForQueueIds(current, list);
  logEvent("INFO", "Moved original files to trash", {
    requested: list.length,
    movedCount: trashResult.movedCount,
    skippedMissing: trashResult.skippedMissing,
    failedCount: trashResult.failedCount,
    succeededIds: trashResult.deletedIds.length,
    failedIds: trashResult.failedIds.length,
  });

  return trashResult;
});
ipcMain.handle("queue:deleteOriginalsByIds", async (_e, payload = {}) => {
  const trashIds = normalizeIdList(payload?.trashIds);
  const removeIds = normalizeIdList(payload?.removeIds);
  const detachIds = normalizeIdList(payload?.detachIds);
  const before = queue.loadQueue();

  try {
    logEventVerbose("DEBUG", "Delete originals request snapshot", summarizeDeleteRequestDiagnostics(before, trashIds, payload?.diagnostics));
    const preflightDiagnostics = await buildDeletePreflightDiagnostics(before, trashIds);
    logEventVerbose("DEBUG", "Delete originals preflight diagnostics", {
      requested: trashIds.length,
      entries: preflightDiagnostics,
    });
  } catch (e) {
    logEvent("WARN", "Delete diagnostics logging failed", { error: String(e?.message || e || "Unknown diagnostics logging error") });
  }

  const trashResult = await trashOriginalsForQueueIds(before, trashIds, { rejectUploading: true });

  if (!trashResult?.ok) {
    return trashResult;
  }

  const deletedIdSet = new Set((Array.isArray(trashResult.deletedIds) ? trashResult.deletedIds : []).map((id) => String(id || "")).filter(Boolean));
  const finalDetachIds = Array.from(new Set(detachIds.filter((id) => deletedIdSet.has(String(id || "")))));
  const finalRemoveIds = Array.from(new Set(removeIds.filter((id) => deletedIdSet.has(String(id || "")))));

  let out = before;
  if (finalDetachIds.length > 0) {
    out = await queue.detachToGroupOnly(finalDetachIds);
  }
  if (finalRemoveIds.length > 0) {
    out = await queue.removeIdsHard(finalRemoveIds);
  }
  if (finalDetachIds.length === 0 && finalRemoveIds.length === 0) {
    out = queue.loadQueue();
  }

  pruneImageCacheForRemovedItems(before, out);
  logEvent("INFO", "Deleted originals and updated queue", {
    requested: trashIds.length,
    movedCount: trashResult.movedCount,
    skippedMissing: trashResult.skippedMissing,
    failedCount: trashResult.failedCount,
    removed: finalRemoveIds.length,
    detached: finalDetachIds.length,
    keptInQueue: trashResult.failedIds.length,
    queueSize: Array.isArray(out) ? out.length : 0,
  });

  return {
    ...trashResult,
    queue: out,
    removedIds: finalRemoveIds,
    detachedIds: finalDetachIds,
  };
});
ipcMain.handle("queue:getMissingPathGroups", async () => {
  const q = queue.loadQueue();
  const byDir = new Map();
  let normalizedInPlace = false;

  for (const it of Array.isArray(q) ? q : []) {
    // group_only items are intentionally detached from main queue; they should
    // not trigger relink prompts for missing original files.
    if (it?.status === "group_only") continue;

    const id = String(it?.id || "");
    const photoPath = String(it?.photoPath || "").trim();
    if (!id || !photoPath) continue;

    let exists = false;
    try {
      exists = fs.existsSync(photoPath);
    } catch {
      exists = false;
    }
    if (exists) continue;

    // If the parent folder exists, try resolving the same filename in that
    // folder before prompting the user. This fixes path-format/case drift for
    // imported/legacy queues on Windows.
    const expectedDir = path.dirname(photoPath) || photoPath;
    const basename = path.basename(photoPath);
    if (expectedDir && basename) {
      try {
        if (fs.existsSync(expectedDir) && fs.statSync(expectedDir).isDirectory()) {
          const directCandidate = path.join(expectedDir, basename);
          if (fs.existsSync(directCandidate)) {
            it.photoPath = directCandidate;
            normalizedInPlace = true;
            continue;
          }

          const entries = fs.readdirSync(expectedDir);
          const lower = basename.toLowerCase();
          const caseMatch = entries.find((name) => String(name || "").toLowerCase() === lower);
          if (caseMatch) {
            const resolvedPath = path.join(expectedDir, caseMatch);
            if (fs.existsSync(resolvedPath)) {
              it.photoPath = resolvedPath;
              normalizedInPlace = true;
              continue;
            }
          }
        }
      } catch {
        // ignore local probing errors and continue with missing-group prompt
      }
    }

    const key = String(expectedDir || "").trim();
    if (!byDir.has(key)) {
      byDir.set(key, { expectedDir: key, ids: [], missingCount: 0 });
    }
    const group = byDir.get(key);
    group.ids.push(id);
    group.missingCount += 1;
  }

  const groups = Array.from(byDir.values())
    .filter((g) => g && g.missingCount > 0)
    .sort((a, b) => String(a.expectedDir || "").localeCompare(String(b.expectedDir || "")));

  if (normalizedInPlace) {
    queue.saveQueue(q);
  }

  return {
    ok: true,
    groups,
    totalMissing: groups.reduce((sum, g) => sum + Number(g.missingCount || 0), 0),
  };
});
ipcMain.handle("queue:relinkMissingFromFolder", async (_e, { folderPath, ids } = {}) => {
  const folder = String(folderPath || "").trim();
  if (!folder) return { ok: false, error: "No folder selected." };
  if (!fs.existsSync(folder)) return { ok: false, error: "Selected folder does not exist." };

  const before = queue.loadQueue();
  const candidatePaths = collectFilesRecursive(folder);
  const idList = Array.isArray(ids) ? ids.map((id) => String(id || "")).filter(Boolean) : [];

  const result = queue.relinkMissingPhotoPaths(before, candidatePaths, {
    ids: idList,
    existsFn: (p) => {
      try {
        return fs.existsSync(String(p || ""));
      } catch {
        return false;
      }
    },
  });

  const out = queue.saveQueue(result.queue);
  pruneImageCacheForRemovedItems(before, out);
  logEvent("INFO", "Relinked missing queue files from folder", {
    folder,
    candidates: candidatePaths.length,
    scannedMissing: result.scannedMissing,
    updatedCount: result.updatedCount,
    unresolvedCount: result.unresolvedCount,
    ambiguousCount: result.ambiguousCount,
    restrictedToIds: idList.length,
  });

  return {
    ok: true,
    queue: out,
    folderPath: folder,
    candidates: candidatePaths.length,
    scannedMissing: result.scannedMissing,
    updatedCount: result.updatedCount,
    unresolvedCount: result.unresolvedCount,
    ambiguousCount: result.ambiguousCount,
  };
});
ipcMain.handle("queue:update", async (_e, { items }) => {
  const before = queue.loadQueue();
  let out = await queue.updateItems(items || []);

  // Keep detached items only while they still have at least one pending
  // Flickr group retry. Once retries are cleared/completed, remove them fully.
  const pruned = (Array.isArray(out) ? out : []).filter((it) => {
    if (it?.status !== "group_only") return true;
    return Object.values(it?.groupAddStates || {}).some((st) => st?.status === "retry");
  });
  if (pruned.length !== out.length) {
    out = queue.saveQueue(pruned);
  }

  pruneImageCacheForRemovedItems(before, out);
  return out;
});
ipcMain.handle("queue:reorder", async (_e, { idsInOrder }) => {
  const list = Array.isArray(idsInOrder) ? idsInOrder : [];
  const out = await queue.reorder(list);
  logEventVerbose("INFO", "Reordered queue", { itemCount: list.length });
  return out;
});
ipcMain.handle("queue:clearUploaded", async () => {
  const before = queue.loadQueue();
  const out = await queue.clearUploaded();
  pruneImageCacheForRemovedItems(before, out);
  const beforeCount = Array.isArray(before) ? before.length : 0;
  const afterCount = Array.isArray(out) ? out.length : 0;
  logEvent("INFO", "Cleared uploaded items from queue", { removed: Math.max(0, beforeCount - afterCount), queueSize: afterCount });
  return out;
});
ipcMain.handle("queue:findDuplicates", async () => queue.findDuplicateGroups());
ipcMain.handle("queue:exportToFile", async () => {
  try {
    const q = queue.loadQueue();
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
    const timeStr = String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0");
    const defaultFileName = `ShutterQueue Queue ${dateStr} ${timeStr}.json`;

    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(getLastFileDialogDir(), defaultFileName),
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const payload = {
      app: "ShutterQueue",
      format: "queue-backup",
      version: app.getVersion(),
      exportedAt: new Date().toISOString(),
      queue: q,
    };
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), "utf-8");
    rememberLastFileDialogDir(result.filePath);
    logEvent("INFO", "Exported queue to file", { filePath: result.filePath, itemCount: q.length });
    return { ok: true, filePath: result.filePath, itemCount: q.length };
  } catch (e) {
    logEvent("ERROR", "Failed to export queue", { error: String(e) });
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle("queue:importFromFile", async (_e, { mode } = {}) => {
  try {
    const result = await dialog.showOpenDialog(win, {
      title: "Import queue backup",
      defaultPath: getLastFileDialogDir(),
      properties: ["openFile"],
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };

    const filePath = result.filePaths[0];
    rememberLastFileDialogDir(filePath);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const { items, skipped } = queue.normalizeImportedQueue(raw);
    const before = queue.loadQueue();
    const importMode = mode === "append" ? "append" : "replace";
    let out;
    if (importMode === "append") {
      const usedIds = new Set((Array.isArray(before) ? before : []).map((it) => String(it?.id || "")).filter(Boolean));
      const appended = items.map((it) => {
        let id = String(it?.id || "").trim() || crypto.randomBytes(8).toString("hex");
        while (usedIds.has(id)) id = crypto.randomBytes(8).toString("hex");
        usedIds.add(id);
        return id === it.id ? it : { ...it, id };
      });
      out = queue.saveQueue([...(Array.isArray(before) ? before : []), ...appended]);
    } else {
      const preservedGroupOnly = (Array.isArray(before) ? before : []).filter((it) => it?.status === "group_only");
      const usedIds = new Set(items.map((it) => String(it?.id || "")).filter(Boolean));
      const preserved = preservedGroupOnly.map((it) => {
        let id = String(it?.id || "").trim() || crypto.randomBytes(8).toString("hex");
        while (usedIds.has(id)) id = crypto.randomBytes(8).toString("hex");
        usedIds.add(id);
        return id === it.id ? it : { ...it, id };
      });
      out = queue.saveQueue([...items, ...preserved]);
    }
    pruneImageCacheForRemovedItems(before, out);

    const missingPaths = out.filter((it) => {
      try {
        return !fs.existsSync(String(it?.photoPath || ""));
      } catch {
        return true;
      }
    }).length;

    logEvent("INFO", "Imported queue from file", {
      filePath,
      mode: importMode,
      itemCount: out.length,
      importedCount: items.length,
      skipped,
      missingPaths,
    });
    return {
      ok: true,
      queue: out,
      filePath,
      mode: importMode,
      previousCount: Array.isArray(before) ? before.length : 0,
      importedCount: items.length,
      itemCount: out.length,
      skipped,
      missingPaths,
    };
  } catch (e) {
    logEvent("ERROR", "Failed to import queue", { error: String(e) });
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("geo:search", async (_e, { query }) => {
  try {
    if (!query || typeof query !== "string") {
      return { ok: false, error: "Invalid search query" };
    }
    
    // Check if it's a direct lat/long input
    const latLong = geo.parseLatLong(query);
    if (latLong) {
      // Get display name via reverse geocoding
      const displayName = await geo.reverseGeocode(latLong.latitude, latLong.longitude);
      return {
        ok: true,
        results: [{
          displayName: displayName,
          latitude: latLong.latitude,
          longitude: latLong.longitude,
          accuracy: 16, // Exact coordinates
          type: "coordinates"
        }]
      };
    }
    
    // Otherwise, search via Nominatim
    const results = await geo.searchLocation(query);
    return { ok: true, results };
  } catch (err) {
    const msg = err?.message ? String(err.message) : String(err);
    logEvent("ERROR", "Geocoding search failed", { query, error: msg });
    return { ok: false, error: msg };
  }
});

ipcMain.handle("log:get", async () => {
  try {
    ensureRootDir();
    if (!fs.existsSync(LOG_PATH)) return [];
    const lines = fs.readFileSync(LOG_PATH, "utf-8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-1000); // keep last 1000 lines
  } catch {
    return [];
  }
});

ipcMain.handle("log:clear", async () => {
  try {
    ensureRootDir();
    fs.writeFileSync(LOG_PATH, "", "utf-8");
  } catch {}
  return { ok: true };
});

ipcMain.handle("cfg:setVerboseLogging", async (_e, { enabled }) => {
  store.set("verboseLogging", Boolean(enabled));
  return { ok: true };
});

ipcMain.handle("cfg:setAfterUploadAction", async (_e, { action }) => {
  const valid = ["nothing", "remove", "delete"];
  const next = valid.includes(String(action || "")) ? String(action) : "nothing";
  store.set("afterUploadAction", next);
  return { ok: true, afterUploadAction: next };
});

ipcMain.handle("cfg:setMinimizeToTray", async (_e, { enabled }) => {
  store.set("minimizeToTray", Boolean(enabled));
  if (enabled) {
    createTray();
  } else if (tray) {
    tray.destroy();
    tray = null;
  }
  return { ok: true };
});

ipcMain.handle("cfg:setCheckUpdatesOnLaunch", async (_e, { enabled }) => {
  store.set("checkUpdatesOnLaunch", Boolean(enabled));
  return { ok: true, checkUpdatesOnLaunch: Boolean(enabled) };
});

ipcMain.handle("cfg:setUseLargeThumbnails", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("useLargeThumbnails", next);
  return { ok: true, useLargeThumbnails: next };
});

ipcMain.handle("cfg:setUseLargeFonts", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("useLargeFonts", next);
  return { ok: true, useLargeFonts: next };
});

ipcMain.handle("cfg:setUseLightTheme", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("useLightTheme", next);
  return { ok: true, useLightTheme: next };
});

function sanitizeResizeOptionsPayload(payload) {
  const maxWidthRaw = Number(payload?.maxWidth);
  const maxHeightRaw = Number(payload?.maxHeight);
  const maxWidth = Number.isFinite(maxWidthRaw) && maxWidthRaw > 0 ? Math.floor(maxWidthRaw) : 0;
  const maxHeight = Number.isFinite(maxHeightRaw) && maxHeightRaw > 0 ? Math.floor(maxHeightRaw) : 0;
  return {
    enabled: Boolean(payload?.enabled),
    maxWidth,
    maxHeight,
  };
}

ipcMain.handle("cfg:setBlueskyImageResizeOptions", async (_e, payload) => {
  const next = sanitizeResizeOptionsPayload(payload);
  store.set("blueskyImageResizeEnabled", next.enabled);
  store.set("blueskyImageResizeMaxWidth", next.maxWidth);
  store.set("blueskyImageResizeMaxHeight", next.maxHeight);
  return { ok: true, ...next };
});

ipcMain.handle("cfg:setPixelfedImageResizeOptions", async (_e, payload) => {
  const next = sanitizeResizeOptionsPayload(payload);
  store.set("pixelfedImageResizeEnabled", next.enabled);
  store.set("pixelfedImageResizeMaxWidth", next.maxWidth);
  store.set("pixelfedImageResizeMaxHeight", next.maxHeight);
  return { ok: true, ...next };
});

ipcMain.handle("cfg:setMastodonImageResizeOptions", async (_e, payload) => {
  const next = sanitizeResizeOptionsPayload(payload);
  store.set("mastodonImageResizeEnabled", next.enabled);
  store.set("mastodonImageResizeMaxWidth", next.maxWidth);
  store.set("mastodonImageResizeMaxHeight", next.maxHeight);
  return { ok: true, ...next };
});

ipcMain.handle("cfg:setLemmyImageResizeOptions", async (_e, payload) => {
  const next = sanitizeResizeOptionsPayload(payload);
  store.set("lemmyImageResizeEnabled", next.enabled);
  store.set("lemmyImageResizeMaxWidth", next.maxWidth);
  store.set("lemmyImageResizeMaxHeight", next.maxHeight);
  return { ok: true, ...next };
});

ipcMain.handle("cfg:setTumblrPostTextMode", async (_e, { mode }) => {
  const allowed = new Set(["bold_title_then_description", "title_then_description", "title_only", "description_only"]);
  const next = allowed.has(String(mode || "").trim()) ? String(mode).trim() : "bold_title_then_description";
  store.set("tumblrPostTextMode", next);
  return { ok: true, tumblrPostTextMode: next };
});

ipcMain.handle("cfg:setTumblrPostTimingMode", async (_e, { mode }) => {
  const allowed = new Set(["publish_now", "add_to_queue"]);
  const next = allowed.has(String(mode || "").trim()) ? String(mode).trim() : "publish_now";
  store.set("tumblrPostTimingMode", next);
  return { ok: true, tumblrPostTimingMode: next };
});

ipcMain.handle("cfg:setBlueskyPostTextMode", async (_e, { mode }) => {
  const allowed = new Set(["merge_title_description_tags", "merge_title_description", "merge_title_tags", "merge_description_tags", "title_only", "description_only"]);
  const next = allowed.has(String(mode || "").trim()) ? String(mode).trim() : "merge_title_description_tags";
  store.set("blueskyPostTextMode", next);
  return { ok: true, blueskyPostTextMode: next };
});

ipcMain.handle("cfg:setBlueskyLongPostMode", async (_e, { mode }) => {
  const allowed = new Set(["truncate", "thread"]);
  const next = allowed.has(String(mode || "").trim()) ? String(mode).trim() : "truncate";
  store.set("blueskyLongPostMode", next);
  return { ok: true, blueskyLongPostMode: next };
});

ipcMain.handle("cfg:setTumblrUseDescriptionAsImageDescription", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("tumblrUseDescriptionAsImageDescription", next);
  return { ok: true, tumblrUseDescriptionAsImageDescription: next };
});

ipcMain.handle("cfg:setBlueskyUseDescriptionAsAltText", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("blueskyUseDescriptionAsAltText", next);
  return { ok: true, blueskyUseDescriptionAsAltText: next };
});

ipcMain.handle("cfg:setPixelfedPostTextMode", async (_e, { mode }) => {
  const allowed = new Set(["merge_title_description_tags", "merge_title_description", "merge_title_tags", "merge_description_tags", "title_only", "description_only"]);
  const next = allowed.has(String(mode || "").trim()) ? String(mode).trim() : "merge_title_description_tags";
  store.set("pixelfedPostTextMode", next);
  return { ok: true, pixelfedPostTextMode: next };
});

ipcMain.handle("cfg:setPixelfedUseDescriptionAsAltText", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("pixelfedUseDescriptionAsAltText", next);
  return { ok: true, pixelfedUseDescriptionAsAltText: next };
});

ipcMain.handle("cfg:setMastodonPostTextMode", async (_e, { mode }) => {
  const allowed = new Set(["merge_title_description_tags", "merge_title_description", "merge_title_tags", "merge_description_tags", "title_only", "description_only"]);
  const next = allowed.has(String(mode || "").trim()) ? String(mode).trim() : "merge_title_description_tags";
  store.set("mastodonPostTextMode", next);
  return { ok: true, mastodonPostTextMode: next };
});

ipcMain.handle("cfg:setMastodonUseDescriptionAsAltText", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("mastodonUseDescriptionAsAltText", next);
  return { ok: true, mastodonUseDescriptionAsAltText: next };
});

ipcMain.handle("cfg:setPixelfedMastodonReshareEnabled", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("pixelfedMastodonReshareEnabled", next);
  return { ok: true, pixelfedMastodonReshareEnabled: next };
});

ipcMain.handle("cfg:setLemmyPostTextMode", async (_e, { mode }) => {
  const allowed = new Set(["merge_title_description_tags", "merge_title_description", "merge_title_tags", "merge_description_tags", "title_only", "description_only"]);
  const next = allowed.has(String(mode || "").trim()) ? String(mode).trim() : "merge_title_description_tags";
  store.set("lemmyPostTextMode", next);
  return { ok: true, lemmyPostTextMode: next };
});

ipcMain.handle("cfg:setBlueskyPrependText", async (_e, { text }) => {
  store.set("blueskyPrependText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setBlueskyAppendText", async (_e, { text }) => {
  store.set("blueskyAppendText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setMastodonPrependText", async (_e, { text }) => {
  store.set("mastodonPrependText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setMastodonAppendText", async (_e, { text }) => {
  store.set("mastodonAppendText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setLemmyPrependText", async (_e, { text }) => {
  store.set("lemmyPrependText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setLemmyAppendText", async (_e, { text }) => {
  store.set("lemmyAppendText", String(text || ""));
  return { ok: true };
});


ipcMain.handle("cfg:setPixelfedPrependText", async (_e, { text }) => {
  store.set("pixelfedPrependText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setPixelfedAppendText", async (_e, { text }) => {
  store.set("pixelfedAppendText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setTumblrPrependText", async (_e, { text }) => {
  store.set("tumblrPrependText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setTumblrAppendText", async (_e, { text }) => {
  store.set("tumblrAppendText", String(text || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setTumblrGlobalTags", async (_e, { tags }) => {
  store.set("tumblrGlobalTags", String(tags || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setFlickrGlobalTags", async (_e, { tags }) => {
  store.set("flickrGlobalTags", String(tags || ""));
  return { ok: true };
});

ipcMain.handle("cfg:setFlickrQueueNewUploadsBehindExistingGroupQueues", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("flickrQueueNewUploadsBehindExistingGroupQueues", next);
  return { ok: true, flickrQueueNewUploadsBehindExistingGroupQueues: next };
});

ipcMain.handle("cfg:setAddShutterQueueTagToAllUploads", async (_e, { enabled }) => {
  const next = Boolean(enabled);
  store.set("addShutterQueueTagToAllUploads", next);
  return { ok: true, addShutterQueueTagToAllUploads: next };
});

ipcMain.handle("cfg:clearLastError", async () => {
  store.set("lastError", "");
  return { ok: true };
});

ipcMain.handle("log:save", async () => {
  try {
    ensureRootDir();
    if (!fs.existsSync(LOG_PATH)) return { ok: false };
    const lines = fs.readFileSync(LOG_PATH, "utf-8");
    const version = app.getVersion();
    const now = new Date();
    const dateStr = now.getFullYear().toString() + 
      String(now.getMonth() + 1).padStart(2, '0') + 
      String(now.getDate()).padStart(2, '0');
    const timeStr = String(now.getHours()).padStart(2, '0') + 
      String(now.getMinutes()).padStart(2, '0');
    const defaultFileName = `ShutterQueue Log ${dateStr} ${timeStr}.txt`;
    
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(getLastFileDialogDir(), defaultFileName),
      filters: [{ name: "Text Files", extensions: ["txt"] }]
    });
    
    if (!result.canceled && result.filePath) {
      const content = `ShutterQueue v${version}\n\n${lines}`;
      fs.writeFileSync(result.filePath, content, "utf-8");
      rememberLastFileDialogDir(result.filePath);
      return { ok: true, filePath: result.filePath };
    }
    return { ok: false };
  } catch (e) {
    logEvent("ERROR", "Failed to save log", { error: String(e) });
    return { ok: false };
  }
});



ipcMain.handle("ui:pickPhotos", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Add photos",
    defaultPath: getLastFileDialogDir(),
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "heic"] }]
  });
  if (!res.canceled && Array.isArray(res.filePaths) && res.filePaths[0]) {
    rememberLastFileDialogDir(res.filePaths[0]);
  }
  return res.canceled ? [] : (res.filePaths || []);
});

ipcMain.handle("ui:pickFolder", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Select folder containing your photo files",
    defaultPath: getLastFileDialogDir(),
    properties: ["openDirectory"],
  });
  if (!res.canceled && Array.isArray(res.filePaths) && res.filePaths[0]) {
    store.set("fileDialogLastDir", String(res.filePaths[0]));
    return String(res.filePaths[0]);
  }
  return "";
});

// show a three-button dialog when starting the scheduler:
// options: "Start Immediately", "Start with Delay", "Cancel"
ipcMain.handle("ui:show-start-scheduler-dialog", async () => {
  const res = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Start Immediately", "Start on Delay", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Start scheduler",
    message: "How would you like to start the scheduler?",
    detail: "Starting immediately will upload the next item now. \nStarting on delay will wait the full interval before the first upload.\nCancel will not start the scheduler.",
    noLink: true,
  });
  // return a simple string so renderer can branch
  switch (res.response) {
    case 0:
      return "now";
    case 1:
      return "delay";
    default:
      return "cancel";
  }
});

ipcMain.handle("ui:show-queue-import-mode-dialog", async () => {
  const res = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Replace the current queue", "Add to the current queue", "Cancel Import"],
    defaultId: 0,
    cancelId: 2,
    title: "Import queue backup",
    message: "How do you want to handle the imported items?",
    noLink: true,
  });

  switch (res.response) {
    case 0:
      return "replace";
    case 1:
      return "append";
    default:
      return "cancel";
  }
});

ipcMain.handle("ui:show-retry-upload-dialog", async () => {
  const res = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Retry upload now", "Reset status in queue", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Retry upload",
    message: "Choose how you want to handle this failed upload.",
    detail: "Retry upload now immediately attempts upload again. Reset status in queue marks the item pending so it can upload later.",
    noLink: true,
  });

  switch (res.response) {
    case 0:
      return "retry_now";
    case 1:
      return "reset_status";
    default:
      return "cancel";
  }
});

let albumTitleToIdCache = new Map();
let albumTitleCacheKey = "";

function normalizeAlbumTitleKey(title) {
  return String(title || "").trim().toLowerCase();
}

async function warmAlbumTitleCache(auth) {
  const forceRefresh = arguments[1] && arguments[1].force === true;
  const key = `${String(auth?.userNsid || "")}|${String(auth?.token || "")}`;
  if (!forceRefresh && albumTitleCacheKey === key && albumTitleToIdCache.size > 0) return;

  const list = await flickr.listAlbums({
    apiKey: auth.apiKey,
    apiSecret: auth.apiSecret,
    token: auth.token,
    tokenSecret: auth.tokenSecret,
    userNsid: auth.userNsid,
  });

  const nextMap = new Map();
  for (const a of Array.isArray(list) ? list : []) {
    const t = normalizeAlbumTitleKey(a?.title || "");
    const id = String(a?.id || "");
    if (!t || !id || nextMap.has(t)) continue;
    nextMap.set(t, id);
  }
  albumTitleToIdCache = nextMap;
  albumTitleCacheKey = key;
}

async function ensureAlbumByTitle({ title, primaryPhotoId, auth }) {
  const rawTitle = String(title || "").trim();
  if (!rawTitle) return null;
  const titleKey = normalizeAlbumTitleKey(rawTitle);

  try {
    await warmAlbumTitleCache(auth);
  } catch (e) {
    logEvent("WARN", "Failed to warm album title cache", { error: String(e) });
  }

  const existing = albumTitleToIdCache.get(titleKey);
  if (existing) return { id: existing, createdNow: false };

  // Cache may be stale after long gaps/restarts or prior transient list failures.
  // Force one fresh scan before creating a new album.
  try {
    await warmAlbumTitleCache(auth, { force: true });
    const refreshedExisting = albumTitleToIdCache.get(titleKey);
    if (refreshedExisting) return { id: refreshedExisting, createdNow: false };
  } catch (e) {
    logEvent("WARN", "Failed to refresh album title cache before create", { title: rawTitle, error: String(e) });
  }

  try {
    const created = await flickr.createAlbum({
      apiKey: auth.apiKey,
      apiSecret: auth.apiSecret,
      token: auth.token,
      tokenSecret: auth.tokenSecret,
      title: rawTitle,
      primaryPhotoId,
    });
    const id = String(created?.id || "");
    if (!id) throw new Error("Album creation succeeded but no album id was returned.");
    albumTitleToIdCache.set(titleKey, id);
    return { id, createdNow: true };
  } catch (e) {
    // If Flickr reports a duplicate title race, recover by re-listing albums and
    // resolving to the existing album instead of failing or creating duplicates.
    if (!flickr.isLikelyDuplicateAlbumTitleError(e)) throw e;

    try {
      await warmAlbumTitleCache(auth, { force: true });
      const recoveredId = albumTitleToIdCache.get(titleKey);
      if (recoveredId) {
        logEvent("INFO", "Resolved duplicate album title to existing album", {
          title: rawTitle,
          albumId: recoveredId,
        });
        return { id: recoveredId, createdNow: false };
      }
    } catch (refreshErr) {
      logEvent("WARN", "Failed album cache refresh after duplicate title error", {
        title: rawTitle,
        error: String(refreshErr),
      });
    }

    throw e;
  }
}

async function reconcileQueuedCreateAlbumsAgainstExisting({ auth, forceRefresh } = {}) {
  const doForceRefresh = forceRefresh === true;
  try {
    if (doForceRefresh) await warmAlbumTitleCache(auth, { force: true });
    else await warmAlbumTitleCache(auth);
  } catch (e) {
    logEvent("WARN", "Failed to warm album cache for queued album reconciliation", {
      error: String(e?.message || e),
    });
    return { updatedItems: 0, matchedTitles: 0 };
  }

  const q = queue.loadQueue();
  let updatedItems = 0;
  let matchedTitles = 0;
  let touched = false;

  for (const it of q) {
    const createAlbums = Array.isArray(it?.createAlbums)
      ? it.createAlbums.map((t) => String(t || "").trim()).filter(Boolean)
      : [];
    if (!createAlbums.length) continue;

    const nextCreateAlbums = [];
    const nextAlbumIds = new Set((Array.isArray(it?.albumIds) ? it.albumIds : []).map((id) => String(id || "").trim()).filter(Boolean));
    let itemChanged = false;

    for (const title of createAlbums) {
      const existingAlbumId = albumTitleToIdCache.get(normalizeAlbumTitleKey(title));
      if (existingAlbumId) {
        matchedTitles += 1;
        if (!nextAlbumIds.has(String(existingAlbumId))) {
          nextAlbumIds.add(String(existingAlbumId));
        }
        itemChanged = true;
        continue;
      }
      nextCreateAlbums.push(title);
    }

    if (!itemChanged) continue;
    it.albumIds = Array.from(nextAlbumIds);
    it.createAlbums = nextCreateAlbums;
    updatedItems += 1;
    touched = true;
  }

  if (touched) queue.saveQueue(q);
  return { updatedItems, matchedTitles };
}

function normalizeTargetServicesForItem(item) {
  const allowedServices = new Set(["flickr", "tumblr", "bluesky", "pixelfed", "mastodon", "lemmy"]);
  const raw = Array.isArray(item?.targetServices) ? item.targetServices : [];
  const out = [];
  const seen = new Set();
  for (const svc of raw) {
    const clean = String(svc || "").trim().toLowerCase();
    if (!allowedServices.has(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  if (!out.length) out.push("flickr");
  return out;
}

function appendImplicitTagCsv(tagsCsv, implicitTag) {
  const requested = String(implicitTag || "").trim();
  if (!requested) return String(tagsCsv || "");

  const normalizeTagKey = (v) => String(v || "").trim().toLowerCase().replace(/^#+/, "");
  const requestedKey = normalizeTagKey(requested);
  const parts = String(tagsCsv || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const withoutExisting = parts.filter((p) => normalizeTagKey(p) !== requestedKey);
  withoutExisting.push(requested);
  return withoutExisting.join(",");
}

function appendGlobalTagsCsv(tagsCsv, globalTagsCsv) {
  const globals = String(globalTagsCsv || "").split(",").map((t) => t.trim()).filter(Boolean);
  let result = String(tagsCsv || "");
  for (const g of globals) {
    result = appendImplicitTagCsv(result, g);
  }
  return result;
}

async function uploadNowOneInternal(options = {}) {
  const maxUploadAttempts = 2;

  // Prevent overlapping uploads
  uploadLock = true;

  try {
    if (!isAuthed()) throw new Error("Not authorized");

    const q = queue.loadQueue();
    const requestedId = options && options.itemId ? String(options.itemId) : "";
    const nowMs = Date.now();
    let next = null;
    if (requestedId) {
      next = q.find(it => it.id === requestedId && (it.status === "pending" || it.status === "failed")) || null;
    } else {
      next = getDueManualScheduledPendingItem(q, nowMs);
      if (!next) {
        next = q.find(it => {
          if (it.status !== "pending") return false;
          const scheduleMs = getManualScheduleMs(it);
          return scheduleMs == null || scheduleMs <= nowMs;
        }) || null;
      }
    }
    if (!next) return { ok: true, message: "No pending items." };

    next.targetServices = normalizeTargetServicesForItem(next);
    if (!next.serviceStates || typeof next.serviceStates !== "object") next.serviceStates = {};

    if (next.status === "failed") {
      next.status = "pending";
      next.lastError = "";
      queue.saveQueue(q);
    }

    next.status = "uploading";
    next.lastError = "";
    queue.saveQueue(q);

    logEventVerbose("INFO", "Uploading photo", { id: next.id, path: next.photoPath });

    let successfulServices = 0;
    const warningParts = [];
    const errorParts = [];
    const addShutterQueueTag = store.get("addShutterQueueTagToAllUploads") !== false;
    const hasExplicitLocationData = Boolean(String(next.locationDisplayName || "").trim());
    const hasLocationSupportingTarget = next.targetServices.includes("flickr");
    let pixelfedPostUrlForMastodonReshare = "";

    if (next.targetServices.includes("flickr") && next.serviceStates?.flickr?.status !== "done") {
      if (!isFlickrAuthed()) {
        const msg = "Flickr target selected but Flickr is not authorized.";
        next.serviceStates.flickr = { status: "failed", lastError: msg };
        errorParts.push(`Flickr: ${msg}`);
      } else {
        const auth = getFlickrAuth();
        try {
          let photoId = "";
          let lastUploadErr = null;
          const flickrGlobalTags = String(store.get("flickrGlobalTags") || "");
          for (let attempt = 1; attempt <= maxUploadAttempts; attempt++) {
            try {
              let lastProgressBytes = 0;
              let flickrItemTags = addShutterQueueTag ? appendImplicitTagCsv(next.tags, "ShutterQueue") : next.tags;
              if (flickrGlobalTags) flickrItemTags = appendGlobalTagsCsv(flickrItemTags, flickrGlobalTags);
              photoId = await flickr.uploadPhoto({
                apiKey: auth.apiKey,
                apiSecret: auth.apiSecret,
                token: auth.token,
                tokenSecret: auth.tokenSecret,
                item: {
                  ...next,
                  tags: flickrItemTags,
                },
                onProgress: (loaded, total) => {
                  const minThreshold = 512;
                  if (loaded > lastProgressBytes && (loaded >= minThreshold || loaded === total)) {
                    lastProgressBytes = loaded;
                    try {
                      if (win && win.webContents) {
                        win.webContents.send("upload:progress", { loaded, total });
                      }
                    } catch (_) {}
                  }
                }
              });
              lastUploadErr = null;
              break;
            } catch (e) {
              lastUploadErr = e;
              const msg = e?.message ? String(e.message) : String(e);
              if (attempt < maxUploadAttempts) {
                logEvent("WARN", "Upload attempt failed; retrying", {
                  id: next.id,
                  attempt,
                  maxAttempts: maxUploadAttempts,
                  error: msg,
                });
              }
            }
          }
          if (!photoId) throw (lastUploadErr || new Error("Upload failed"));

          next.photoId = photoId;
          next.uploadedAt = new Date().toISOString();
          logEventVerbose("INFO", "Uploaded photo", { id: next.id, photoId });

          if (next.latitude != null && next.longitude != null) {
            try {
              await flickr.setPhotoLocation({
                apiKey: auth.apiKey,
                apiSecret: auth.apiSecret,
                token: auth.token,
                tokenSecret: auth.tokenSecret,
                photoId,
                latitude: next.latitude,
                longitude: next.longitude,
                accuracy: next.accuracy || 16,
                geoPrivacy: next.geoPrivacy || "private"
              });
              logEvent("INFO", "Set photo location", {
                id: next.id,
                photoId,
                location: next.locationDisplayName || `${next.latitude}, ${next.longitude}`
              });
            } catch (e) {
              const msg = e?.message ? String(e.message) : String(e);
              logEvent("WARN", "Failed to set photo location", { id: next.id, photoId, error: msg });
            }
          }

          const serviceWarnings = [];
          const albumParts = [];
          const createdAlbumIdsForThisPhoto = new Set();

          const requestedCreateAlbums = [];
          {
            const seen = new Set();
            for (const title of (next.createAlbums || [])) {
              const trimmed = String(title || "").trim();
              const k = trimmed.toLowerCase();
              if (!trimmed || seen.has(k)) continue;
              seen.add(k);
              requestedCreateAlbums.push(trimmed);
            }
          }
          const unresolvedCreateAlbums = [];
          if (requestedCreateAlbums.length > 0) {
            try {
              // Auto-heal queue items: resolve pending create-album titles to existing
              // albums case-insensitively before any create attempt.
              await warmAlbumTitleCache(auth, { force: true });
            } catch (e) {
              logEvent("WARN", "Failed to refresh album cache before create-album reconciliation", {
                id: next.id,
                photoId,
                error: String(e?.message || e),
              });
            }
          }
          for (const title of requestedCreateAlbums) {
            try {
              const existingAlbumId = albumTitleToIdCache.get(normalizeAlbumTitleKey(title));
              if (existingAlbumId) {
                next.albumIds = Array.from(new Set([...(next.albumIds || []), String(existingAlbumId)]));
                logEvent("INFO", "Resolved queued create-album title to existing album", {
                  id: next.id,
                  photoId,
                  title,
                  albumId: String(existingAlbumId),
                });
                continue;
              }

              const ensured = await ensureAlbumByTitle({ title, primaryPhotoId: photoId, auth });
              if (!ensured?.id) {
                unresolvedCreateAlbums.push(title);
                continue;
              }
              next.albumIds = Array.from(new Set([...(next.albumIds || []), String(ensured.id)]));
              if (ensured.createdNow) {
                createdAlbumIdsForThisPhoto.add(String(ensured.id));
                logEvent("INFO", "Created album for queued photo", { id: next.id, photoId, title, albumId: String(ensured.id) });
              }
            } catch (e) {
              const msg = e?.message ? String(e.message) : String(e);
              unresolvedCreateAlbums.push(title);
              serviceWarnings.push(`create album \"${title}\": ${msg}`);
              albumParts.push(`create album \"${title}\": ${msg}`);
              logEvent("WARN", "Album create failed", { id: next.id, photoId, title, error: msg });
            }
          }
          next.createAlbums = unresolvedCreateAlbums;
          queue.saveQueue(q);

          for (const aid of (next.albumIds || [])) {
            if (createdAlbumIdsForThisPhoto.has(String(aid))) continue;
            try {
              await flickr.addPhotoToAlbum({ apiKey: auth.apiKey, apiSecret: auth.apiSecret, token: auth.token, tokenSecret: auth.tokenSecret, photoId, albumId: aid });
              logEvent("INFO", "Added to album", { id: next.id, photoId, albumId: aid });
            } catch (e) {
              const msg = e?.message ? String(e.message) : String(e);
              serviceWarnings.push(`album ${aid}: ${msg}`);
              albumParts.push(`album ${aid}: ${msg}`);
              logEvent("WARN", "Album add failed", { id: next.id, photoId, albumId: aid, error: msg });
            }
          }

          const successfullyAddedGroups = new Set();
          const deferGroupAddsBehindExistingQueues = Boolean(store.get("flickrQueueNewUploadsBehindExistingGroupQueues"));
          for (const gid of (next.groupIds || [])) {
            if (deferGroupAddsBehindExistingQueues) {
              const groupQueueStats = queue.getGroupRetryQueueStats(q, gid, { excludeItemId: next.id });
              if (groupQueueStats.hasRetry) {
                const states = normalizeGroupAddState(next);
                const latestRetryMs = groupQueueStats.latestRetryAt
                  ? new Date(groupQueueStats.latestRetryAt).getTime()
                  : NaN;
                const nextRetryAt = Number.isFinite(latestRetryMs)
                  ? new Date(latestRetryMs + 1000).toISOString()
                  : new Date(Date.now() + 60 * 60 * 1000).toISOString();
                states[gid] = {
                  status: "retry",
                  message: `Queued behind existing group add queue for group ${gid}.`,
                  retryCount: 0,
                  firstFailedAt: nowIso(),
                  nextRetryAt,
                  lastAttemptAt: nowIso(),
                };
                serviceWarnings.push(`group ${gid}: queued behind existing group-add queue; will retry automatically.`);
                logEvent("INFO", "Deferred group add behind existing queue", {
                  id: next.id,
                  photoId,
                  groupId: gid,
                  existingQueuedCount: groupQueueStats.retryCount,
                  nextRetryAt,
                });
                continue;
              }
            }
            const res = await attemptAddToGroup({ apiKey: auth.apiKey, apiSecret: auth.apiSecret, token: auth.token, tokenSecret: auth.tokenSecret, item: next, groupId: gid });
            if (!res.ok) serviceWarnings.push(`group ${gid}: ${res.message || "Group add failed"}`);
            else if (res.ok && !res.info) successfullyAddedGroups.add(gid);  // info=true means moderation queue, not a real add
          }
          // If any groups accepted this new photo, those groups may also accept
          // older photos already waiting in the retry queue. Try them now.
          if (successfullyAddedGroups.size > 0 && isFlickrAuthed()) {
            processDueGroupRetries({
              apiKey: auth.apiKey,
              apiSecret: auth.apiSecret,
              token: auth.token,
              tokenSecret: auth.tokenSecret,
              maxAttempts: successfullyAddedGroups.size,
              forceDue: true,
              preserveTimerOnRejection: true,
              groupsFilter: successfullyAddedGroups
            }).catch((e) => {
              logEvent("WARN", "Post-upload group retry sweep failed", { error: e?.message || String(e) });
            });
          }

          if (serviceWarnings.length) {
            setItemLastErrorFromGroupStates(next, albumParts);
            warningParts.push(...serviceWarnings.map((w) => `Flickr: ${w}`));
          }

          next.serviceStates.flickr = {
            status: "done",
            remoteId: photoId,
            uploadedAt: next.uploadedAt,
          };
          successfulServices += 1;
          queue.saveQueue(q);
        } catch (e) {
          const msg = e?.message ? String(e.message) : String(e);
          next.serviceStates.flickr = { status: "failed", lastError: msg };
          errorParts.push(`Flickr: ${msg}`);
          logEvent("WARN", "Flickr upload failed", { id: next.id, error: msg });
        }
      }
    } else if (next.targetServices.includes("flickr")) {
      successfulServices += 1;
    }

    if (next.targetServices.includes("tumblr") && next.serviceStates?.tumblr?.status !== "done") {
      if (!isTumblrAuthed()) {
        const msg = "Tumblr target selected but Tumblr is not authorized.";
        next.serviceStates.tumblr = { status: "failed", lastError: msg };
        errorParts.push(`Tumblr: ${msg}`);
      } else {
        const tauth = getTumblrAuth();
        const blogId = String(store.get("tumblrPrimaryBlogId") || "").trim();
        if (!blogId) {
          const msg = "Select a Tumblr blog in Setup before uploading.";
          next.serviceStates.tumblr = { status: "failed", lastError: msg };
          errorParts.push(`Tumblr: ${msg}`);
        } else {
          try {
            const tumblrPostTextMode = String(store.get("tumblrPostTextMode") || "bold_title_then_description");
            const tumblrPostTimingMode = String(store.get("tumblrPostTimingMode") || "publish_now");
            const tumblrUseDescriptionAsImageDescription = store.get("tumblrUseDescriptionAsImageDescription") !== false;
            const tumblrPrependText = String(store.get("tumblrPrependText") || "");
            const tumblrAppendText = String(store.get("tumblrAppendText") || "");
            const tumblrGlobalTags = String(store.get("tumblrGlobalTags") || "");
            const privacy = String(next.privacy || "private");
            if (privacy === "friends" || privacy === "family" || privacy === "friends_family") {
              warningParts.push(`Tumblr: visibility "${privacy}" is not supported and was not applied.`);
            }
            let tumblrItemTags = addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags;
            if (tumblrGlobalTags) tumblrItemTags = appendGlobalTagsCsv(tumblrItemTags, tumblrGlobalTags);
            const postId = await tumblr.createPhotoPost({
              consumerKey: tauth.consumerKey,
              consumerSecret: tauth.consumerSecret,
              token: tauth.token,
              tokenSecret: tauth.tokenSecret,
              blogIdentifier: blogId,
              item: {
                ...next,
                tags: tumblrItemTags,
              },
              markMature: Number(next.safetyLevel || 1) >= 2,
              postTextMode: tumblrPostTextMode,
              postTimingMode: tumblrPostTimingMode,
              useDescriptionAsImageDescription: tumblrUseDescriptionAsImageDescription,
              prependText: tumblrPrependText,
              appendText: tumblrAppendText,
            });
            const uploadedAt = new Date().toISOString();
            next.serviceStates.tumblr = {
              status: "done",
              remoteId: postId,
              uploadedAt,
            };
            successfulServices += 1;
            logEventVerbose("INFO", "Uploaded to Tumblr", { id: next.id, postId, blogId });
          } catch (e) {
            const msg = e?.message ? String(e.message) : String(e);
            if (isTransientNetworkError(msg)) {
              applyTransientRetry(next.serviceStates, "tumblr", msg, warningParts, errorParts, next.id);
            } else {
              next.serviceStates.tumblr = { status: "failed", lastError: msg };
              errorParts.push(`Tumblr: ${msg}`);
              logEvent("WARN", "Tumblr upload failed", { id: next.id, error: msg, blogId });
            }
          }
        }
      }
    } else if (next.targetServices.includes("tumblr")) {
      successfulServices += 1;
    }

    if (next.targetServices.includes("bluesky") && (
      next.serviceStates?.bluesky?.status !== "done" || !String(next.serviceStates?.bluesky?.remoteId || "").trim()
    )) {
      if (!isBlueskyAuthed()) {
        const msg = "Bluesky target selected but Bluesky is not authorized.";
        next.serviceStates.bluesky = { status: "failed", lastError: msg };
        errorParts.push(`Bluesky: ${msg}`);
      } else if (String(next.privacy || "private") !== "public") {
        const msg = `visibility \"${String(next.privacy || "private")}\" is not supported and was not applied.`;
        warningParts.push(`Bluesky: ${msg}`);
        const bauth = getBlueskyAuth();
        const blueskyPostTextMode = String(store.get("blueskyPostTextMode") || "merge_title_description_tags");
        const blueskyLongPostMode = String(store.get("blueskyLongPostMode") || "truncate");
        const blueskyUseDescriptionAsAltText = store.get("blueskyUseDescriptionAsAltText") !== false;
        const blueskyImageResizeOptions = {
          enabled: store.get("blueskyImageResizeEnabled") === true,
          maxWidth: Number(store.get("blueskyImageResizeMaxWidth") || 0),
          maxHeight: Number(store.get("blueskyImageResizeMaxHeight") || 0),
        };
        const blueskyPrependText = String(store.get("blueskyPrependText") || "");
        const blueskyAppendText = String(store.get("blueskyAppendText") || "");
        try {
          const post = await bluesky.createImagePost({
            accessJwt: bauth.accessJwt,
            did: bauth.did,
            serviceUrl: bauth.serviceUrl,
            item: {
              ...next,
              tags: addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags,
            },
            postTextMode: blueskyPostTextMode,
            longPostMode: blueskyLongPostMode,
            safetyLevel: next.safetyLevel,
            useDescriptionAsAltText: blueskyUseDescriptionAsAltText,
            imageResizeOptions: blueskyImageResizeOptions,
            prependText: blueskyPrependText,
            appendText: blueskyAppendText,
          });
          const remoteId = String(post.uri || post.cid || "").trim();
          if (!remoteId) {
            throw new Error("Bluesky upload returned no post identifier.");
          }
          next.serviceStates.bluesky = {
            status: "done",
            remoteId,
            uploadedAt: new Date().toISOString(),
          };
          successfulServices += 1;
          store.set("blueskyHandle", String(bauth.handle || store.get("blueskyIdentifier") || ""));
          logEventVerbose("INFO", "Uploaded to Bluesky", { id: next.id, uri: post.uri || "" });
        } catch (e) {
          const msg2 = e?.message ? String(e.message) : String(e);
          const canRefresh = /ExpiredToken/i.test(msg2) && String(bauth.refreshJwt || "").trim();
          if (canRefresh) {
            try {
              const refreshed = await bluesky.refreshSession({
                refreshJwt: bauth.refreshJwt,
                serviceUrl: bauth.serviceUrl,
              });
              if (refreshed.accessJwt) store.set("blueskyAccessJwtEnc", encryptCredential(refreshed.accessJwt));
              if (refreshed.refreshJwt) store.set("blueskyRefreshJwtEnc", encryptCredential(refreshed.refreshJwt));
              if (refreshed.did) store.set("blueskyDid", refreshed.did);
              if (refreshed.handle) store.set("blueskyHandle", refreshed.handle);

              const retryPost = await bluesky.createImagePost({
                accessJwt: refreshed.accessJwt || bauth.accessJwt,
                did: refreshed.did || bauth.did,
                serviceUrl: refreshed.serviceUrl || bauth.serviceUrl,
                item: {
                  ...next,
                  tags: addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags,
                },
                postTextMode: blueskyPostTextMode,
                longPostMode: blueskyLongPostMode,
                safetyLevel: next.safetyLevel,
                useDescriptionAsAltText: blueskyUseDescriptionAsAltText,
                imageResizeOptions: blueskyImageResizeOptions,
                prependText: blueskyPrependText,
                appendText: blueskyAppendText,
              });
              const retryRemoteId = String(retryPost.uri || retryPost.cid || "").trim();
              if (!retryRemoteId) {
                throw new Error("Bluesky upload returned no post identifier after refresh.");
              }
              next.serviceStates.bluesky = {
                status: "done",
                remoteId: retryRemoteId,
                uploadedAt: new Date().toISOString(),
              };
              successfulServices += 1;
              logEventVerbose("INFO", "Uploaded to Bluesky after token refresh", { id: next.id, uri: retryPost.uri || "" });
            } catch (refreshErr) {
              const finalMsg = refreshErr?.message ? String(refreshErr.message) : String(refreshErr);
              if (isTransientNetworkError(finalMsg)) {
                applyTransientRetry(next.serviceStates, "bluesky", finalMsg, warningParts, errorParts, next.id);
              } else {
                next.serviceStates.bluesky = { status: "failed", lastError: finalMsg };
                errorParts.push(`Bluesky: ${finalMsg}`);
                logEvent("WARN", "Bluesky upload failed after token refresh", { id: next.id, error: finalMsg });
              }
            }
          } else {
            if (isTransientNetworkError(msg2)) {
              applyTransientRetry(next.serviceStates, "bluesky", msg2, warningParts, errorParts, next.id);
            } else {
              next.serviceStates.bluesky = { status: "failed", lastError: msg2 };
              errorParts.push(`Bluesky: ${msg2}`);
              logEvent("WARN", "Bluesky upload failed", { id: next.id, error: msg2 });
            }
          }
        }
      } else {
        const bauth = getBlueskyAuth();
        const blueskyPostTextMode = String(store.get("blueskyPostTextMode") || "merge_title_description_tags");
        const blueskyLongPostMode = String(store.get("blueskyLongPostMode") || "truncate");
        const blueskyUseDescriptionAsAltText = store.get("blueskyUseDescriptionAsAltText") !== false;
        const blueskyImageResizeOptions = {
          enabled: store.get("blueskyImageResizeEnabled") === true,
          maxWidth: Number(store.get("blueskyImageResizeMaxWidth") || 0),
          maxHeight: Number(store.get("blueskyImageResizeMaxHeight") || 0),
        };
        const blueskyPrependText = String(store.get("blueskyPrependText") || "");
        const blueskyAppendText = String(store.get("blueskyAppendText") || "");
        try {
          const post = await bluesky.createImagePost({
            accessJwt: bauth.accessJwt,
            did: bauth.did,
            serviceUrl: bauth.serviceUrl,
            item: {
              ...next,
              tags: addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags,
            },
            postTextMode: blueskyPostTextMode,
            longPostMode: blueskyLongPostMode,
            safetyLevel: next.safetyLevel,
            useDescriptionAsAltText: blueskyUseDescriptionAsAltText,
            imageResizeOptions: blueskyImageResizeOptions,
            prependText: blueskyPrependText,
            appendText: blueskyAppendText,
          });
          const remoteId = String(post.uri || post.cid || "").trim();
          if (!remoteId) {
            throw new Error("Bluesky upload returned no post identifier.");
          }
          next.serviceStates.bluesky = {
            status: "done",
            remoteId,
            uploadedAt: new Date().toISOString(),
          };
          successfulServices += 1;
          store.set("blueskyHandle", String(bauth.handle || store.get("blueskyIdentifier") || ""));
          logEventVerbose("INFO", "Uploaded to Bluesky", { id: next.id, uri: post.uri || "" });
        } catch (e) {
          const msg = e?.message ? String(e.message) : String(e);
          const canRefresh = /ExpiredToken/i.test(msg) && String(bauth.refreshJwt || "").trim();
          if (canRefresh) {
            try {
              const refreshed = await bluesky.refreshSession({
                refreshJwt: bauth.refreshJwt,
                serviceUrl: bauth.serviceUrl,
              });
              if (refreshed.accessJwt) store.set("blueskyAccessJwtEnc", encryptCredential(refreshed.accessJwt));
              if (refreshed.refreshJwt) store.set("blueskyRefreshJwtEnc", encryptCredential(refreshed.refreshJwt));
              if (refreshed.did) store.set("blueskyDid", refreshed.did);
              if (refreshed.handle) store.set("blueskyHandle", refreshed.handle);

              const retryPost = await bluesky.createImagePost({
                accessJwt: refreshed.accessJwt || bauth.accessJwt,
                did: refreshed.did || bauth.did,
                serviceUrl: refreshed.serviceUrl || bauth.serviceUrl,
                item: {
                  ...next,
                  tags: addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags,
                },
                postTextMode: blueskyPostTextMode,
                longPostMode: blueskyLongPostMode,
                safetyLevel: next.safetyLevel,
                useDescriptionAsAltText: blueskyUseDescriptionAsAltText,
                imageResizeOptions: blueskyImageResizeOptions,
                prependText: blueskyPrependText,
                appendText: blueskyAppendText,
              });
              const retryRemoteId = String(retryPost.uri || retryPost.cid || "").trim();
              if (!retryRemoteId) {
                throw new Error("Bluesky upload returned no post identifier after refresh.");
              }
              next.serviceStates.bluesky = {
                status: "done",
                remoteId: retryRemoteId,
                uploadedAt: new Date().toISOString(),
              };
              successfulServices += 1;
              logEventVerbose("INFO", "Uploaded to Bluesky after token refresh", { id: next.id, uri: retryPost.uri || "" });
            } catch (refreshErr) {
              const finalMsg = refreshErr?.message ? String(refreshErr.message) : String(refreshErr);
              if (isTransientNetworkError(finalMsg)) {
                applyTransientRetry(next.serviceStates, "bluesky", finalMsg, warningParts, errorParts, next.id);
              } else {
                next.serviceStates.bluesky = { status: "failed", lastError: finalMsg };
                errorParts.push(`Bluesky: ${finalMsg}`);
                logEvent("WARN", "Bluesky upload failed after token refresh", { id: next.id, error: finalMsg });
              }
            }
          } else {
            if (isTransientNetworkError(msg)) {
              applyTransientRetry(next.serviceStates, "bluesky", msg, warningParts, errorParts, next.id);
            } else {
              next.serviceStates.bluesky = { status: "failed", lastError: msg };
              errorParts.push(`Bluesky: ${msg}`);
              logEvent("WARN", "Bluesky upload failed", { id: next.id, error: msg });
            }
          }
        }
      }
    } else if (next.targetServices.includes("bluesky")) {
      successfulServices += 1;
    }

    if (next.targetServices.includes("pixelfed") && next.serviceStates?.pixelfed?.status !== "done") {
      if (!isPixelfedAuthed()) {
        const msg = "PixelFed target selected but PixelFed is not authorized.";
        next.serviceStates.pixelfed = { status: "failed", lastError: msg };
        errorParts.push(`PixelFed: ${msg}`);
      } else {
        const pauth = getPixelfedAuth();
        try {
          const mapped = pixelfed.mapPrivacyToVisibility(String(next.privacy || "private"));
          if (mapped.warning) warningParts.push(`PixelFed: ${mapped.warning}`);
          const pixelfedPostTextMode = String(store.get("pixelfedPostTextMode") || "merge_title_description_tags");
          const pixelfedUseDescriptionAsAltText = store.get("pixelfedUseDescriptionAsAltText") !== false;
          const pixelfedImageResizeOptions = {
            enabled: store.get("pixelfedImageResizeEnabled") === true,
            maxWidth: Number(store.get("pixelfedImageResizeMaxWidth") || 0),
            maxHeight: Number(store.get("pixelfedImageResizeMaxHeight") || 0),
          };
          const pixelfedInstanceLimitsCache = store.get("pixelfedInstanceLimitsCache") || {};
          const pixelfedPrependText = String(store.get("pixelfedPrependText") || "");
          const pixelfedAppendText = String(store.get("pixelfedAppendText") || "");
          const post = await pixelfed.createImagePost({
            instanceUrl: pauth.instanceUrl,
            accessToken: pauth.accessToken,
            item: {
              ...next,
              tags: addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags,
            },
            postTextMode: pixelfedPostTextMode,
            useDescriptionAsAltText: pixelfedUseDescriptionAsAltText,
            imageResizeOptions: pixelfedImageResizeOptions,
            instanceLimitsCache: pixelfedInstanceLimitsCache,
            onDiscoveredLimits: ({ instanceKey, limits, cachedAt }) => {
              const current = store.get("pixelfedInstanceLimitsCache") || {};
              current[String(instanceKey)] = { limits, cachedAt: Number(cachedAt) || Date.now() };
              store.set("pixelfedInstanceLimitsCache", current);
            },
            visibility: mapped.visibility,
            sensitive: Number(next.safetyLevel || 1) >= 2,
            prependText: pixelfedPrependText,
            appendText: pixelfedAppendText,
          });
          next.serviceStates.pixelfed = {
            status: "done",
            remoteId: post.url || post.id || "",
            uploadedAt: new Date().toISOString(),
          };
          pixelfedPostUrlForMastodonReshare = String(post.url || "").trim();
          successfulServices += 1;
          logEventVerbose("INFO", "Uploaded to PixelFed", { id: next.id, postId: post.id || "" });
        } catch (e) {
          const msg = e?.message ? String(e.message) : String(e);
          if (isTransientNetworkError(msg)) {
            applyTransientRetry(next.serviceStates, "pixelfed", msg, warningParts, errorParts, next.id);
          } else {
            next.serviceStates.pixelfed = { status: "failed", lastError: msg };
            errorParts.push(`PixelFed: ${msg}`);
            logEvent("WARN", "PixelFed upload failed", { id: next.id, error: msg });
          }
        }
      }
    } else if (next.targetServices.includes("pixelfed")) {
      const priorPixelfedRemoteId = String(next.serviceStates?.pixelfed?.remoteId || "").trim();
      if (/^https?:\/\//i.test(priorPixelfedRemoteId)) {
        pixelfedPostUrlForMastodonReshare = priorPixelfedRemoteId;
      }
      successfulServices += 1;
    }

    if (next.targetServices.includes("mastodon") && next.serviceStates?.mastodon?.status !== "done") {
      if (!isMastodonAuthed()) {
        const msg = "Mastodon target selected but Mastodon is not authorized.";
        next.serviceStates.mastodon = { status: "failed", lastError: msg };
        errorParts.push(`Mastodon: ${msg}`);
      } else {
        const mauth = getMastodonAuth();
        const pixelfedMastodonReshareEnabled = store.get("pixelfedMastodonReshareEnabled") !== false;
        const shouldReshareFromPixelfed =
          pixelfedMastodonReshareEnabled &&
          next.targetServices.includes("pixelfed");
        try {
          if (shouldReshareFromPixelfed) {
            const sourceUrl = String(pixelfedPostUrlForMastodonReshare || "").trim();
            if (!/^https?:\/\//i.test(sourceUrl)) {
              throw new Error("Mastodon reshare requires a PixelFed post URL, but none was available.");
            }
            const boost = await mastodon.reshareStatusByUrl({
              instanceUrl: mauth.instanceUrl,
              accessToken: mauth.accessToken,
              statusUrl: sourceUrl,
            });
            next.serviceStates.mastodon = {
              status: "done",
              remoteId: boost.url || boost.id || boost.resolvedStatusId || "",
              uploadedAt: new Date().toISOString(),
            };
            successfulServices += 1;
            logEvent("INFO", "Reshared PixelFed post to Mastodon", {
              id: next.id,
              sourceUrl,
              postId: boost.id || "",
              resolvedStatusId: boost.resolvedStatusId || "",
            });
          } else {
            const mapped = mastodon.mapPrivacyToVisibility(String(next.privacy || "private"));
            if (mapped.warning) warningParts.push(`Mastodon: ${mapped.warning}`);
            const mastodonPostTextMode = String(store.get("mastodonPostTextMode") || "merge_title_description_tags");
            const mastodonUseDescriptionAsAltText = store.get("mastodonUseDescriptionAsAltText") !== false;
            const mastodonImageResizeOptions = {
              enabled: store.get("mastodonImageResizeEnabled") === true,
              maxWidth: Number(store.get("mastodonImageResizeMaxWidth") || 0),
              maxHeight: Number(store.get("mastodonImageResizeMaxHeight") || 0),
            };
            const mastodonInstanceLimitsCache = store.get("mastodonInstanceLimitsCache") || {};
            const mastodonPrependText = String(store.get("mastodonPrependText") || "");
            const mastodonAppendText = String(store.get("mastodonAppendText") || "");
            const post = await mastodon.createImagePost({
              instanceUrl: mauth.instanceUrl,
              accessToken: mauth.accessToken,
              item: {
                ...next,
                tags: addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags,
              },
              postTextMode: mastodonPostTextMode,
              useDescriptionAsAltText: mastodonUseDescriptionAsAltText,
              imageResizeOptions: mastodonImageResizeOptions,
              instanceLimitsCache: mastodonInstanceLimitsCache,
              onDiscoveredLimits: ({ instanceKey, limits, cachedAt }) => {
                const current = store.get("mastodonInstanceLimitsCache") || {};
                current[String(instanceKey)] = { limits, cachedAt: Number(cachedAt) || Date.now() };
                store.set("mastodonInstanceLimitsCache", current);
              },
              visibility: mapped.visibility,
              sensitive: Number(next.safetyLevel || 1) >= 2,
              prependText: mastodonPrependText,
              appendText: mastodonAppendText,
            });
            next.serviceStates.mastodon = {
              status: "done",
              remoteId: post.url || post.id || "",
              uploadedAt: new Date().toISOString(),
            };
            successfulServices += 1;
            logEventVerbose("INFO", "Uploaded to Mastodon", { id: next.id, postId: post.id || "" });
          }
        } catch (e) {
          const rawMsg = e?.message ? String(e.message) : String(e);
          const missingScopeForReshare =
            shouldReshareFromPixelfed &&
            /outside the authorized scopes|insufficient scope|missing scope/i.test(rawMsg);
          const msg = missingScopeForReshare
            ? `${rawMsg} Re-authorize Mastodon with read:search and write:statuses (or broad read + write) to allow PixelFed reshares.`
            : rawMsg;
          if (isTransientNetworkError(msg)) {
            applyTransientRetry(next.serviceStates, "mastodon", msg, warningParts, errorParts, next.id);
          } else {
            next.serviceStates.mastodon = { status: "failed", lastError: msg };
            errorParts.push(`Mastodon: ${msg}`);
            logEvent("WARN", "Mastodon upload failed", { id: next.id, error: msg });
          }
        }
      }
    } else if (next.targetServices.includes("mastodon")) {
      successfulServices += 1;
    }

    if (next.targetServices.includes("lemmy") && (
      next.serviceStates?.lemmy?.status !== "done" || !String(next.serviceStates?.lemmy?.remoteId || "").trim()
    )) {
      if (!isLemmyAuthed()) {
        const msg = "Lemmy target selected but Lemmy is not authorized.";
        next.serviceStates.lemmy = { status: "failed", lastError: msg };
        errorParts.push(`Lemmy: ${msg}`);
      } else {
        const lauth = getLemmyAuth();
        const communityIds = getItemLemmyCommunityIds(next);
        if (!communityIds.length) {
          const msg = "Select a Lemmy community in the editor before uploading.";
          next.serviceStates.lemmy = { status: "failed", lastError: msg };
          errorParts.push(`Lemmy: ${msg}`);
        } else {
          try {
            const communityLabelCache = new Map();
            const lemmyInstanceHost = (() => {
              try {
                return new URL(String(lauth.instanceUrl || "")).host || String(lauth.instanceUrl || "");
              } catch {
                return String(lauth.instanceUrl || "");
              }
            })();
            const humanizeLemmyError = (rawMsg) => {
              const msg = String(rawMsg || "");
              if (/only_mods_can_post_in_community/i.test(msg)) {
                return "Only moderators can post in this community. (only_mods_can_post_in_community)";
              }
              if (/invalid_url/i.test(msg)) {
                return "Lemmy rejected the image URL as invalid. (invalid_url)";
              }
              return msg;
            };
            const describeCommunity = async (communityId) => {
              const key = String(communityId || "").trim();
              if (!key) return `community@${lemmyInstanceHost}`;
              if (communityLabelCache.has(key)) return communityLabelCache.get(key);

              let label = `community ${key}@${lemmyInstanceHost}`;
              try {
                const info = await lemmy.getCommunityInfo({
                  instanceUrl: lauth.instanceUrl,
                  accessToken: lauth.accessToken,
                  communityId: key,
                });
                const name = String(info?.name || key).trim();
                const title = String(info?.title || "").trim();
                let host = lemmyInstanceHost;
                try {
                  host = new URL(String(info?.actorId || "")).host || host;
                } catch {
                  // keep default instance host
                }
                label = title
                  ? `${title} (${name}@${host})`
                  : `${name}@${host}`;
              } catch {
                // keep fallback label
              }

              communityLabelCache.set(key, label);
              return label;
            };

            if (String(next.privacy || "private") !== "public") {
              warningParts.push(`Lemmy: visibility "${String(next.privacy || "private")}" is not supported and was not applied.`);
            }
            const lemmyPostTextMode = String(store.get("lemmyPostTextMode") || "merge_title_description_tags");
            const lemmyPrependText = String(store.get("lemmyPrependText") || "");
            const lemmyAppendText = String(store.get("lemmyAppendText") || "");
            const lemmyImageResizeOptions = {
              enabled: store.get("lemmyImageResizeEnabled") === true,
              maxWidth: Number(store.get("lemmyImageResizeMaxWidth") || 0),
              maxHeight: Number(store.get("lemmyImageResizeMaxHeight") || 0),
            };
            // If prior attempts suggest the image may be too large for the server, automatically
            // apply a conservative resize on this retry attempt so it has a real chance of succeeding.
            if (next.serviceStates?.lemmy?.possibleSizeLimit === true && !lemmyImageResizeOptions.enabled) {
              lemmyImageResizeOptions.enabled = true;
              if (!lemmyImageResizeOptions.maxWidth) lemmyImageResizeOptions.maxWidth = 2000;
              if (!lemmyImageResizeOptions.maxHeight) lemmyImageResizeOptions.maxHeight = 2000;
              logEventVerbose("INFO", "Lemmy: auto-applying resize due to possible image size limit", { id: next.id });
            }
            const lemmyInstanceLimitsCache = store.get("lemmyInstanceLimitsCache") || {};
            const lemmyInstanceUploadConfigCache = store.get("lemmyInstanceUploadConfigCache") || {};
            const communityIdSet = new Set(communityIds);
            const prevState = next.serviceStates?.lemmy || {};
            const originalCommunityId = getItemLemmyOriginalCommunityId(next, communityIds);
            const orderedCommunityIds = [originalCommunityId, ...communityIds.filter((communityId) => communityId !== originalCommunityId)];
            const completedCommunityIds = new Set(
              (Array.isArray(prevState.completedCommunityIds) ? prevState.completedCommunityIds : [])
                .map((communityId) => String(communityId || "").trim())
                .filter((communityId) => communityIdSet.has(communityId))
            );
            const permanentlyFailedCommunityIds = new Set(
              (Array.isArray(prevState.permanentlyFailedCommunityIds) ? prevState.permanentlyFailedCommunityIds : [])
                .map((communityId) => String(communityId || "").trim())
                .filter((communityId) => communityIdSet.has(communityId))
            );
            const firstFailedAt = prevState.firstFailedAt || new Date().toISOString();
            const MAX_LEMMY_AUTO_RETRIES = 8;
            let originalPostId = String(prevState.originalPostId || "").trim();
            let originalPostUrl = String(prevState.originalPostUrl || "").trim();
            if (!/^https?:\/\//i.test(originalPostUrl)) {
              const remoteCandidate = String(prevState.remoteId || "").trim();
              originalPostUrl = /^https?:\/\//i.test(remoteCandidate) ? remoteCandidate : "";
            }
            const itemForPost = {
              ...next,
              tags: addShutterQueueTag ? appendImplicitTagCsv(next.tags, "#ShutterQueue") : next.tags,
            };
            let sizeLimitHints = 0;
            let transientFailedCommunities = [];
            let stopRemainingCommunities = false;
            const markCommunityFailure = async (communityId, postMsg, mode) => {
              const isTransient = isLemmyTransientError(postMsg);
              const isPossibleSizeLimit = looksLikeLemmySizeLimitError(postMsg);
              if (isTransient) transientFailedCommunities.push(String(communityId || ""));
              else permanentlyFailedCommunityIds.add(String(communityId || ""));
              if (isPossibleSizeLimit) sizeLimitHints += 1;
              const communityLabel = await describeCommunity(communityId);
              const readableMsg = humanizeLemmyError(postMsg);
              warningParts.push(`Lemmy (${communityLabel}): ${readableMsg}`);
              logEvent("WARN", mode === "crosspost" ? "Lemmy cross-post failed for community" : "Lemmy upload failed for community", {
                id: next.id,
                communityId,
                communityLabel,
                error: postMsg,
              });
              if (/invalid_url/i.test(postMsg)) {
                stopRemainingCommunities = true;
                warningParts.push(
                  mode === "crosspost"
                    ? "Lemmy: stopped remaining cross-post attempts after invalid_url (fatal URL validation error)."
                    : "Lemmy: stopped remaining community attempts after invalid_url (fatal URL validation error)."
                );
              }
              return isTransient;
            };

            if (!completedCommunityIds.has(originalCommunityId) && !permanentlyFailedCommunityIds.has(originalCommunityId)) {
              try {
                const post = await lemmy.createImagePost({
                  instanceUrl: lauth.instanceUrl,
                  accessToken: lauth.accessToken,
                  item: itemForPost,
                  communityId: originalCommunityId,
                  postTextMode: lemmyPostTextMode,
                  prependText: lemmyPrependText,
                  appendText: lemmyAppendText,
                  nsfw: Number(next.safetyLevel || 1) >= 2,
                  imageResizeOptions: lemmyImageResizeOptions,
                  instanceLimitsCache: lemmyInstanceLimitsCache,
                  onDiscoveredLimits: ({ instanceKey, limits, cachedAt }) => {
                    const current = store.get("lemmyInstanceLimitsCache") || {};
                    current[String(instanceKey)] = { limits, cachedAt: Number(cachedAt) || Date.now() };
                    store.set("lemmyInstanceLimitsCache", current);
                  },
                  uploadConfigCache: lemmyInstanceUploadConfigCache,
                  onDiscoveredUploadConfig: ({ instanceKey, apiPath, fieldName, cachedAt }) => {
                    const current = store.get("lemmyInstanceUploadConfigCache") || {};
                    current[String(instanceKey)] = { apiPath, fieldName, cachedAt: Number(cachedAt) || Date.now() };
                    store.set("lemmyInstanceUploadConfigCache", current);
                  },
                });
                originalPostId = String(post.id || "").trim();
                originalPostUrl = String(post.postUrl || "").trim();
                if (!originalPostId) {
                  throw new Error("Lemmy original post returned no post identifier.");
                }
                if (!originalPostUrl) {
                  throw new Error("Lemmy original post returned no usable post URL for cross-posting.");
                }
                completedCommunityIds.add(originalCommunityId);
                logEventVerbose("INFO", "Uploaded original post to Lemmy", { id: next.id, postId: originalPostId, communityId: originalCommunityId });
              } catch (postErr) {
                const postMsg = postErr?.message ? String(postErr.message) : String(postErr);
                await markCommunityFailure(originalCommunityId, postMsg, "original");
              }
            }

            if (completedCommunityIds.has(originalCommunityId) && originalPostUrl) {
              for (const communityId of orderedCommunityIds.slice(1)) {
                if (stopRemainingCommunities) break;
                if (completedCommunityIds.has(communityId) || permanentlyFailedCommunityIds.has(communityId)) continue;
                try {
                  const post = await lemmy.createCrossPost({
                    instanceUrl: lauth.instanceUrl,
                    accessToken: lauth.accessToken,
                    item: itemForPost,
                    communityId,
                    originalPostUrl,
                    postTextMode: lemmyPostTextMode,
                    prependText: lemmyPrependText,
                    appendText: lemmyAppendText,
                    nsfw: Number(next.safetyLevel || 1) >= 2,
                  });
                  completedCommunityIds.add(communityId);
                  logEventVerbose("INFO", "Cross-posted to Lemmy community", { id: next.id, postId: post.id || "", communityId, originalPostUrl });
                } catch (postErr) {
                  const postMsg = postErr?.message ? String(postErr.message) : String(postErr);
                  await markCommunityFailure(communityId, postMsg, "crosspost");
                  if (/invalid_url/i.test(postMsg)) {
                    for (const remainingCommunityId of orderedCommunityIds.slice(1)) {
                      if (completedCommunityIds.has(remainingCommunityId)) continue;
                      if (remainingCommunityId === communityId) continue;
                      permanentlyFailedCommunityIds.add(remainingCommunityId);
                    }
                  }
                }
              }
            }

            const remainingRetryCommunityIds = orderedCommunityIds.filter(
              (communityId) => !completedCommunityIds.has(communityId) && !permanentlyFailedCommunityIds.has(communityId)
            );
            const remoteId = String(originalPostUrl || originalPostId || prevState.remoteId || "").trim();

            if (!completedCommunityIds.has(originalCommunityId)) {
              if (remainingRetryCommunityIds.includes(originalCommunityId)) {
                const retryCount = (Number(prevState.retryCount) || 0) + 1;
                if (retryCount > MAX_LEMMY_AUTO_RETRIES) {
                  throw new Error(
                    `Lemmy image upload failed after ${MAX_LEMMY_AUTO_RETRIES} automatic retries. ` +
                    `If this keeps happening, try re-authorizing Lemmy in Settings. ` +
                    `First failed: ${firstFailedAt}.`
                  );
                }
                const retryAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                const possibleSizeLimit = sizeLimitHints > 0;
                next.serviceStates.lemmy = {
                  status: "retry",
                  retryAfter,
                  retryCount,
                  firstFailedAt,
                  lastError: possibleSizeLimit
                    ? "Image may be too large for the server — will retry with automatic resizing."
                    : "Server temporarily unavailable.",
                  possibleSizeLimit,
                  remoteId,
                  originalCommunityId,
                  originalPostId,
                  originalPostUrl,
                  completedCommunityIds: Array.from(completedCommunityIds),
                  permanentlyFailedCommunityIds: Array.from(permanentlyFailedCommunityIds),
                };
                if (possibleSizeLimit) {
                  warningParts.push(`Lemmy: Upload failed — the image may be too large for the server (received 502/connection errors). Will retry with automatic resizing at ${retryAfter}. (attempt ${retryCount} of ${MAX_LEMMY_AUTO_RETRIES}) Tip: keeping Lemmy image resizing at 2000x2000 usually avoids this.`);
                } else {
                  warningParts.push(`Lemmy: Server temporarily unavailable — will retry automatically at ${retryAfter}. (attempt ${retryCount} of ${MAX_LEMMY_AUTO_RETRIES})`);
                }
                logEvent("WARN", "Lemmy upload will retry (original post failed transiently)", { id: next.id, retryCount, maxRetries: MAX_LEMMY_AUTO_RETRIES, possibleSizeLimit });
              } else {
                throw new Error("Failed to create the original Lemmy post.");
              }
            } else if (remainingRetryCommunityIds.length) {
              const retryCount = (Number(prevState.retryCount) || 0) + 1;
              if (retryCount > MAX_LEMMY_AUTO_RETRIES) {
                next.serviceStates.lemmy = {
                  status: "done",
                  remoteId,
                  uploadedAt: new Date().toISOString(),
                  originalCommunityId,
                  originalPostId,
                  originalPostUrl,
                  completedCommunityIds: Array.from(completedCommunityIds),
                  permanentlyFailedCommunityIds: Array.from(new Set([...permanentlyFailedCommunityIds, ...remainingRetryCommunityIds])),
                };
                successfulServices += 1;
                warningParts.push(`Lemmy: cross-posting gave up on ${remainingRetryCommunityIds.length} remaining ${remainingRetryCommunityIds.length === 1 ? "community" : "communities"} after ${MAX_LEMMY_AUTO_RETRIES} automatic retries.`);
                warningParts.push(`Lemmy: posted to ${completedCommunityIds.size}/${communityIds.length} communities.`);
              } else {
                const retryAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                next.serviceStates.lemmy = {
                  status: "retry",
                  retryAfter,
                  retryCount,
                  firstFailedAt,
                  lastError: "Some Lemmy cross-posts are still retrying.",
                  remoteId,
                  originalCommunityId,
                  originalPostId,
                  originalPostUrl,
                  completedCommunityIds: Array.from(completedCommunityIds),
                  permanentlyFailedCommunityIds: Array.from(permanentlyFailedCommunityIds),
                };
                successfulServices += 1;
                warningParts.push(`Lemmy: posted to ${completedCommunityIds.size}/${communityIds.length} communities.`);
                warningParts.push(`Lemmy: original post is up. Will retry ${remainingRetryCommunityIds.length} remaining ${remainingRetryCommunityIds.length === 1 ? "community" : "communities"} automatically at ${retryAfter}. (attempt ${retryCount} of ${MAX_LEMMY_AUTO_RETRIES})`);
                logEvent("WARN", "Lemmy cross-posts will retry", { id: next.id, retryCount, maxRetries: MAX_LEMMY_AUTO_RETRIES, remainingCommunities: remainingRetryCommunityIds.length });
              }
            } else {
              if (!remoteId) {
                throw new Error("Lemmy upload returned no post identifier.");
              }

              next.serviceStates.lemmy = {
                status: "done",
                remoteId,
                uploadedAt: new Date().toISOString(),
                originalCommunityId,
                originalPostId,
                originalPostUrl,
                completedCommunityIds: Array.from(completedCommunityIds),
                permanentlyFailedCommunityIds: Array.from(permanentlyFailedCommunityIds),
              };
              successfulServices += 1;
              if (permanentlyFailedCommunityIds.size > 0) {
                warningParts.push(`Lemmy: posted to ${completedCommunityIds.size}/${communityIds.length} communities.`);
              }
            }
          } catch (e) {
            const msg = e?.message ? String(e.message) : String(e);
            next.serviceStates.lemmy = { status: "failed", lastError: msg };
            errorParts.push(`Lemmy: ${msg}`);
            logEvent("WARN", "Lemmy upload failed", { id: next.id, error: msg });
          }
        }
      }
    } else if (next.targetServices.includes("lemmy")) {
      successfulServices += 1;
    }

    if (!next.targetServices.length) {
      const msg = "No target services selected for this item.";
      next.status = "failed";
      next.lastError = msg;
      queue.saveQueue(q);
      logEvent("WARN", `${path.basename(next.photoPath || "")} upload failed: no target services selected`);
      logEventVerbose("INFO", "Upload item outcome", {
        id: next.id,
        outcome: "failed",
        finalStatus: next.status,
        successfulServices: 0,
        retryingServices: 0,
        warningCount: 0,
        errorCount: 1,
        services: {},
        message: msg,
      });
      return { ok: false, error: msg };
    }

    if (hasExplicitLocationData && !hasLocationSupportingTarget) {
      warningParts.push("Location data was set on this item, but none of the selected platforms support location tagging. The post was uploaded without location data.");
    }

    if (successfulServices > 0) {
      next.scheduledUploadAt = "";
      // Clear sticky global errors once any target service uploads successfully.
      store.set("lastError", "");
    }

    const combinedMessages = [...warningParts, ...errorParts].filter(Boolean);

    // Count services queued for automatic retry (transient server/network errors)
    const retryingServices = (next.targetServices || []).filter(
      svc => next.serviceStates && next.serviceStates[svc] && next.serviceStates[svc].status === "retry"
    ).length;
    const perServiceStatus = {};
    for (const svc of (next.targetServices || [])) {
      perServiceStatus[String(svc)] = String(next.serviceStates?.[svc]?.status || "not_attempted");
    }
    const logUploadOutcome = async (outcome, extra = {}) => {
      await logVerboseUploadFileReleaseProbe({
        itemId: next.id,
        photoPath: next.photoPath,
        outcome,
        finalStatus: next.status,
        successfulServices,
        retryingServices,
      });

      // Always-on human-readable summary line per outcome type.
      const filename = path.basename(next.photoPath || "");
      if (outcome === "done" || outcome === "done_with_notice") {
        const succeededNames = Object.entries(perServiceStatus)
          .filter(([, v]) => v === "done")
          .map(([k]) => SERVICE_DISPLAY_NAMES[k] || k);
        if (succeededNames.length) {
          logEvent("INFO", `${filename} uploaded to ${formatServiceList(succeededNames)}`);
        }
      } else if (outcome === "done_with_warnings") {
        const succeededNames = Object.entries(perServiceStatus)
          .filter(([, v]) => v === "done")
          .map(([k]) => SERVICE_DISPLAY_NAMES[k] || k);
        const warnMsg = extra.message || warningParts.filter(Boolean).join(" | ");
        if (succeededNames.length) {
          logEvent("INFO", `${filename} uploaded to ${formatServiceList(succeededNames)} (with warnings)`, { message: warnMsg });
        } else {
          logEvent("WARN", `${filename} upload completed with warnings`, { message: warnMsg });
        }
      } else if (outcome === "retry_pending") {
        logEvent("INFO", `${filename} upload will retry automatically`, { message: extra.message || "" });
      } else if (outcome === "failed") {
        logEvent("WARN", `${filename} upload failed for all platforms`, { message: extra.message || "" });
      }

      // Detailed breakdown is diagnostic (verbose-only).
      logEventVerbose("INFO", "Upload item outcome", {
        id: next.id,
        outcome,
        finalStatus: next.status,
        successfulServices,
        retryingServices,
        warningCount: warningParts.length,
        errorCount: errorParts.length,
        services: perServiceStatus,
        ...extra,
      });
    };

    if (successfulServices === 0 && retryingServices > 0) {
      // No services succeeded yet, but transient failures will retry automatically (e.g. Lemmy server outage).
      // Show as yellow "retry" status — not a permanent failure.
      next.status = "retry";
      next.lastError = warningParts.filter(Boolean).join(" | ") || "Server temporarily unavailable; will retry automatically.";
      queue.saveQueue(q);
      await logUploadOutcome("retry_pending", { message: next.lastError });
      return { ok: true, warnings: warningParts.filter(Boolean) };
    }

    if (successfulServices === 0) {
      const msg = combinedMessages.join(" | ") || "Upload failed for all target services.";
      next.status = "failed";
      next.lastError = msg;
      store.set("lastError", msg);
      queue.saveQueue(q);
      await logUploadOutcome("failed", { message: msg });
      return { ok: false, error: msg };
    }

    if (combinedMessages.length) {
      if (isLocationUnsupportedOnlyWarning(warningParts, errorParts)) {
        // Capability-only location notice: upload succeeded on all targets, so keep queue status as done.
        next.status = "done";
        next.lastError = warningParts.join(" | ");
        queue.saveQueue(q);
        store.set("lastError", "");
        await logUploadOutcome("done_with_notice", { message: next.lastError });
        return { ok: true, photoId: next.photoId || "", warnings: combinedMessages };
      }
      next.status = "done_warn";
      next.lastError = combinedMessages.join(" | ");
      queue.saveQueue(q);
      await logUploadOutcome("done_with_warnings", { message: next.lastError });
      return { ok: true, photoId: next.photoId || "", warnings: combinedMessages };
    }

    next.status = "done";
    next.lastError = "";
    queue.saveQueue(q);
    store.set("lastError", "");
    await logUploadOutcome("done");
    return { ok: true, photoId: next.photoId || "" };
  } catch (err) {
    const msg = err?.message ? String(err.message) : String(err);
    store.set("lastError", msg);
    logEvent("ERROR", "Upload failed", { error: msg });

    const q = queue.loadQueue();
    const next = q.find(it => it.status === "uploading") || q.find(it => it.status === "pending");
    if (next) {
      next.status = "failed";
      next.lastError = msg;
      queue.saveQueue(q);
      logEventVerbose("INFO", "Upload item outcome", {
        id: next.id,
        outcome: "failed",
        finalStatus: next.status,
        successfulServices: 0,
        retryingServices: 0,
        warningCount: 0,
        errorCount: 1,
        services: {},
        message: msg,
      });
    }
    return { ok: false, error: msg };
  } finally {
    uploadLock = false;
  }
}

ipcMain.handle("upload:nowOne", async (_e, options) => uploadNowOneInternal(options || {}));

let schedTimer = null;
let lemmyRetryTimer = null; // runs processLemmyRetries independently of the upload scheduler
let transientRetryTimer = null; // runs processTransientRetries for Tumblr/Bluesky/PixelFed/Mastodon
let uploadLock = false; // prevents overlapping uploads (fixes duplicate uploads)

let batchRunProgress = {
  totalServiceUnits: 0,
  completedServiceUnits: 0,
  currentItemId: "",
  currentServiceId: "",
  currentServiceLoadedKB: 0,
  currentServiceTotalKB: 0,
};

function resetBatchRunProgress() {
  batchRunProgress = {
    totalServiceUnits: 0,
    completedServiceUnits: 0,
    currentItemId: "",
    currentServiceId: "",
    currentServiceLoadedKB: 0,
    currentServiceTotalKB: 0,
  };
}

function listBatchEligiblePendingItems(queueItems, maxItems, nowMs) {
  const out = [];
  const limit = Math.max(1, Math.min(999, Math.round(Number(maxItems || 1))));
  for (const it of Array.isArray(queueItems) ? queueItems : []) {
    if (out.length >= limit) break;
    if (!it || it.status !== "pending") continue;
    const scheduleMs = getManualScheduleMs(it);
    if (scheduleMs != null && scheduleMs > nowMs) continue;
    out.push(it);
  }
  return out;
}

function startBatchRunProgress(items) {
  const plannedItems = Array.isArray(items) ? items : [];
  let totalServiceUnits = 0;
  for (const it of plannedItems) {
    const targetServices = normalizeTargetServicesForItem(it);
    totalServiceUnits += Math.max(0, targetServices.length);
  }
  batchRunProgress = {
    totalServiceUnits,
    completedServiceUnits: 0,
    currentItemId: "",
    currentServiceId: "",
    currentServiceLoadedKB: 0,
    currentServiceTotalKB: 0,
  };
}

function beginBatchServiceProgress(itemId, serviceId) {
  if (!store.get("batchRunActive")) return;
  batchRunProgress.currentItemId = String(itemId || "");
  batchRunProgress.currentServiceId = String(serviceId || "");
  batchRunProgress.currentServiceLoadedKB = 0;
  batchRunProgress.currentServiceTotalKB = 0;
}

function updateBatchServiceProgressBytes(itemId, serviceId, loadedBytes, totalBytes) {
  if (!store.get("batchRunActive")) return;
  if (batchRunProgress.currentItemId !== String(itemId || "")) return;
  if (batchRunProgress.currentServiceId !== String(serviceId || "")) return;
  const loaded = Number(loadedBytes);
  const total = Number(totalBytes);
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return;
  const loadedKB = Math.max(0, Math.floor(loaded / 1024));
  const totalKB = Math.max(1, Math.ceil(total / 1024));
  batchRunProgress.currentServiceLoadedKB = Math.min(loadedKB, totalKB);
  batchRunProgress.currentServiceTotalKB = totalKB;
}

function clearBatchServiceProgress(itemId, serviceId) {
  if (batchRunProgress.currentItemId !== String(itemId || "")) return;
  if (batchRunProgress.currentServiceId !== String(serviceId || "")) return;
  batchRunProgress.currentItemId = "";
  batchRunProgress.currentServiceId = "";
  batchRunProgress.currentServiceLoadedKB = 0;
  batchRunProgress.currentServiceTotalKB = 0;
}

function completeBatchServiceProgress(itemId, serviceId) {
  if (!store.get("batchRunActive")) return;
  clearBatchServiceProgress(itemId, serviceId);
  batchRunProgress.completedServiceUnits = Math.max(0, Number(batchRunProgress.completedServiceUnits || 0) + 1);
  if (batchRunProgress.totalServiceUnits > 0) {
    batchRunProgress.completedServiceUnits = Math.min(batchRunProgress.completedServiceUnits, batchRunProgress.totalServiceUnits);
  }
}

// Retries Lemmy uploads that failed with transient server/network errors (502, 503, socket hang-up, etc).
// Called on every scheduler tick so retries happen approximately hourly, independent of upload batch schedule.
// Handles scheduled retries for transient platform failures: Tumblr, Bluesky, PixelFed, Mastodon.
// Runs on a 10-second timer (same as processLemmyRetries) and re-triggers the full upload
// for any item that has a past-due "retry" service state on any of those platforms.
async function processTransientRetries() {
  if (uploadLock) return;
  const now = Date.now();
  const q = queue.loadQueue();
  const RETRYABLE_STATUSES = new Set(["done_warn", "retry", "failed", "done", "pending", "uploading"]);
  const RETRY_PLATFORMS = ["tumblr", "bluesky", "pixelfed", "mastodon"];
  const dueItems = q.filter(it => {
    if (!RETRYABLE_STATUSES.has(it.status)) return false;
    return RETRY_PLATFORMS.some(svc => {
      const ss = it.serviceStates && it.serviceStates[svc];
      if (!ss || ss.status !== "retry") return false;
      const retryAt = ss.retryAfter ? new Date(ss.retryAfter).getTime() : 0;
      return retryAt <= now;
    });
  });
  if (!dueItems.length) return;
  logEventVerbose("INFO", "processTransientRetries: found due items", { count: dueItems.length });

  for (const item of dueItems.slice(0, 2)) {
    const liveQ = queue.loadQueue();
    const liveItem = liveQ.find(it => it.id === item.id);
    if (!liveItem) continue;
    if (!RETRYABLE_STATUSES.has(liveItem.status)) continue;
    const hasDue = RETRY_PLATFORMS.some(svc => {
      const ss = liveItem.serviceStates && liveItem.serviceStates[svc];
      if (!ss || ss.status !== "retry") return false;
      const retryAt = ss.retryAfter ? new Date(ss.retryAfter).getTime() : 0;
      return retryAt <= Date.now();
    });
    if (!hasDue) continue;
    liveItem.status = "pending";
    queue.saveQueue(liveQ);
    logEvent("INFO", "Retrying upload after transient error", { id: liveItem.id });
    try {
      await uploadNowOneInternal({ itemId: liveItem.id, reason: "transient_retry" });
    } catch (_) {
      // uploadNowOneInternal handles its own errors and updates queue state
    }
  }
}

async function processLemmyRetries() {
  if (uploadLock) return;
  const now = Date.now();
  const q = queue.loadQueue();
  // Include "uploading" to recover items that were stuck mid-upload due to an app crash.
  // uploadLock=false guarantees no active upload is running, so these are stale leftovers.
  // "group_only" items are excluded — they are Flickr-only and have no Lemmy state.
  const RETRYABLE_STATUSES = new Set(["done_warn", "retry", "failed", "done", "pending", "uploading"]);
  const dueItems = q.filter(it => {
    if (!RETRYABLE_STATUSES.has(it.status)) return false;
    const ls = it.serviceStates && it.serviceStates.lemmy;
    if (!ls || ls.status !== "retry") return false;
    const retryAt = ls.retryAfter ? new Date(ls.retryAfter).getTime() : 0;
    return retryAt <= now;
  });
  if (!dueItems.length) return;
  logEventVerbose("INFO", "processLemmyRetries: found due items", { count: dueItems.length });

  for (const item of dueItems.slice(0, 2)) {
    // Reload queue to get fresh state before modifying
    const liveQ = queue.loadQueue();
    const liveItem = liveQ.find(it => it.id === item.id);
    if (!liveItem) continue;
    if (!RETRYABLE_STATUSES.has(liveItem.status)) continue;
    const ls = liveItem.serviceStates && liveItem.serviceStates.lemmy;
    if (!ls || ls.status !== "retry") continue;
    const retryAt = ls.retryAfter ? new Date(ls.retryAfter).getTime() : 0;
    if (retryAt > Date.now()) continue;

    // Reset Lemmy service state so uploadNowOneInternal re-enters the Lemmy upload block.
    // Keep status as "retry" (not "failed") to maintain the ↻ chip state during the upload window.
    // The Lemmy upload guard checks !== "done", so "retry" still allows re-entry.
    // Set retryAfter to now so the display always shows a concrete timestamp ("overdue") while uploading.
    liveItem.serviceStates.lemmy = {
      ...ls,
      status: "retry",
      retryAfter: new Date().toISOString(),
      retryCount: ls.retryCount || 0,
      firstFailedAt: ls.firstFailedAt,
      lastError: ls.lastError,
    };
    liveItem.status = "pending"; // uploadNowOneInternal requires "pending" or "failed"
    queue.saveQueue(liveQ);
    logEvent("INFO", "Retrying Lemmy upload after transient error", { id: liveItem.id, retryCount: ls.retryCount || 0 });

    try {
      await uploadNowOneInternal({ itemId: liveItem.id, reason: "lemmy_retry" });
    } catch (_) {
      // uploadNowOneInternal handles its own errors and updates queue state
    }
  }
}


async function tickScheduler() {
  if (!store.get("schedulerOn")) return;
  logEventVerbose("DEBUG", "tickScheduler: tick", { flickrAuthed: isFlickrAuthed() });

  // Always process due group retries (independent of upload schedule).
  // This allows 1h/6h/12h/24h backoff to work even when upload interval is longer.
  try {
    if (isFlickrAuthed()) {
      const auth = getFlickrAuth();
      await processDueGroupRetries({
        apiKey: auth.apiKey,
        apiSecret: auth.apiSecret,
        token: auth.token,
        tokenSecret: auth.tokenSecret,
        maxAttempts: 1
      });
    } else {
      logEventVerbose("DEBUG", "tickScheduler: skipping group retries (Flickr not authed)");
    }
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    logEvent("WARN", "Group retry processing failed", { error: msg });
  }

  // Always retry Lemmy uploads that failed due to transient server/network errors.
  // NOTE: Lemmy retries are handled by a dedicated lemmyRetryTimer (set at app launch),
  // independent of the scheduler state. Do not call processLemmyRetries() here.

  if (!uploadLock) {
    const q = queue.loadQueue();
    const dueManual = getDueManualScheduledPendingItem(q, Date.now());
    if (dueManual) {
      try {
        await uploadNowOneInternal({ itemId: dueManual.id, reason: "manual_scheduled" });
      } catch (_) {
        // keep scheduler alive; uploadNowOneInternal already logs and updates item status
      }
      return;
    }
  }

  const nextRunAt = store.get("nextRunAt");
  if (!nextRunAt) return;

  const now = Date.now();
  const t = new Date(nextRunAt).getTime();
  if (now < t) return;

  // If we are outside allowed windows/days, bump nextRunAt forward and do nothing.
  const bumped = bumpToNextAllowed(new Date(now));
  if (bumped.getTime() - now > 30 * 1000) {
    store.set("nextRunAt", bumped.toISOString());
    return;
  }

  const h = Number(store.get("intervalHours") || 24);
  // Set nextRunAt immediately so we don’t retrigger during a long upload
  scheduleNext(h);
  if (uploadLock) return;
  // First, process any due group retries (even if there are no pending uploads)
  try {
    if (isFlickrAuthed()) {
      const auth = getFlickrAuth();
      await processDueGroupRetries({
        apiKey: auth.apiKey,
        apiSecret: auth.apiSecret,
        token: auth.token,
        tokenSecret: auth.tokenSecret,
        maxAttempts: 5
      });
    }
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    logEvent("WARN", "Group retry processing failed", { error: msg });
  }
  const bs = Math.max(1, Math.min(999, Math.round(Number(store.get("uploadBatchSize") || 1))));
  const qForBatch = queue.loadQueue();
  const plannedBatchItems = listBatchEligiblePendingItems(qForBatch, bs, Date.now());
  // Mark an upload batch as active so the UI can display "current batch" instead of the nextRunAt time.
  store.set("batchRunActive", true);
  store.set("batchRunStartedAt", new Date(Date.now()).toISOString());
  store.set("batchRunSize", bs);
  startBatchRunProgress(plannedBatchItems);
  const uploadedIds = [];
  try {
    for (let i = 0; i < bs; i++) {
      const itemsBefore = queue.loadQueue().filter(it => it.status === "pending");
      const res = await uploadNowOneInternal();
      // Stop if nothing left to upload.
      if (res && res.message && String(res.message).includes("No pending items")) break;
      // Track which item transitioned out of pending (i.e. was processed this iteration).
      if (res && res.ok !== false) {
        const itemsAfter = queue.loadQueue();
        const beforeIds = new Set(itemsBefore.map(it => String(it.id || "")));
        for (const it of itemsAfter) {
          if (beforeIds.has(String(it.id || "")) && (it.status === "done" || it.status === "done_warn")) {
            uploadedIds.push(String(it.id || ""));
          }
        }
      }
    }
  } finally {
    store.set("batchRunActive", false);
    resetBatchRunProgress();
  }

  // Post-upload action: remove or delete successfully uploaded items.
  if (uploadedIds.length > 0) {
    const afterAction = String(store.get("afterUploadAction") || "nothing");
    if (afterAction === "remove" || afterAction === "delete") {
      try {
        const qAfter = queue.loadQueue();
        const byId = new Map(qAfter.map(it => [String(it.id || ""), it]));

        // Only act on items where ALL targeted services successfully uploaded.
        // Flickr group-add retries in groupAddStates do NOT count as upload errors,
        // but any serviceState that is not "done" means the upload itself had an error.
        const eligibleIds = uploadedIds.filter(id => {
          const it = byId.get(id);
          if (!it) return false;
          const status = it.status;
          if (status !== "done" && status !== "done_warn") return false;
          const targets = Array.isArray(it.targetServices) ? it.targetServices : [];
          for (const svc of targets) {
            const ss = it.serviceStates && it.serviceStates[svc];
            if (!ss || ss.status !== "done") return false;
          }
          return true;
        });

        if (eligibleIds.length === 0) return;

        // Items with pending Flickr group-add retries must be detached to group_only
        // so the retry queue continues to work after removal from the main queue.
        // Items without pending group retries can be fully removed.
        const detachIds = [];
        const fullyRemoveIds = [];
        for (const id of eligibleIds) {
          const it = byId.get(id);
          if (!it) continue;
          const hasPendingGroupRetries = it.groupAddStates &&
            Object.values(it.groupAddStates).some(st => st?.status === "retry");
          if (hasPendingGroupRetries) {
            detachIds.push(id);
          } else {
            fullyRemoveIds.push(id);
          }
        }

        if (afterAction === "remove") {
          if (detachIds.length > 0) await queue.detachToGroupOnly(detachIds);
          if (fullyRemoveIds.length > 0) await queue.removeIds(fullyRemoveIds);
          logEvent("INFO", `After-upload action: removed ${eligibleIds.length} item(s) from queue (detached: ${detachIds.length}, removed: ${fullyRemoveIds.length}).`);
        } else if (afterAction === "delete") {
          // Collect paths for all eligible items (both detach and fully-remove sets).
          const photoPaths = [];
          const seen = new Set();
          for (const id of eligibleIds) {
            const it = byId.get(id);
            if (!it) continue;
            const p = resolvePhotoPathOnDisk(it.photoPath);
            if (!p || seen.has(p)) continue;
            seen.add(p);
            photoPaths.push(p);
          }
          const trashResult = await trash.movePathsToTrash(photoPaths, {
            trashItem: (photoPath) => shell.trashItem(photoPath),
            fallbackTrashItem: process.platform === "win32" ? (photoPath) => moveToRecycleBinViaPowerShell(photoPath) : null,
            maxAttempts: 5,
            retryDelayMs: 180,
            fallbackMaxAttempts: 3,
            fallbackRetryDelayMs: 250,
            enableFinalGraceRetry: true,
          });
          const failedPathSet = new Set(
            (Array.isArray(trashResult?.failed) ? trashResult.failed : [])
              .map((f) => String(f?.photoPath || "").trim())
              .filter(Boolean)
          );
          // Only act on items whose files were successfully trashed (or had no file on disk).
          const trashedDetachIds = detachIds.filter(id => {
            const it = byId.get(id);
            if (!it) return true;
            const p = resolvePhotoPathOnDisk(it.photoPath);
            return !p || !failedPathSet.has(p);
          });
          const trashedRemoveIds = fullyRemoveIds.filter(id => {
            const it = byId.get(id);
            if (!it) return true;
            const p = resolvePhotoPathOnDisk(it.photoPath);
            return !p || !failedPathSet.has(p);
          });
          if (trashedDetachIds.length > 0) await queue.detachToGroupOnly(trashedDetachIds);
          if (trashedRemoveIds.length > 0) await queue.removeIds(trashedRemoveIds);
          const totalActed = trashedDetachIds.length + trashedRemoveIds.length;
          logEvent("INFO", `After-upload action: deleted files and removed ${totalActed} item(s) from queue (detached: ${trashedDetachIds.length}, removed: ${trashedRemoveIds.length}, trash-failed: ${trashResult?.failedCount || 0}).`);
        }
      } catch (e) {
        logEvent("WARN", `After-upload action (${afterAction}) failed`, { error: String(e?.message || e) });
      }
    }
  }
}

ipcMain.handle("sched:start", async (_e, { intervalHours, uploadImmediately, firstRunAt, settings }) => {
  const h = Math.max(1, Math.min(168, Math.round(Number(intervalHours || 24))));
  store.set("intervalHours", h);
  if (settings) {
    store.set("timeWindowEnabled", Boolean(settings.timeWindowEnabled));
    store.set("windowStart", settings.windowStart || "07:00");
    store.set("windowEnd", settings.windowEnd || "22:00");
    store.set("daysEnabled", Boolean(settings.daysEnabled));
    store.set("allowedDays", Array.isArray(settings.allowedDays) ? settings.allowedDays : [1,2,3,4,5]);
    store.set("resumeOnLaunch", Boolean(settings.resumeOnLaunch));
    const bs = Math.max(1, Math.min(999, Math.round(Number(settings.uploadBatchSize || store.get("uploadBatchSize") || 1))));
    store.set("uploadBatchSize", bs);
  }
  store.set("schedulerOn", true);
  if (firstRunAt) {
    // User chose a specific first-run time — honour it directly (apply window/day bump)
    const requested = new Date(firstRunAt);
    if (Number.isFinite(requested.getTime())) {
      const bumped = bumpToNextAllowed(requested);
      const skip = Boolean(store.get("skipOvernight"));
      const next = skip ? nextAllowedTime(bumped) : bumped;
      store.set("nextRunAt", next.toISOString());
    } else {
      scheduleNext(h); // fallback if invalid ISO
    }
  } else {
    scheduleNext(uploadImmediately ? 0 : h);
  }
  if (schedTimer) clearInterval(schedTimer);
  schedTimer = setInterval(() => tickScheduler().catch(() => {}), 600000);
  runImmediateGroupRetrySweep("scheduler_start").catch(() => {});
  updateTrayIcon();
  logEvent("INFO", "Scheduler started", {
    intervalHours: h,
    uploadImmediately: Boolean(uploadImmediately),
    firstRunAt: firstRunAt || null,
    uploadBatchSize: Number(store.get("uploadBatchSize") || 1),
    resumeOnLaunch: Boolean(store.get("resumeOnLaunch")),
  });
  return { ok: true };
});

ipcMain.handle("bluesky:auth:start", async () => {
  const identifier = String(store.get("blueskyIdentifier") || "").trim();
  const appPassword = decryptCredential(store.get("blueskyAppPasswordEnc") || "");
  const serviceUrl = String(store.get("blueskyServiceUrl") || bluesky.DEFAULT_BSKY_SERVICE);
  if (!identifier || !appPassword) throw new Error("Missing Bluesky identifier/app password");

  const session = await bluesky.createSession({ identifier, appPassword, serviceUrl });
  store.set("blueskyAccessJwtEnc", encryptCredential(session.accessJwt));
  store.set("blueskyRefreshJwtEnc", encryptCredential(session.refreshJwt));
  store.set("blueskyDid", session.did || "");
  store.set("blueskyHandle", session.handle || identifier);
  store.set("blueskyServiceUrl", session.serviceUrl || serviceUrl);
  return { ok: true, handle: session.handle || identifier };
});

ipcMain.handle("bluesky:auth:logout", async () => {
  store.set("blueskyAccessJwtEnc", "");
  store.set("blueskyRefreshJwtEnc", "");
  store.set("blueskyDid", "");
  store.set("blueskyHandle", "");
  return { ok: true };
});

ipcMain.handle("pixelfed:auth:test", async () => {
  const auth = getPixelfedAuth();
  if (!auth.instanceUrl || !auth.accessToken) throw new Error("Missing PixelFed instance URL or access token");
  const acct = await pixelfed.verifyCredentials({ instanceUrl: auth.instanceUrl, accessToken: auth.accessToken });
  store.set("pixelfedUsername", String(acct.acct || acct.username || ""));
  return { ok: true, username: String(acct.acct || acct.username || "") };
});

ipcMain.handle("pixelfed:auth:logout", async () => {
  store.set("pixelfedAccessTokenEnc", "");
  store.set("pixelfedHasAccessToken", false);
  store.set("pixelfedUsername", "");
  store.set("pixelfedPendingCode", "");
  stopPixelfedOAuthLoopbackServer();
  return { ok: true };
});

ipcMain.handle("pixelfed:oauth:start", async (_e, { instanceUrl }) => {
  const normalizedUrl = pixelfed.normalizeInstanceUrl(instanceUrl);

  // Re-register the app if the instance has changed or we have no client credentials.
  const storedOauthInstanceUrl = String(store.get("pixelfedOauthInstanceUrl") || "");
  const storedClientId = String(store.get("pixelfedClientId") || "");
  const hasClientSecret = Boolean(store.get("pixelfedHasClientSecret"));

  let clientId = storedClientId;

  if (!storedClientId || !hasClientSecret || storedOauthInstanceUrl !== normalizedUrl) {
    const { clientId: newClientId, clientSecret: newClientSecret } = await pixelfed.registerApp({
      instanceUrl: normalizedUrl,
      redirectUri: PIXELFED_OAUTH_REDIRECT_URI,
    });
    clientId = newClientId;
    store.set("pixelfedClientId", clientId);
    store.set("pixelfedClientSecretEnc", encryptCredential(newClientSecret));
    store.set("pixelfedHasClientSecret", true);
    store.set("pixelfedOauthInstanceUrl", normalizedUrl);
    store.set("pixelfedInstanceUrl", normalizedUrl);
  }

  startPixelfedOAuthLoopbackServer();

  const authUrl = pixelfed.buildAuthorizationUrl({
    instanceUrl: normalizedUrl,
    clientId,
    redirectUri: PIXELFED_OAUTH_REDIRECT_URI,
  });

  await shell.openExternal(authUrl);
  logEvent("INFO", "PixelFed OAuth flow started", { instanceUrl: normalizedUrl });
  return { ok: true };
});

ipcMain.handle("pixelfed:oauth:complete", async () => {
  const code = String(store.get("pixelfedPendingCode") || "").trim();
  if (!code) throw new Error("No authorization code received yet. Please complete the authorization in your browser first, then click Complete Authorization.");

  const instanceUrl = String(store.get("pixelfedOauthInstanceUrl") || store.get("pixelfedInstanceUrl") || "");
  const clientId = String(store.get("pixelfedClientId") || "");
  const clientSecret = decryptCredential(store.get("pixelfedClientSecretEnc") || "");

  if (!instanceUrl || !clientId || !clientSecret) throw new Error("OAuth state is incomplete. Please restart the authorization flow.");

  const { accessToken } = await pixelfed.exchangeCodeForToken({
    instanceUrl,
    clientId,
    clientSecret,
    code,
    redirectUri: PIXELFED_OAUTH_REDIRECT_URI,
  });

  const acct = await pixelfed.verifyCredentials({ instanceUrl, accessToken });
  const username = String(acct.acct || acct.username || "");

  store.set("pixelfedAccessTokenEnc", encryptCredential(accessToken));
  store.set("pixelfedHasAccessToken", true);
  store.set("pixelfedUsername", username);
  store.set("pixelfedPendingCode", "");
  stopPixelfedOAuthLoopbackServer();

  logEvent("INFO", "PixelFed OAuth completed", { username });
  return { ok: true, username };
});

ipcMain.handle("pixelfed:oauth:cancel", async () => {
  store.set("pixelfedPendingCode", "");
  stopPixelfedOAuthLoopbackServer();
  return { ok: true };
});

ipcMain.handle("mastodon:auth:test", async () => {
  const auth = getMastodonAuth();
  if (!auth.instanceUrl || !auth.accessToken) throw new Error("Missing Mastodon instance URL or access token");
  const acct = await mastodon.verifyCredentials({ instanceUrl: auth.instanceUrl, accessToken: auth.accessToken });
  store.set("mastodonUsername", String(acct.acct || acct.username || ""));
  return { ok: true, username: String(acct.acct || acct.username || "") };
});

ipcMain.handle("mastodon:auth:logout", async () => {
  store.set("mastodonAccessTokenEnc", "");
  store.set("mastodonHasAccessToken", false);
  store.set("mastodonUsername", "");
  return { ok: true };
});

ipcMain.handle("lemmy:auth:test", async () => {
  const auth = getLemmyAuth();
  if (!auth.instanceUrl || !auth.accessToken) throw new Error("Missing Lemmy instance URL or access token");
  const acct = await lemmy.verifyCredentials({ instanceUrl: auth.instanceUrl, accessToken: auth.accessToken });
  const username = String(acct.username || "");
  store.set("lemmyUsername", username);
  try {
    const communities = await lemmy.listSubscribedCommunities({ instanceUrl: auth.instanceUrl, accessToken: auth.accessToken });
    store.set("lemmyCommunitiesCache", communities);
  } catch {
    // Community list can fail independently; auth remains valid.
  }
  return { ok: true, username };
});

ipcMain.handle("lemmy:auth:logout", async () => {
  store.set("lemmyAccessTokenEnc", "");
  store.set("lemmyHasAccessToken", false);
  store.set("lemmyUsername", "");
  store.set("lemmyCommunitiesCache", []);
  return { ok: true };
});

ipcMain.handle("lemmy:communities", async (_e, { force } = {}) => {
  if (!isLemmyAuthed()) throw new Error("Lemmy is not authorized");
  const cached = store.get("lemmyCommunitiesCache") || [];
  if (!force && Array.isArray(cached) && cached.length) return cached;

  const auth = getLemmyAuth();
  const communities = await lemmy.listSubscribedCommunities({
    instanceUrl: auth.instanceUrl,
    accessToken: auth.accessToken,
  });
  store.set("lemmyCommunitiesCache", communities);
  return communities;
});

ipcMain.handle("lemmy:communityInfo", async (_e, { communityId } = {}) => {
  if (!isLemmyAuthed()) throw new Error("Lemmy is not authorized");
  const auth = getLemmyAuth();
  return lemmy.getCommunityInfo({
    instanceUrl: auth.instanceUrl,
    accessToken: auth.accessToken,
    communityId,
  });
});

ipcMain.handle("sched:stop", async () => {
  store.set("schedulerOn", false);
  if (schedTimer) clearInterval(schedTimer);
  schedTimer = null;
  updateTrayIcon();
  logEvent("INFO", "Scheduler stopped", {});
  return { ok: true };
});

ipcMain.handle("sched:status", async () => ({
  schedulerOn: Boolean(store.get("schedulerOn")),
  intervalHours: store.get("intervalHours") || 24,
  nextRunAt: store.get("nextRunAt"),
  lastError: store.get("lastError") || "",
  timeWindowEnabled: Boolean(store.get("timeWindowEnabled")),
  windowStart: store.get("windowStart") || "07:00",
  windowEnd: store.get("windowEnd") || "22:00",
  daysEnabled: Boolean(store.get("daysEnabled")),
  allowedDays: store.get("allowedDays") || [1,2,3,4,5],
  resumeOnLaunch: Boolean(store.get("resumeOnLaunch")),
  batchRunActive: Boolean(store.get("batchRunActive")),
  batchRunStartedAt: store.get("batchRunStartedAt") || null,
  batchRunSize: store.get("batchRunSize") || null,
  batchRunTotalServiceUnits: Number(batchRunProgress.totalServiceUnits || 0),
  batchRunCompletedServiceUnits: Number(batchRunProgress.completedServiceUnits || 0),
  batchRunCurrentItemId: String(batchRunProgress.currentItemId || ""),
  batchRunCurrentServiceId: String(batchRunProgress.currentServiceId || ""),
  batchRunCurrentServiceLoadedKB: Number(batchRunProgress.currentServiceLoadedKB || 0),
  batchRunCurrentServiceTotalKB: Number(batchRunProgress.currentServiceTotalKB || 0),
  uploadBatchSize: Math.max(1, Math.min(999, Math.round(Number(store.get("uploadBatchSize") || 1))))
}));

ipcMain.handle("flickr:retryGroupAdditionsNow", async () => {
  if (!isFlickrAuthed()) {
    throw new Error("Flickr is not authorized");
  }
  if (uploadLock) {
    throw new Error("Upload is currently in progress. Try again after the current upload finishes.");
  }

  const auth = getFlickrAuth();
  const result = await processDueGroupRetries({
    apiKey: auth.apiKey,
    apiSecret: auth.apiSecret,
    token: auth.token,
    tokenSecret: auth.tokenSecret,
    maxAttempts: 999,
    forceDue: true,
  });

  logEvent("INFO", "Manual Flickr group retry trigger completed", {
    attempts: Number(result?.attempts || 0),
    groupsProcessed: Number(result?.groupsProcessed || 0),
  });

  return {
    ok: true,
    attempts: Number(result?.attempts || 0),
    groupsProcessed: Number(result?.groupsProcessed || 0),
  };
});
