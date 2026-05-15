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
    throw new Error("Unexpected policy failure");
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

test("movePathsToTrash retries common Windows lock signatures", async () => {
  let attempts = 0;
  const fakeTrashItem = async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error("EPERM: operation not permitted, file is open in another program");
    }
  };

  const out = await trash.movePathsToTrash(["C:/photos/locked-transient.jpg"], {
    trashItem: fakeTrashItem,
    maxAttempts: 4,
    retryDelayMs: 1,
  });

  assert.equal(attempts, 3);
  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.retried.length, 1);
  assert.equal(out.retried[0].attempts, 3);
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

test("movePathsToTrash uses fallback strategy after retryable abort failures", async () => {
  let primaryAttempts = 0;
  let fallbackAttempts = 0;
  const out = await trash.movePathsToTrash([__filename], {
    trashItem: async () => {
      primaryAttempts++;
      throw new Error("Operation was aborted");
    },
    fallbackTrashItem: async () => {
      fallbackAttempts++;
    },
    maxAttempts: 2,
    retryDelayMs: 1,
  });

  assert.equal(primaryAttempts, 3); // 2 attempts + 1 grace attempt
  assert.equal(fallbackAttempts, 1);
  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.fallbackMoved.length, 1);
  assert.equal(out.fallbackMoved[0].photoPath, __filename);
});

test("movePathsToTrash reports failure when fallback strategy also fails", async () => {
  const out = await trash.movePathsToTrash([__filename], {
    trashItem: async () => {
      throw new Error("Operation was aborted");
    },
    fallbackTrashItem: async () => {
      throw new Error("PowerShell recycle fallback failed");
    },
    maxAttempts: 1,
    retryDelayMs: 1,
  });

  assert.equal(out.movedCount, 0);
  assert.equal(out.failedCount, 1);
  assert.equal(out.fallbackMoved.length, 0);
  assert.match(String(out.failed[0].error || ""), /PowerShell recycle fallback failed/);
  assert.equal(out.failed[0].attempts, 3); // initial + grace + fallback
});

test("movePathsToTrash can retry fallback strategy before succeeding", async () => {
  let fallbackAttempts = 0;
  const out = await trash.movePathsToTrash([__filename], {
    trashItem: async () => {
      throw new Error("Operation was aborted");
    },
    fallbackTrashItem: async () => {
      fallbackAttempts++;
      if (fallbackAttempts < 3) {
        throw new Error("EPERM: file is open in another program");
      }
    },
    maxAttempts: 1,
    retryDelayMs: 1,
    fallbackMaxAttempts: 3,
    fallbackRetryDelayMs: 1,
  });

  assert.equal(fallbackAttempts, 3);
  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.fallbackMoved.length, 1);
  assert.equal(out.fallbackMoved[0].attempts, 5); // initial + grace + 3 fallback tries
});

test("movePathsToTrash retries PowerShell did-not-move fallback outcomes", async () => {
  let fallbackAttempts = 0;
  const out = await trash.movePathsToTrash([__filename], {
    trashItem: async () => {
      throw new Error("Operation was aborted");
    },
    fallbackTrashItem: async () => {
      fallbackAttempts++;
      if (fallbackAttempts < 2) {
        throw new Error("PowerShell recycle fallback failed: PowerShell recycle fallback did not move file.");
      }
    },
    maxAttempts: 1,
    retryDelayMs: 1,
    fallbackMaxAttempts: 2,
    fallbackRetryDelayMs: 1,
  });

  assert.equal(fallbackAttempts, 2);
  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.fallbackMoved.length, 1);
  assert.equal(out.fallbackMoved[0].attempts, 4); // initial + grace + 2 fallback tries
});

test("movePathsToTrash honors initialDelayMs before first attempt", async () => {
  const startedAt = Date.now();
  let firstAttemptAt = 0;
  const out = await trash.movePathsToTrash(["C:/photos/initial-delay.jpg"], {
    trashItem: async () => {
      if (!firstAttemptAt) firstAttemptAt = Date.now();
    },
    maxAttempts: 1,
    retryDelayMs: 1,
    initialDelayMs: 20,
  });

  assert.equal(out.movedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.ok(firstAttemptAt - startedAt >= 15);
});

test("movePathsToTrash reports per-attempt failures to callback", async () => {
  const events = [];
  const out = await trash.movePathsToTrash([__filename], {
    trashItem: async () => {
      throw new Error("Operation was aborted");
    },
    fallbackTrashItem: async () => {
      throw new Error("EPERM: file is open in another program");
    },
    maxAttempts: 1,
    retryDelayMs: 1,
    fallbackMaxAttempts: 2,
    fallbackRetryDelayMs: 1,
    onAttemptFailure: async (event) => {
      events.push(event);
    },
  });

  assert.equal(out.failedCount, 1);
  assert.ok(events.length >= 3);
  assert.equal(events[0].stage, "primary");
  assert.equal(events[1].stage, "primary_grace");
  assert.equal(events[2].stage, "fallback");
});
