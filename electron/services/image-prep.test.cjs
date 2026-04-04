const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const { prepareImageForUpload } = require("./image-prep.cjs");

async function createNoiseJpeg(filePath, width, height, quality) {
  const pixelCount = width * height * 3;
  const raw = Buffer.allocUnsafe(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    raw[i] = Math.floor(Math.random() * 256);
  }
  await sharp(raw, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .jpeg({ quality })
    .toFile(filePath);
}

test("prepareImageForUpload enforces byte limit with resize/compression", async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sq-prep-test-"));
  const sourcePath = path.join(tmpDir, "source.jpg");
  await createNoiseJpeg(sourcePath, 1800, 1200, 100);

  const sourceStat = await fs.promises.stat(sourcePath);
  assert.ok(sourceStat.size > 100000);

  const prepared = await prepareImageForUpload(sourcePath, { maxBytes: 100000 });
  try {
    const preparedStat = await fs.promises.stat(prepared.filePath);
    assert.ok(preparedStat.size <= 100000);
    assert.equal(prepared.contentType, "image/jpeg");
    assert.ok(prepared.transformed);
  } finally {
    await prepared.cleanup();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

test("prepareImageForUpload preserves aspect ratio when matrix limit applies", async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sq-prep-test-"));
  const sourcePath = path.join(tmpDir, "source.jpg");
  await createNoiseJpeg(sourcePath, 1600, 800, 95);

  const prepared = await prepareImageForUpload(sourcePath, { maxPixels: 1000000 });
  try {
    const sourceMeta = await sharp(sourcePath).metadata();
    const preparedMeta = await sharp(prepared.filePath).metadata();
    assert.ok(preparedMeta.width * preparedMeta.height <= 1000000);

    const srcRatio = sourceMeta.width / sourceMeta.height;
    const outRatio = preparedMeta.width / preparedMeta.height;
    assert.ok(Math.abs(srcRatio - outRatio) < 0.01);
  } finally {
    await prepared.cleanup();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});
