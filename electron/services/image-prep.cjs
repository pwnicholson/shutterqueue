const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const mime = require("mime-types");
const sharp = require("sharp");

const TMP_DIR = path.join(os.tmpdir(), "shutterqueue-upload-prep");
const QUALITY_STEPS_HIGH = [92, 88, 84, 80];
const QUALITY_STEPS_LOW = [76, 72, 70];

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function clampDimensionsToLimits(width, height, limits) {
  let w = Math.max(1, Math.floor(Number(width) || 1));
  let h = Math.max(1, Math.floor(Number(height) || 1));

  const maxWidth = toPositiveInt(limits.maxWidth);
  const maxHeight = toPositiveInt(limits.maxHeight);
  const maxPixels = toPositiveInt(limits.maxPixels);

  if (maxWidth && w > maxWidth) {
    const scale = maxWidth / w;
    w = maxWidth;
    h = Math.max(1, Math.floor(h * scale));
  }
  if (maxHeight && h > maxHeight) {
    const scale = maxHeight / h;
    h = maxHeight;
    w = Math.max(1, Math.floor(w * scale));
  }

  if (maxPixels && w * h > maxPixels) {
    const scale = Math.sqrt(maxPixels / (w * h));
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
  }

  return { width: w, height: h };
}

function buildScaleSteps() {
  return [1, 0.92, 0.85, 0.78, 0.71, 0.64, 0.57, 0.5, 0.43, 0.36, 0.3, 0.25, 0.2];
}

function makeNoopResult(photoPath, contentType, sizeBytes) {
  return {
    filePath: photoPath,
    contentType,
    sizeBytes,
    transformed: false,
    cleanup: async () => {},
  };
}

async function writeTempJpeg(buffer) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const name = `sq-upload-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
  const outPath = path.join(TMP_DIR, name);
  await fs.promises.writeFile(outPath, buffer);
  return outPath;
}

async function prepareImageForUpload(photoPath, limits = {}) {
  const srcPath = String(photoPath || "").trim();
  if (!srcPath) throw new Error("Missing image path for upload preparation.");

  const stat = await fs.promises.stat(srcPath);
  const srcBytes = Number(stat.size || 0);
  const srcContentType = mime.lookup(srcPath) || "application/octet-stream";

  const meta = await sharp(srcPath, { failOn: "none" }).metadata();
  const srcWidth = Math.max(1, Number(meta.width || 1));
  const srcHeight = Math.max(1, Number(meta.height || 1));

  const maxBytes = toPositiveInt(limits.maxBytes);
  const clampedBase = clampDimensionsToLimits(srcWidth, srcHeight, limits);
  const needsResize = clampedBase.width < srcWidth || clampedBase.height < srcHeight;
  const needsByteReduction = Boolean(maxBytes && srcBytes > maxBytes);

  if (!needsResize && !needsByteReduction) {
    return makeNoopResult(srcPath, srcContentType, srcBytes);
  }

  let bestCandidate = null;
  const scales = buildScaleSteps();

  const phases = [
    { scales, qualities: QUALITY_STEPS_HIGH },
    // Prefer a modest downscale before dropping into very low JPEG quality.
    { scales: scales.slice(1), qualities: QUALITY_STEPS_LOW },
  ];

  for (const phase of phases) {
    for (const scale of phase.scales) {
      const targetWidth = Math.max(1, Math.floor(clampedBase.width * scale));
      const targetHeight = Math.max(1, Math.floor(clampedBase.height * scale));

      for (const quality of phase.qualities) {
      const buffer = await sharp(srcPath, { failOn: "none" })
        .rotate()
        .resize({
          width: targetWidth,
          height: targetHeight,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({
          quality,
          mozjpeg: true,
          chromaSubsampling: "4:2:0",
        })
        .toBuffer();

      const candidate = {
        buffer,
        bytes: buffer.length,
      };
      if (!bestCandidate || candidate.bytes < bestCandidate.bytes) {
        bestCandidate = candidate;
      }

      if (!maxBytes || candidate.bytes <= maxBytes) {
        const tempPath = await writeTempJpeg(candidate.buffer);
        return {
          filePath: tempPath,
          contentType: "image/jpeg",
          sizeBytes: candidate.bytes,
          transformed: true,
          cleanup: async () => {
            try {
              await fs.promises.rm(tempPath, { force: true });
            } catch {
              // ignore cleanup errors
            }
          },
        };
      }
    }
    }
  }

  if (!bestCandidate) {
    throw new Error("Failed to prepare image for upload.");
  }

  const fallbackPath = await writeTempJpeg(bestCandidate.buffer);
  return {
    filePath: fallbackPath,
    contentType: "image/jpeg",
    sizeBytes: bestCandidate.bytes,
    transformed: true,
    cleanup: async () => {
      try {
        await fs.promises.rm(fallbackPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

module.exports = {
  prepareImageForUpload,
};
