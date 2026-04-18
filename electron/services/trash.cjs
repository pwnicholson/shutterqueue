const fs = require("node:fs");

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

const RETRYABLE_TRASH_ERROR_RE = /operation was aborted|operation was canceled|request aborted|aborterror/i;
const MISSING_FILE_ERROR_RE = /enoent|no such file|cannot find the file|file not found|does not exist/i;

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const out = Math.floor(n);
  return out > 0 ? out : fallback;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms | 0)));
}

function isRetryableTrashError(error) {
  return RETRYABLE_TRASH_ERROR_RE.test(String(error || ""));
}

function isMissingFileTrashError(error) {
  return MISSING_FILE_ERROR_RE.test(String(error || ""));
}

function toTrashErrorDetails(error) {
  const err = error || {};
  return {
    error: String(err),
    errorName: String(err?.name || ""),
    errorCode: String(err?.code || ""),
    errorErrno: Number.isFinite(Number(err?.errno)) ? Number(err.errno) : null,
    errorSyscall: String(err?.syscall || ""),
  };
}

async function movePathsToTrash(photoPaths, options = {}) {
  const paths = Array.isArray(photoPaths) ? photoPaths.map((p) => String(p || "").trim()).filter(Boolean) : [];
  const trashItem = typeof options.trashItem === "function" ? options.trashItem : null;
  if (!trashItem) {
    throw new Error("movePathsToTrash requires options.trashItem(photoPath)");
  }

  const maxAttempts = toPositiveInt(options.maxAttempts, 7);
  const retryDelayMs = toPositiveInt(options.retryDelayMs, 300);

  let movedCount = 0;
  let skippedMissing = 0;
  let failedCount = 0;
  const movedPaths = [];
  const skippedMissingPaths = [];
  const failed = [];
  const retried = [];

  for (const photoPath of paths) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        await trashItem(photoPath);
        movedCount++;
        movedPaths.push(photoPath);
        if (attempts > 1) retried.push({ photoPath, attempts });
        break;
      } catch (error) {
        let finalError = error;
        let finalAttempts = attempts;
        if (isMissingFileTrashError(error)) {
          skippedMissing++;
          skippedMissingPaths.push(photoPath);
          break;
        }

        const shouldRetry = isRetryableTrashError(error) && attempts < maxAttempts;
        if (shouldRetry) {
          await waitMs(retryDelayMs * attempts);
          continue;
        }

        const canDoFinalGraceRetry = isRetryableTrashError(error) && attempts >= maxAttempts;
        if (canDoFinalGraceRetry) {
          let stillExists = false;
          try {
            stillExists = fs.existsSync(photoPath);
          } catch {
            stillExists = false;
          }

          if (stillExists) {
            const graceAttempt = attempts + 1;
            try {
              await waitMs(retryDelayMs * graceAttempt);
              await trashItem(photoPath);
              movedCount++;
              movedPaths.push(photoPath);
              retried.push({ photoPath, attempts: graceAttempt });
              break;
            } catch (graceError) {
              finalError = graceError;
              finalAttempts = graceAttempt;
            }
          }
        }

        failedCount++;
        failed.push({ photoPath, attempts: finalAttempts, ...toTrashErrorDetails(finalError) });
        break;
      }
    }
  }

  return {
    movedCount,
    skippedMissing,
    failedCount,
    movedPaths,
    skippedMissingPaths,
    failed,
    retried,
  };
}

function getTrashLabel(platform) {
  const p = String(platform || process.platform || "").toLowerCase();
  return p === "darwin" ? "Trash Can" : "Recycle Bin";
}

module.exports = {
  collectUniquePhotoPathsByQueueIds,
  movePathsToTrash,
  getTrashLabel,
};
