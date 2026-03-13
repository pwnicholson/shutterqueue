const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = path.join(os.homedir(), ".shutterqueue");
const QUEUE_PATH = path.join(ROOT, "queue.json");
const duplicateHashCacheByItemId = new Map();
const VALID_PRIVACY = new Set(["public", "friends", "family", "friends_family", "private"]);
const VALID_GEO_PRIVACY = new Set(["public", "contacts", "friends", "family", "friends_family", "private"]);
const VALID_STATUS = new Set(["pending", "uploading", "done", "done_warn", "failed"]);

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

function loadQueue() {
  ensureRoot();
  if (!fs.existsSync(QUEUE_PATH)) return [];
  try {
    const q = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8")) || [];

    // Migration: normalize older items that were marked `done_warn` solely
    // because of informational group messages (e.g., "added to moderation
    // queue"). If there are no retry/failed/gave_up states left for the
    // item, treat it as fully done so the UI and "Clear uploaded" behave
    // as expected after upgrades.
    for (const it of q) {
      if (!it) continue;
      if (it.status === "done_warn") {
        const states = it.groupAddStates || {};
        const hasProblem = Object.values(states).some(st => st && (st.status === "retry" || st.status === "failed" || st.status === "gave_up"));
        if (!hasProblem) {
          it.status = "done";
        }
      }
    }

    return q;
  } catch {
    return [];
  }
}

function saveQueue(q) {
  ensureRoot();
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2), "utf-8");
  return q;
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function addPaths(paths) {
  const q = loadQueue();
  for (const p of paths) {
    q.push({
      id: makeId(),
      photoPath: p,
      title: "",
      description: "",
      tags: "",
      groupIds: [],
      albumIds: [],
      createAlbums: [],
      privacy: "private",
      safetyLevel: 1,
      status: "pending",
      lastError: "",
      uploadedAt: "",
      photoId: "",
      scheduledUploadAt: ""
    });
  }
  return saveQueue(q);
}

function normalizeImportedQueue(input) {
  const rawItems = Array.isArray(input)
    ? input
    : (input && typeof input === "object" && Array.isArray(input.queue) ? input.queue : []);

  const seenIds = new Set();
  const items = [];
  let skipped = 0;

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") {
      skipped += 1;
      continue;
    }

    const photoPath = String(raw.photoPath || "").trim();
    if (!photoPath) {
      skipped += 1;
      continue;
    }

    let id = String(raw.id || "").trim();
    if (!id || seenIds.has(id)) id = makeId();
    seenIds.add(id);

    const safetyLevel = Number(raw.safetyLevel);
    const normalized = {
      id,
      photoPath,
      title: String(raw.title || ""),
      description: String(raw.description || ""),
      tags: String(raw.tags || ""),
      groupIds: Array.isArray(raw.groupIds) ? raw.groupIds.map((v) => String(v)).filter(Boolean) : [],
      albumIds: Array.isArray(raw.albumIds) ? raw.albumIds.map((v) => String(v)).filter(Boolean) : [],
      createAlbums: Array.isArray(raw.createAlbums) ? raw.createAlbums.map((v) => String(v)).filter(Boolean) : [],
      privacy: VALID_PRIVACY.has(String(raw.privacy || "")) ? String(raw.privacy) : "private",
      safetyLevel: safetyLevel === 2 || safetyLevel === 3 ? safetyLevel : 1,
      status: VALID_STATUS.has(String(raw.status || "")) ? String(raw.status) : "pending",
      lastError: String(raw.lastError || ""),
      uploadedAt: String(raw.uploadedAt || ""),
      photoId: String(raw.photoId || ""),
      scheduledUploadAt: String(raw.scheduledUploadAt || ""),
    };

    if (Number.isFinite(Number(raw.latitude))) normalized.latitude = Number(raw.latitude);
    if (Number.isFinite(Number(raw.longitude))) normalized.longitude = Number(raw.longitude);
    if (Number.isFinite(Number(raw.accuracy))) normalized.accuracy = Number(raw.accuracy);
    if (VALID_GEO_PRIVACY.has(String(raw.geoPrivacy || ""))) normalized.geoPrivacy = String(raw.geoPrivacy);
    if (raw.locationDisplayName != null && String(raw.locationDisplayName).trim()) normalized.locationDisplayName = String(raw.locationDisplayName);
    if (raw.groupAddStates && typeof raw.groupAddStates === "object" && !Array.isArray(raw.groupAddStates)) normalized.groupAddStates = raw.groupAddStates;

    items.push(normalized);
  }

  return { items, skipped };
}

