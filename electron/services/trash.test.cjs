const test = require("node:test");
const assert = require("node:assert/strict");

const trash = require("./trash.cjs");

test("collectUniquePhotoPathsByQueueIds returns unique matched paths in queue order", () => {
  const queueItems = [
    { id: "a", photoPath: "C:/photos/1.jpg" },
    { id: "b", photoPath: "C:/photos/2.jpg" },
    { id: "c", photoPath: "C:/photos/1.jpg" },
    { id: "d", photoPath: "" },
  ];

  const out = trash.collectUniquePhotoPathsByQueueIds(queueItems, ["c", "b", "x", "d"]);
  assert.deepEqual(out, ["C:/photos/2.jpg", "C:/photos/1.jpg"]);
});

test("getTrashLabel returns Trash Can on macOS and Recycle Bin elsewhere", () => {
  assert.equal(trash.getTrashLabel("darwin"), "Trash Can");
  assert.equal(trash.getTrashLabel("win32"), "Recycle Bin");
  assert.equal(trash.getTrashLabel("linux"), "Recycle Bin");
});

test("movePathsToTrash retries transient aborted operations", async () => {
  const attemptsByPath = new Map();
  const fakeTrashItem = async (photoPath) => {
    const attempts = Number(attemptsByPath.get(photoPath) || 0) + 1;
    attemptsByPath.set(photoPath, attempts);
    if (photoPath === "C:/photos/retry.jpg" && attempts < 3) {
      throw new Error("Operation was aborted");
    }
  };

  const out = await trash.movePathsToTrash(["C:/photos/retry.jpg"], {
    trashItem: fakeTrashItem,
    maxAttempts: 3,
    retryDelayMs: 1,
  });

  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.skippedMissing, 0);
  assert.equal(out.retried.length, 1);
  assert.equal(out.retried[0].attempts, 3);
});

test("movePathsToTrash retries AbortError signatures", async () => {
  let attempts = 0;
  const fakeTrashItem = async () => {
    attempts++;
    if (attempts < 2) throw new Error("AbortError: The operation was aborted");
  };

  const out = await trash.movePathsToTrash(["C:/photos/aborterror.jpg"], {
    trashItem: fakeTrashItem,
    maxAttempts: 3,
    retryDelayMs: 1,
  });

  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.retried.length, 1);
  assert.equal(out.retried[0].attempts, 2);
});

test("movePathsToTrash performs one final grace retry after max abort attempts", async () => {
  let attempts = 0;
  const fakeTrashItem = async () => {
    attempts++;
    if (attempts < 4) throw new Error("Operation was aborted");
  };

  const out = await trash.movePathsToTrash([__filename], {
    trashItem: fakeTrashItem,
    maxAttempts: 3,
    retryDelayMs: 1,
  });

  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.retried.length, 1);
  assert.equal(out.retried[0].attempts, 4);
});

test("movePathsToTrash treats missing-file trash errors as skipped missing", async () => {
  const fakeTrashItem = async () => {
    throw new Error("ENOENT: no such file or directory");
  };

  const out = await trash.movePathsToTrash(["C:/photos/missing.jpg"], {
    trashItem: fakeTrashItem,
    maxAttempts: 3,
    retryDelayMs: 1,
  });

  assert.equal(out.movedCount, 0);
  assert.equal(out.failedCount, 0);
  assert.equal(out.skippedMissing, 1);
  assert.equal(out.failed.length, 0);
});

test("movePathsToTrash reports non-retryable failures", async () => {
  let attempts = 0;
  const fakeTrashItem = async () => {
    attempts++;
    throw new Error("Access denied");
  };

  const out = await trash.movePathsToTrash(["C:/photos/locked.jpg"], {
    trashItem: fakeTrashItem,
    maxAttempts: 3,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 1);
  assert.equal(out.movedCount, 0);
  assert.equal(out.failedCount, 1);
  assert.equal(out.skippedMissing, 0);
  assert.equal(out.failed[0].attempts, 1);
});

test("movePathsToTrash reports moved path list", async () => {
  const out = await trash.movePathsToTrash(["C:/photos/a.jpg", "C:/photos/b.jpg"], {
    trashItem: async () => {},
    maxAttempts: 1,
    retryDelayMs: 1,
  });

  assert.deepEqual(out.movedPaths, ["C:/photos/a.jpg", "C:/photos/b.jpg"]);
  assert.deepEqual(out.skippedMissingPaths, []);
});

test("movePathsToTrash reports skipped-missing path list", async () => {
  const out = await trash.movePathsToTrash(["C:/photos/missing.jpg"], {
    trashItem: async () => {
      throw new Error("ENOENT: no such file or directory");
    },
    maxAttempts: 1,
    retryDelayMs: 1,
  });

  assert.deepEqual(out.movedPaths, []);
  assert.deepEqual(out.skippedMissingPaths, ["C:/photos/missing.jpg"]);
});
