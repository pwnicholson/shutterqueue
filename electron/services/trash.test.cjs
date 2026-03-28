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