function removeIds(ids) {
  const set = new Set(ids);
  const q = loadQueue().filter(it => !set.has(it.id));
  return saveQueue(q);
}

function updateItems(items) {
  const byId = new Map(items.map(it => [it.id, it]));
  const q = loadQueue().map(it => byId.get(it.id) || it);
  return saveQueue(q);
}

function reorder(idsInOrder) {
  const byId = new Map(loadQueue().map(it => [it.id, it]));
  const out = [];
  for (const id of idsInOrder) {
    const it = byId.get(id);
    if (it) out.push(it);
  }
  // append any missing (shouldn't happen, but keeps stable)
  for (const it of byId.values()) {
    if (!out.find(x => x.id === it.id)) out.push(it);
  }
  return saveQueue(out);
}

function getItemContentHash(item) {
  const itemId = String(item?.id || "");
  const photoPath = String(item?.photoPath || "");
  if (!itemId || !photoPath) return null;
  try {
    const stat = fs.statSync(photoPath);
    const key = `${Number(stat.size)}:${Number(stat.mtimeMs)}`;
    const cached = duplicateHashCacheByItemId.get(itemId);
    if (cached && cached.photoPath === photoPath && cached.key === key && cached.hash) {
      return cached.hash;
    }
    const fileData = fs.readFileSync(photoPath);
    const hash = crypto.createHash("sha256").update(fileData).digest("hex");
    duplicateHashCacheByItemId.set(itemId, { photoPath, key, hash });
    return hash;
  } catch {
    return null;
  }
}

function findDuplicateGroups() {
  const q = loadQueue();

  // Purge cache entries for items no longer in queue
  const activeIds = new Set(q.map((it) => String(it.id)));
  for (const itemId of Array.from(duplicateHashCacheByItemId.keys())) {
    if (!activeIds.has(itemId)) duplicateHashCacheByItemId.delete(itemId);
  }

  const byHash = new Map();
  for (const it of q) {
    const hash = getItemContentHash(it);
    if (!hash) continue;
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(it);
  }

  const duplicates = [];
  for (const [hash, items] of byHash.entries()) {
    if (!Array.isArray(items) || items.length <= 1) continue;
    const members = items.map((it) => ({
      id: String(it.id || ""),
      photoPath: String(it.photoPath || ""),
      title: String(it.title || ""),
    }));
    const removeCandidateIds = members.slice(1).map((m) => m.id).filter(Boolean);
    duplicates.push({ hash, members, removeCandidateIds });
  }

  return duplicates;
}

module.exports = { loadQueue, saveQueue, addPaths, removeIds, updateItems, reorder, QUEUE_PATH };


function clearUploaded() {
  const q = loadQueue().filter(it => {
    // Keep items that are not done at all
    if (it.status !== "done" && it.status !== "done_warn") return true;

    // For done/done_warn, check whether any group states indicate a pending
    // problem that should prevent clearing (retry, failed, or gave_up).
    const states = it.groupAddStates || {};
    const hasPendingProblem = Object.values(states).some(st => st && (st.status === "retry" || st.status === "failed" || st.status === "gave_up"));

    // If there are pending problems, keep the item. Otherwise remove it
    // (i.e., return false so filter drops it).
    return hasPendingProblem;
  });
  return saveQueue(q);
}

module.exports.clearUploaded = clearUploaded;
module.exports.findDuplicateGroups = findDuplicateGroups;
module.exports.normalizeImportedQueue = normalizeImportedQueue;

