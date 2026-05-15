const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const flickr = require("./flickr.cjs");

async function withMockedHttpsRequest(mockImpl, run) {
  const original = https.request;
  https.request = mockImpl;
  try {
    return await run();
  } finally {
    https.request = original;
  }
}

test("Flickr duplicate album detector matches duplicate-title messages", () => {
  const err = new Error("A set with this title already exists");
  assert.equal(flickr.__test__.isLikelyDuplicateAlbumTitleError(err), true);
});

test("Flickr duplicate album detector ignores unrelated errors", () => {
  const err = new Error("Invalid auth token");
  assert.equal(flickr.__test__.isLikelyDuplicateAlbumTitleError(err), false);
});

test("Flickr duplicate album detector supports code+message cases", () => {
  const err = { code: 3, message: "photoset title already exists" };
  assert.equal(flickr.__test__.isLikelyDuplicateAlbumTitleError(err), true);
});

test("Flickr upload destroys photo stream on success", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-flickr-upload-test-"));
  const uploadPath = path.join(tempDir, "photo.jpg");
  fs.writeFileSync(uploadPath, "test");

  const originalCreateReadStream = fs.createReadStream;
  let destroyCalled = false;

  fs.createReadStream = (...args) => {
    const stream = originalCreateReadStream(...args);
    const originalDestroy = stream.destroy.bind(stream);
    stream.destroy = (...destroyArgs) => {
      destroyCalled = true;
      return originalDestroy(...destroyArgs);
    };
    return stream;
  };

  try {
    await withMockedHttpsRequest(
      (_options, onResponse) => {
        const req = new EventEmitter();
        req.setTimeout = () => req;
        req.destroy = (error) => {
          if (error) req.emit("error", error);
        };
        req.on = EventEmitter.prototype.on;
        req.once = EventEmitter.prototype.once;
        req.emit = EventEmitter.prototype.emit;
        req.write = () => true;
        req.end = () => {
          const res = new EventEmitter();
          res.statusCode = 200;
          process.nextTick(() => {
            onResponse(res);
            process.nextTick(() => {
              res.emit("data", "<rsp stat=\"ok\"><photoid>12345</photoid></rsp>");
              res.emit("end");
            });
          });
        };
        return req;
      },
      async () => {
        const photoId = await flickr.uploadPhoto({
          apiKey: "key",
          apiSecret: "secret",
          token: "token",
          tokenSecret: "token-secret",
          item: {
            photoPath: uploadPath,
            title: "Title",
            description: "Description",
            tags: "tag1, tag2",
            privacy: "private",
            safetyLevel: 1,
          },
        });

        assert.equal(photoId, "12345");
      }
    );
  } finally {
    fs.createReadStream = originalCreateReadStream;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  assert.equal(destroyCalled, true);
});
