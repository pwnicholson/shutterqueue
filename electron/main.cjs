const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu, Tray, nativeImage, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const Store = require("electron-store");

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

const thumbBuildsInFlight = new Map();
const previewBuildsInFlight = new Map();

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
          fs.unlinkSync(path.join(dir, f));
          deleted++;
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
    logEvent("INFO", "Pruned image cache for removed queue items", {
      removedPaths: removedPathHashes.size,
      deletedFiles: deleted,
    });
  }
}

async function getOrCreateThumbPath(photoPath) {
  const p = String(photoPath || "");
  if (!p) return null;
  ensureImageCacheDirs();
  const pathHash = getPhotoPathHash(p);
  const key = getPhotoCacheKey(p);
  const outPath = path.join(THUMB_CACHE_DIR, `${pathHash}-${key}.jpg`);
  if (fs.existsSync(outPath)) return outPath;

  const existing = thumbBuildsInFlight.get(outPath);
  if (existing) return existing;

  const work = (async () => {
    let image = null;
    if (typeof nativeImage.createThumbnailFromPath === "function") {
      try {
        image = await nativeImage.createThumbnailFromPath(p, { width: 192, height: 192 });
      } catch {
        image = null;
      }
    }
    if (!image || image.isEmpty()) {
      image = nativeImage.createFromPath(p);
    }
    if (!image || image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const side = Math.max(1, Math.min(width, height));
    const x = Math.max(0, Math.floor((width - side) / 2));
    const y = Math.max(0, Math.floor((height - side) / 2));
    const cropped = image.crop({ x, y, width: side, height: side });
    const thumb = cropped.resize({ width: 96, height: 96, quality: "good" });
    const jpg = thumb.toJPEG(84);
    fs.writeFileSync(outPath, jpg);
    return outPath;
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
  ensureImageCacheDirs();
  const cap = Math.max(512, Math.min(4096, Number(maxEdge) || 2560));
  const pathHash = getPhotoPathHash(p);
  const key = getPhotoCacheKey(p);
  const outPath = path.join(PREVIEW_CACHE_DIR, `${pathHash}-${key}-e${cap}.jpg`);
  if (fs.existsSync(outPath)) return outPath;

  const existing = previewBuildsInFlight.get(outPath);
  if (existing) return existing;

  const work = (async () => {
    const image = nativeImage.createFromPath(p);
    if (!image || image.isEmpty()) return null;

    const size = image.getSize();
    const longest = Math.max(size.width || 0, size.height || 0);
    let preview = image;
    if (longest > cap && size.width > 0 && size.height > 0) {
      const scale = cap / longest;
      preview = image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: "good",
      });
    }

    const jpg = preview.toJPEG(88);
    fs.writeFileSync(outPath, jpg);
    return outPath;
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

function parseSemverLoose(v) {
  const s = String(v || "").trim();
  const m = s.match(/^v?(\d+(?:\.\d+){0,3})(?:[-+].*)?$/i);
  if (!m) return null;
  const parts = m[1].split(".").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  while (parts.length < 4) parts.push(0);
  return parts;
}

function compareSemverLoose(a, b) {
  const pa = parseSemverLoose(a);
  const pb = parseSemverLoose(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
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
    return { ...cached, cacheHit: true };
  }

  const latest = await fetchLatestReleaseFromGitHub();
  const latestVersion = String(latest.tagName || "").replace(/^v/i, "");
  const cmp = compareSemverLoose(currentVersion, latestVersion);
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
const geo = require("./services/geocoding.cjs");

let win = null;
let tray = null;
let isQuitting = false;
let lastTraySchedulerState = null;
let pendingFilesToOpen = []; // Files to open when the app is ready

function getIconPath(active) {
  // Use a monochrome icon when scheduler is off OR there is no pending work.
  const name = active ? "icon.png" : "icon-mono.png";
  return path.join(__dirname, "..", "assets", name);
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
  const active = !!store.get("schedulerOn") && hasPendingWork();
  const iconPath = getIconPath(active);
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
    tumblrUsername: "",
    tumblrPrimaryBlogId: "",
    tumblrBlogsCache: [],
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
    updateCheckCache: null
  }
});

function isFlickrAuthed() {
  return Boolean(store.get("apiKey")) && Boolean(store.get("hasApiSecret")) && Boolean(store.get("hasToken"));
}

function isTumblrAuthed() {
  return Boolean(store.get("tumblrApiKey")) && Boolean(store.get("tumblrHasApiSecret")) && Boolean(store.get("tumblrHasToken"));
}

function isAuthed() {
  return isFlickrAuthed() || isTumblrAuthed();
}

// Helper to retrieve decrypted Flickr credentials for API calls
function getFlickrAuth() {
  return {
    apiKey: store.get("apiKey") || "",
    apiSecret: decryptCredential(store.get("apiSecretEnc") || ""),
    token: decryptCredential(store.get("tokenEnc") || ""),
    tokenSecret: decryptCredential(store.get("tokenSecretEnc") || "")
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

  logEvent("INFO", "Refreshing group sizes", { totalGroups: list.length, cacheMaxAgeDays: 14 });

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
      logEvent("INFO", "Group size refresh complete", {
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
  if (errorParts.length > 0) {
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

async function processDueGroupRetries({ apiKey, apiSecret, token, tokenSecret, maxAttempts }) {
  const q = queue.loadQueue();
  const now = Date.now();
  let attempts = 0;
  let changed = false;

  // First pass: bump any stale overdue retry times to ensure they're never shown in the past.
  // This handles cases where the retry time was scheduled for a past date (e.g., after app restart).
  const groupsWithOverdueRetries = new Map(); // groupId -> overdue item count
  for (const it of q) {
    if (!it?.photoId || !it.groupAddStates) continue;
    for (const [gid, st] of Object.entries(it.groupAddStates)) {
      if (!st || st.status !== "retry") continue;
      const due = st.nextRetryAt ? new Date(st.nextRetryAt).getTime() : 0;
      if (due && due > now) continue; // Not overdue
      // This retry is overdue (or has no valid date); track which groups have this
      if (!groupsWithOverdueRetries.has(gid)) {
        groupsWithOverdueRetries.set(gid, 0);
      }
      groupsWithOverdueRetries.set(gid, groupsWithOverdueRetries.get(gid) + 1);
    }
  }

  // For each group with overdue retries, bump all their retry times forward to avoid showing past dates
  if (groupsWithOverdueRetries.size > 0) {
    const futureTime = new Date(now + 60 * 60 * 1000).toISOString(); // now + 1 hour
    for (const [gid, count] of groupsWithOverdueRetries) {
      for (const it of q) {
        const st = it.groupAddStates?.[gid];
        if (!st || st.status !== "retry") continue;
        const due = st.nextRetryAt ? new Date(st.nextRetryAt).getTime() : 0;
        if (due && due > now) continue; // Keep future times as-is
        st.nextRetryAt = futureTime;
        changed = true;
      }
    }
  }

  // Group-level scheduling: one retry attempt per group per cycle.
  // Candidate within each group is selected by retryPriority, then queue order.
  const dueByGroup = new Map();

  for (let idx = 0; idx < q.length; idx++) {
    const it = q[idx];
    if (!it || !it.photoId) continue;
    const states = it.groupAddStates;
    if (!states) continue;

    for (const [gid, st] of Object.entries(states)) {
      if (!st || st.status !== "retry") continue;
      const due = st.nextRetryAt ? new Date(st.nextRetryAt).getTime() : 0;
      if (!due || due > now) continue;

      const job = {
        item: it,
        groupId: gid,
        due,
        queueIndex: idx,
        retryPriority: Number.isFinite(Number(st.retryPriority)) ? Number(st.retryPriority) : Number.MAX_SAFE_INTEGER,
      };

      const prev = dueByGroup.get(gid);
      if (!prev) {
        dueByGroup.set(gid, job);
      } else {
        const better =
          (job.retryPriority < prev.retryPriority) ||
          (job.retryPriority === prev.retryPriority && job.queueIndex < prev.queueIndex);
        if (better) dueByGroup.set(gid, job);
      }
    }
  }

  const groupJobs = Array.from(dueByGroup.values()).sort((a, b) => {
    if (a.due !== b.due) return a.due - b.due;
    if (a.retryPriority !== b.retryPriority) return a.retryPriority - b.retryPriority;
    return a.queueIndex - b.queueIndex;
  });

  for (const job of groupJobs) {
    if (attempts >= (maxAttempts || 5)) break;
    attempts++;

    await attemptAddToGroup({ apiKey, apiSecret, token, tokenSecret, item: job.item, groupId: job.groupId });

    const attemptedState = job.item.groupAddStates?.[job.groupId];
    let propagatedNextRetryAt = "";
    if (attemptedState && attemptedState.status === "retry" && attemptedState.nextRetryAt) {
      propagatedNextRetryAt = attemptedState.nextRetryAt;
    } else {
      // If any retry entries for this group remain overdue, bump them together
      // to avoid repeatedly hammering the same group/API window.
      let hasOverdueRetry = false;
      for (const it of q) {
        const st = it.groupAddStates?.[job.groupId];
        if (!st || st.status !== "retry") continue;
        const due = st.nextRetryAt ? new Date(st.nextRetryAt).getTime() : 0;
        if (!due || due <= Date.now()) {
          hasOverdueRetry = true;
          break;
        }
      }
      if (hasOverdueRetry) {
        propagatedNextRetryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      }
    }

    if (propagatedNextRetryAt) {
      // Propagate the group-level retry slot to all retrying photos for this group.
      for (const it of q) {
        const st = it.groupAddStates?.[job.groupId];
        if (!st || st.status !== "retry") continue;
        st.nextRetryAt = propagatedNextRetryAt;
      }
    }

    const existingNonGroupParts = String(job.item.lastError || "")
      .split("|")
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !/^user limit reached for group\s/i.test(s) && !/^adding to group\s/i.test(s) && !/^group add failed/i.test(s) && !/^photo already in pool/i.test(s) && !/^photo added to group moderation/i.test(s));
    setItemLastErrorFromGroupStates(job.item, existingNonGroupParts);
    changed = true;
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
    queue.saveQueue(Array.from(byId.values()));
  }
  return { ok: true, attempts };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#0b1020",
    icon: getIconPath(!!store.get("schedulerOn") && hasPendingWork()),
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

  // Handle window close: minimize to tray if enabled, otherwise quit
  win.on("close", (event) => {
    if (!isQuitting && store.get("minimizeToTray")) {
      event.preventDefault();
      win.hide();
      // Ensure tray icon exists when minimizing
      if (!tray) createTray();
    }
  });

  // When the window finishes loading, send any pending files that were queued from command-line or "open with"
  win.webContents.on("did-finish-load", () => {
    // Small delay to ensure React app is mounted and listening for events
    setTimeout(() => {
      sendFilesToRenderer();
    }, 500);
  });
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
        iconPath = getIconPath(schedulerOn);
        tray = new Tray(iconPath);
      }
      lastTraySchedulerState = schedulerOn;
    } else {
      // Windows/Linux: use normal icon sizing (menu bar icon also follows scheduler state)
      iconPath = getIconPath(!!store.get("schedulerOn"));
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
            schedTimer = setInterval(() => tickScheduler().catch(() => {}), 1000);
          }
          updateTrayMenu();
          updateTrayIcon();
        }
      },
      { type: "separator" },
      {
        label: "Quit ShutterQueue",
        click: () => {
          // Force quit without triggering minimize-to-tray
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
        tray.setImage(getIconPath(schedulerOn));
      }
    } else {
      const iconPath = getIconPath(schedulerOn);
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
    // Skip flags (start with -)
    if (arg.startsWith("-")) continue;
    // Skip if it looks like an electron dev/build argument
    if (arg.includes("=") || arg.includes("@")) continue;
    // Skip the executable path itself
    if (arg.endsWith(".exe") || arg.endsWith(".js") || arg.includes("electron")) continue;
    // This should be a file path - add it
    // We'll let the queue handler validate if it exists and is a valid image
    pendingFilesToOpen.push(arg);
    console.log("[main] Command-line file to open:", arg);
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
    schedTimer = setInterval(() => tickScheduler().catch(() => {}), 1000);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
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
  savedGroupSets: Array.isArray(store.get("savedGroupSets")) ? store.get("savedGroupSets") : [],
  savedAlbumSets: Array.isArray(store.get("savedAlbumSets")) ? store.get("savedAlbumSets") : [],
  savedTagSets: Array.isArray(store.get("savedTagSets")) ? store.get("savedTagSets") : []
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
  const kind = ["album", "tag"].includes(payload?.kind) ? payload.kind : "group";
  const key = kind === "group" ? "savedGroupSets" : kind === "album" ? "savedAlbumSets" : "savedTagSets";
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

  const tmp = await tumblr.getRequestToken(consumerKey, consumerSecret);
  store.set("tumblrOauthTmp", tmp);
  const url = tumblr.getAuthorizeUrl(tmp.oauthToken);
  await shell.openExternal(url);
  return { ok: true };
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
    logEvent("INFO", "Loaded groups list", { source: "flickr", count: merged.length, forceRefresh: force });
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

ipcMain.handle("flickr:albums", async () => {
  if (!isFlickrAuthed()) throw new Error("Flickr is not authorized");
  const auth = getFlickrAuth();
  try {
    const result = await flickr.listAlbums({
      apiKey: auth.apiKey,
      apiSecret: auth.apiSecret,
      token: auth.token,
      tokenSecret: auth.tokenSecret,
      userNsid: store.get("userNsid"),
    });
    logApiCallVerbose("flickr.photosets.getList", {}, result);
    logEvent("INFO", "Loaded albums list", { count: Array.isArray(result) ? result.length : 0 });
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


ipcMain.handle("thumb:getSrc", async (_e, { photoPath }) => {
  try {
    return toSqimgUrl(await getOrCreateThumbPath(photoPath));
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
ipcMain.handle("queue:update", async (_e, { items }) => {
  const before = queue.loadQueue();
  const out = await queue.updateItems(items || []);
  pruneImageCacheForRemovedItems(before, out);
  return out;
});
ipcMain.handle("queue:reorder", async (_e, { idsInOrder }) => {
  const list = Array.isArray(idsInOrder) ? idsInOrder : [];
  const out = await queue.reorder(list);
  logEvent("INFO", "Reordered queue", { itemCount: list.length });
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
      defaultPath: path.join(os.homedir(), "Downloads", defaultFileName),
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
      properties: ["openFile"],
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };

    const filePath = result.filePaths[0];
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
      out = queue.saveQueue(items);
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
    return lines.slice(-500); // keep last 500 lines
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
      defaultPath: path.join(os.homedir(), "Downloads", defaultFileName),
      filters: [{ name: "Text Files", extensions: ["txt"] }]
    });
    
    if (!result.canceled && result.filePath) {
      const content = `ShutterQueue v${version}\n\n${lines}`;
      fs.writeFileSync(result.filePath, content, "utf-8");
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
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "heic"] }]
  });
  return res.canceled ? [] : (res.filePaths || []);
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
  const key = `${String(auth?.userNsid || "")}|${String(auth?.token || "")}`;
  if (albumTitleCacheKey === key && albumTitleToIdCache.size > 0) return;

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
}

function normalizeTargetServicesForItem(item) {
  const raw = Array.isArray(item?.targetServices) ? item.targetServices : [];
  const out = [];
  const seen = new Set();
  for (const svc of raw) {
    const clean = String(svc || "").trim().toLowerCase();
    if (clean !== "flickr" && clean !== "tumblr") continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  if (!out.length) out.push("flickr");
  return out;
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

    logEvent("INFO", "Uploading photo", { id: next.id, path: next.photoPath });

    let successfulServices = 0;
    const warningParts = [];
    const errorParts = [];

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
          for (let attempt = 1; attempt <= maxUploadAttempts; attempt++) {
            try {
              let lastProgressBytes = 0;
              photoId = await flickr.uploadPhoto({
                apiKey: auth.apiKey,
                apiSecret: auth.apiSecret,
                token: auth.token,
                tokenSecret: auth.tokenSecret,
                item: next,
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
          logEvent("INFO", "Uploaded photo", { id: next.id, photoId });

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
          for (const title of requestedCreateAlbums) {
            try {
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

          for (const gid of (next.groupIds || [])) {
            const res = await attemptAddToGroup({ apiKey: auth.apiKey, apiSecret: auth.apiSecret, token: auth.token, tokenSecret: auth.tokenSecret, item: next, groupId: gid });
            if (!res.ok) serviceWarnings.push(`group ${gid}: ${res.message || "Group add failed"}`);
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
      } else if (String(next.privacy || "private") === "private") {
        const msg = "Tumblr does not support private visibility from this app. Change privacy to upload to Tumblr.";
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
            const postId = await tumblr.createPhotoPost({
              consumerKey: tauth.consumerKey,
              consumerSecret: tauth.consumerSecret,
              token: tauth.token,
              tokenSecret: tauth.tokenSecret,
              blogIdentifier: blogId,
              item: next,
              markMature: Number(next.safetyLevel || 1) >= 2,
            });
            const uploadedAt = new Date().toISOString();
            next.serviceStates.tumblr = {
              status: "done",
              remoteId: postId,
              uploadedAt,
            };
            successfulServices += 1;
            logEvent("INFO", "Uploaded to Tumblr", { id: next.id, postId, blogId });
          } catch (e) {
            const msg = e?.message ? String(e.message) : String(e);
            next.serviceStates.tumblr = { status: "failed", lastError: msg };
            errorParts.push(`Tumblr: ${msg}`);
            logEvent("WARN", "Tumblr upload failed", { id: next.id, error: msg, blogId });
          }
        }
      }
    } else if (next.targetServices.includes("tumblr")) {
      successfulServices += 1;
    }

    if (!next.targetServices.length) {
      const msg = "No target services selected for this item.";
      next.status = "failed";
      next.lastError = msg;
      queue.saveQueue(q);
      return { ok: false, error: msg };
    }

    if (successfulServices > 0) {
      next.scheduledUploadAt = "";
    }

    const combinedMessages = [...warningParts, ...errorParts].filter(Boolean);
    if (successfulServices === 0) {
      const msg = combinedMessages.join(" | ") || "Upload failed for all target services.";
      next.status = "failed";
      next.lastError = msg;
      store.set("lastError", msg);
      queue.saveQueue(q);
      return { ok: false, error: msg };
    }

    if (combinedMessages.length) {
      next.status = "done_warn";
      next.lastError = combinedMessages.join(" | ");
      queue.saveQueue(q);
      return { ok: true, photoId: next.photoId || "", warnings: combinedMessages };
    }

    next.status = "done";
    next.lastError = "";
    queue.saveQueue(q);
    store.set("lastError", "");
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
    }
    return { ok: false, error: msg };
  } finally {
    uploadLock = false;
  }
}

ipcMain.handle("upload:nowOne", async (_e, options) => uploadNowOneInternal(options || {}));

let schedTimer = null;
let uploadLock = false; // prevents overlapping uploads (fixes duplicate uploads)


async function tickScheduler() {
  if (!store.get("schedulerOn")) return;

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
    }
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    logEvent("WARN", "Group retry processing failed", { error: msg });
  }

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
  // Mark an upload batch as active so the UI can display "current batch" instead of the nextRunAt time.
  store.set("batchRunActive", true);
  store.set("batchRunStartedAt", new Date(Date.now()).toISOString());
  store.set("batchRunSize", bs);
  try {
    for (let i = 0; i < bs; i++) {
      const res = await uploadNowOneInternal();
      // Stop if nothing left to upload.
      if (res && res.message && String(res.message).includes("No pending items")) break;
    }
  } finally {
    store.set("batchRunActive", false);
  }
}

ipcMain.handle("sched:start", async (_e, { intervalHours, uploadImmediately, settings }) => {
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
  scheduleNext(uploadImmediately ? 0 : h);
  if (schedTimer) clearInterval(schedTimer);
  schedTimer = setInterval(() => tickScheduler().catch(() => {}), 1000);
  updateTrayIcon();
  logEvent("INFO", "Scheduler started", {
    intervalHours: h,
    uploadImmediately: Boolean(uploadImmediately),
    uploadBatchSize: Number(store.get("uploadBatchSize") || 1),
    resumeOnLaunch: Boolean(store.get("resumeOnLaunch")),
  });
  return { ok: true };
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
  uploadBatchSize: Math.max(1, Math.min(999, Math.round(Number(store.get("uploadBatchSize") || 1))))
}));
