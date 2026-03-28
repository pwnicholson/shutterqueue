function collectUniquePhotoPathsByQueueIds(queueItems, ids) {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "")).filter(Boolean));
  const seenPaths = new Set();
  const out = [];

  for (const it of Array.isArray(queueItems) ? queueItems : []) {
    const id = String(it?.id || "");
    if (!idSet.has(id)) continue;

    const photoPath = String(it?.photoPath || "");
    if (!photoPath || seenPaths.has(photoPath)) continue;

    seenPaths.add(photoPath);
    out.push(photoPath);
  }

  return out;
}

function getTrashLabel(platform) {
  const p = String(platform || process.platform || "").toLowerCase();
  return p === "darwin" ? "Trash Can" : "Recycle Bin";
}

module.exports = {
  collectUniquePhotoPathsByQueueIds,
  getTrashLabel,
};
