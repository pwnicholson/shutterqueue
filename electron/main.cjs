const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");


const os = require("os");

const ROOT_DIR = path.join(os.homedir(), ".shutterqueue");
const LOG_PATH = path.join(ROOT_DIR, "activity.log");

function ensureRootDir() {
  if (!fs.existsSync(ROOT_DIR)) fs.mkdirSync(ROOT_DIR, { recursive: true });
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

const queue = require("./services/queue.cjs");
const flickr = require("./services/flickr.cjs");

let win = null;

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
    resumeOnLaunch: false
  }
});

function isAuthed() {
  return Boolean(store.get("apiKey")) && Boolean(store.get("apiSecret")) && Boolean(store.get("token")) && Boolean(store.get("tokenSecret"));
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

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
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


ipcMain.handle("app:version", async () => {
  return app.getVersion();
});
ipcMain.handle("cfg:get", async () => ({
  apiKey: store.get("apiKey"),
  hasApiSecret: Boolean(store.get("apiSecret")),
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
  resumeOnLaunch: Boolean(store.get("resumeOnLaunch"))
}));

ipcMain.handle("cfg:setKeys", async (_e, { apiKey, apiSecret }) => {
  if (typeof apiKey === "string" && apiKey.length) store.set("apiKey", apiKey);
  // IMPORTANT: if apiSecret is blank, keep the existing secret (so Start Authorization remains enabled)
  if (typeof apiSecret === "string" && apiSecret.trim().length) store.set("apiSecret", apiSecret.trim());
  return { ok: true };
});

ipcMain.handle("oauth:start", async () => {
  const apiKey = store.get("apiKey");
  const apiSecret = store.get("apiSecret");
  if (!apiKey || !apiSecret) throw new Error("Missing API key/secret");

  const tmp = await flickr.getRequestToken(apiKey, apiSecret);
  store.set("oauthTmp", tmp);
  const url = flickr.getAuthorizeUrl(tmp.oauthToken);
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("oauth:finish", async (_e, { verifier }) => {
  const apiKey = store.get("apiKey");
  const apiSecret = store.get("apiSecret");
  const tmp = store.get("oauthTmp");
  if (!tmp) throw new Error("No OAuth session. Click Start Authorization first.");
  const tok = await flickr.getAccessToken(apiKey, apiSecret, tmp.oauthToken, tmp.oauthTokenSecret, verifier);
  store.set("token", tok.token);
  store.set("tokenSecret", tok.tokenSecret);
  store.set("userNsid", tok.userNsid);
  store.set("username", tok.username);
  store.set("fullname", tok.fullname);
  store.set("oauthTmp", null);
  store.set("lastError", "");
  return { ok: true };
});

ipcMain.handle("oauth:logout", async () => {
  store.set("token", "");
  store.set("tokenSecret", "");
  store.set("userNsid", "");
  store.set("username", "");
  store.set("fullname", "");
  store.set("oauthTmp", null);
  store.set("lastError", "");
  return { ok: true };
});

ipcMain.handle("flickr:groups", async () => {
  if (!isAuthed()) throw new Error("Not authorized");
  return await flickr.listGroups({
    apiKey: store.get("apiKey"),
    apiSecret: store.get("apiSecret"),
    token: store.get("token"),
    tokenSecret: store.get("tokenSecret"),
  });
});

ipcMain.handle("flickr:albums", async () => {
  if (!isAuthed()) throw new Error("Not authorized");
  return await flickr.listAlbums({
    apiKey: store.get("apiKey"),
    apiSecret: store.get("apiSecret"),
    token: store.get("token"),
    tokenSecret: store.get("tokenSecret"),
    userNsid: store.get("userNsid"),
  });
});

ipcMain.handle("thumb:getDataUrl", async (_e, { photoPath }) => {
  try {
    const data = fs.readFileSync(photoPath);
    const ext = String(path.extname(photoPath)).toLowerCase();
    const mime = ext === ".png" ? "image/png" : (ext === ".webp" ? "image/webp" : "image/jpeg");
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
});

ipcMain.handle("queue:get", async () => queue.loadQueue());
ipcMain.handle("queue:add", async (_e, { paths }) => queue.addPaths(paths || []));
ipcMain.handle("queue:remove", async (_e, { ids }) => queue.removeIds(ids || []));
ipcMain.handle("queue:update", async (_e, { items }) => queue.updateItems(items || []));
ipcMain.handle("queue:reorder", async (_e, { idsInOrder }) => queue.reorder(idsInOrder || []));
ipcMain.handle("queue:clearUploaded", async () => queue.clearUploaded());

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



ipcMain.handle("ui:pickPhotos", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Add photos",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "heic"] }]
  });
  return res.canceled ? [] : (res.filePaths || []);
});

async function ensureAlbumByTitle(title) {
  // MVP: album creation not implemented.
  // Future: call flickr.photosets.create with primary photo ID once uploaded.
  return null;
}

async function uploadNowOneInternal() {
  const apiKey = store.get("apiKey");
  const apiSecret = store.get("apiSecret");
  const token = store.get("token");
  const tokenSecret = store.get("tokenSecret");

  try {
    if (!isAuthed()) throw new Error("Not authorized");

    const q = queue.loadQueue();
    const next = q.find(it => it.status === "pending");
    if (!next) return { ok: true, message: "No pending items." };

    next.status = "uploading";
    next.lastError = "";
    queue.saveQueue(q);

    logEvent("INFO", "Uploading photo", { id: next.id, path: next.photoPath });

    const photoId = await flickr.uploadPhoto({
      apiKey,
      apiSecret,
      token,
      tokenSecret,
      item: next
    });

    // Mark upload complete immediately so we never re-upload this file again.
    next.photoId = photoId;
    next.uploadedAt = new Date().toISOString();
    next.status = "done";
    queue.saveQueue(q);

    logEvent("INFO", "Uploaded photo", { id: next.id, photoId });

    const warnings = [];

    // Attach to albums (already-existing)
    for (const aid of (next.albumIds || [])) {
      try {
        await flickr.addPhotoToAlbum({ apiKey, apiSecret, token, tokenSecret, photoId, albumId: aid });
        logEvent("INFO", "Added to album", { id: next.id, photoId, albumId: aid });
      } catch (e) {
        const msg = e?.message ? String(e.message) : String(e);
        warnings.push(`album ${aid}: ${msg}`);
        logEvent("WARN", "Album add failed", { id: next.id, photoId, albumId: aid, error: msg });
      }
    }

    // Attach to groups
    for (const gid of (next.groupIds || [])) {
      try {
        await flickr.addPhotoToGroup({ apiKey, apiSecret, token, tokenSecret, photoId, groupId: gid });
        logEvent("INFO", "Added to group", { id: next.id, photoId, groupId: gid });
      } catch (e) {
        const msg = e?.message ? String(e.message) : String(e);
        warnings.push(`group ${gid}: ${msg}`);
        logEvent("WARN", "Group add failed", { id: next.id, photoId, groupId: gid, error: msg });
      }
    }

    if (warnings.length) {
      next.status = "done_warn";
      next.lastError = warnings.join(" | ");
      queue.saveQueue(q);
      store.set("lastError", next.lastError);
      return { ok: true, photoId, warnings };
    }

    store.set("lastError", "");
    return { ok: true, photoId };
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

ipcMain.handle("upload:nowOne", async () => uploadNowOneInternal());

let schedTimer = null;
let uploadLock = false; // prevents overlapping uploads (fixes duplicate uploads)


async function tickScheduler() {
  if (!store.get("schedulerOn")) return;
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
  await uploadNowOneInternal();
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
  }
  store.set("schedulerOn", true);
  scheduleNext(uploadImmediately ? 0 : h);
  if (schedTimer) clearInterval(schedTimer);
  schedTimer = setInterval(() => tickScheduler().catch(() => {}), 1000);
  return { ok: true };
});

ipcMain.handle("sched:stop", async () => {
  store.set("schedulerOn", false);
  if (schedTimer) clearInterval(schedTimer);
  schedTimer = null;
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
  resumeOnLaunch: Boolean(store.get("resumeOnLaunch"))
}));
