const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = path.join(os.homedir(), ".shutterqueue");
const QUEUE_PATH = path.join(ROOT, "queue.json");

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

function loadQueue() {
  ensureRoot();
  if (!fs.existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
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
      photoId: ""
    });
  }
  return saveQueue(q);
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

module.exports = { loadQueue, saveQueue, addPaths, removeIds, updateItems, reorder, QUEUE_PATH };


function clearUploaded() {
  const q = loadQueue().filter(it => {
    // Remove items that are fully done (no pending work)
    if (it.status !== "done" && it.status !== "done_warn") return true;
    
    // If it's done_warn, check if there are actual retries/failures pending
    if (it.status === "done_warn") return true;
    
    // Status is "done" – check if there are any pending group retries
    const states = it.groupAddStates || {};
    const hasPendingRetry = Object.values(states).some(st => st && (st.status === "retry" || st.status === "gave_up"));
    
    // If there are no pending retries, this is fully done (even with informational messages)
    // so remove it. Otherwise keep it.
    return hasPendingRetry;
  });
  return saveQueue(q);
}

module.exports.clearUploaded = clearUploaded;
