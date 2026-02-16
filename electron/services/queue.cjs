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
  const q = loadQueue().filter(it => !(it.status === "done" && !it.lastError));
  return saveQueue(q);
}

module.exports.clearUploaded = clearUploaded;
