const test = require("node:test");
const assert = require("node:assert/strict");

const queue = require("./queue.cjs");

test("normalizeImportedQueue preserves all supported target services", () => {
  const input = [
    {
      id: "a1",
      photoPath: "C:/tmp/photo.jpg",
      targetServices: ["Mastodon", "pixelfed", "Bluesky", "tumblr", "flickr"],
    },
  ];

  const out = queue.normalizeImportedQueue(input);
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.items[0].targetServices, ["mastodon", "pixelfed", "bluesky", "tumblr", "flickr"]);
});

test("normalizeImportedQueue removes unknown services and de-dupes", () => {
  const input = [
    {
      id: "a2",
      photoPath: "C:/tmp/photo.jpg",
      targetServices: ["flickr", "Flickr", "mastodon", "unknown-service", "Mastodon"],
    },
  ];

  const out = queue.normalizeImportedQueue(input);
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.items[0].targetServices, ["flickr", "mastodon"]);
});

test("normalizeImportedQueue allows empty service list (no platform selected)", () => {
  const input = [
    {
      id: "a3",
      photoPath: "C:/tmp/photo.jpg",
      targetServices: ["not-real"],
    },
    {
      id: "a4",
      photoPath: "C:/tmp/photo2.jpg",
      targetServices: [],
    },
  ];

  const out = queue.normalizeImportedQueue(input);
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items[0].targetServices, []);
  assert.deepEqual(out.items[1].targetServices, []);
});

test("normalizeImportedQueue accepts legacy path keys", () => {
  const input = [
    {
      id: "legacy-1",
      path: "C:/tmp/photo.jpg",
      targetServices: ["flickr"],
    },
  ];

  const out = queue.normalizeImportedQueue(input);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].photoPath, "C:/tmp/photo.jpg");
});

test("normalizeImportedQueue converts file URL paths for thumbnail compatibility", () => {
  const input = [
    {
      id: "legacy-2",
      photoPath: "file:///C:/Users/Test/Pictures/Old%20Photo.jpg",
      targetServices: ["flickr"],
    },
  ];

  const out = queue.normalizeImportedQueue(input);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].photoPath, "C:/Users/Test/Pictures/Old Photo.jpg");
});

test("normalizeImportedQueue keeps Lemmy original community when valid", () => {
  const input = [
    {
      id: "lemmy-1",
      photoPath: "C:/tmp/photo.jpg",
      targetServices: ["lemmy"],
      lemmyCommunityIds: ["10", "20", "30"],
      lemmyOriginalCommunityId: "20",
    },
  ];

  const out = queue.normalizeImportedQueue(input);
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.items[0].lemmyCommunityIds, ["10", "20", "30"]);
  assert.equal(out.items[0].lemmyOriginalCommunityId, "20");
});

test("normalizeImportedQueue falls back Lemmy original community to first selected", () => {
  const input = [
    {
      id: "lemmy-2",
      photoPath: "C:/tmp/photo.jpg",
      targetServices: ["lemmy"],
      lemmyCommunityIds: ["10", "20"],
      lemmyOriginalCommunityId: "99",
    },
  ];

  const out = queue.normalizeImportedQueue(input);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].lemmyOriginalCommunityId, "10");
});

test("relinkMissingPhotoPaths remaps missing files by filename", () => {
  const queueItems = [
    { id: "1", photoPath: "D:/old-folder/photo-001.jpg" },
    { id: "2", photoPath: "D:/old-folder/photo-002.jpg" },
  ];
  const candidates = [
    "E:/new-folder/photo-001.jpg",
    "E:/new-folder/photo-002.jpg",
  ];
  const existing = new Set(candidates.map((p) => p.toLowerCase()));

  const result = queue.relinkMissingPhotoPaths(queueItems, candidates, {
    existsFn: (p) => existing.has(String(p || "").toLowerCase()),
  });

  assert.equal(result.scannedMissing, 2);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.queue[0].photoPath, "E:/new-folder/photo-001.jpg");
  assert.equal(result.queue[1].photoPath, "E:/new-folder/photo-002.jpg");
});

test("relinkMissingPhotoPaths leaves ambiguous filename matches unresolved", () => {
  const queueItems = [
    { id: "1", photoPath: "D:/old-folder/photo-001.jpg" },
  ];
  const candidates = [
    "E:/set-a/photo-001.jpg",
    "E:/set-b/photo-001.jpg",
  ];
  const existing = new Set(candidates.map((p) => p.toLowerCase()));

  const result = queue.relinkMissingPhotoPaths(queueItems, candidates, {
    existsFn: (p) => existing.has(String(p || "").toLowerCase()),
  });

  assert.equal(result.scannedMissing, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.ambiguousCount, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.queue[0].photoPath, "D:/old-folder/photo-001.jpg");
});

test("parseDateTakenToMs parses EXIF colon datetime", () => {
  const ms = queue.parseDateTakenToMs("2026:03:25 07:08:09");
  assert.equal(Number.isFinite(ms), true);
  assert.equal(new Date(ms).toISOString(), "2026-03-25T07:08:09.000Z");
});

test("parseDateTakenToMs applies explicit timezone offsets", () => {
  const ms = queue.parseDateTakenToMs("2026:03:25 07:08:09+02:30");
  assert.equal(Number.isFinite(ms), true);
  assert.equal(new Date(ms).toISOString(), "2026-03-25T04:38:09.000Z");
});

test("createClonedQueueItem copies metadata and resets upload state", () => {
  const source = {
    id: "orig",
    photoPath: "C:/tmp/photo.jpg",
    targetServices: ["flickr", "tumblr"],
    title: "Title",
    description: "Desc",
    tags: "a, b",
    groupIds: ["g1"],
    albumIds: ["a1"],
    createAlbums: ["new album"],
    privacy: "private",
    safetyLevel: 1,
    status: "done_warn",
    lastError: "warn",
    photoId: "123",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    scheduledUploadAt: "2026-01-02T00:00:00.000Z",
    serviceStates: { flickr: { status: "done" } },
    groupAddStates: { g1: { status: "retry" } },
  };

  const cloned = queue.__test__.createClonedQueueItem(source, { clearTargetServices: true });
  assert.ok(cloned);
  assert.notEqual(cloned.id, source.id);
  assert.equal(cloned.photoPath, source.photoPath);
  assert.equal(cloned.title, source.title);
  assert.equal(cloned.description, source.description);
  assert.equal(cloned.tags, source.tags);
  assert.deepEqual(cloned.targetServices, []);
  assert.equal(cloned.status, "pending");
  assert.equal(cloned.lastError, "");
  assert.equal(cloned.photoId, "");
  assert.equal(cloned.uploadedAt, "");
  assert.equal(cloned.scheduledUploadAt, "");
  assert.deepEqual(cloned.serviceStates, {});
  assert.equal(cloned.groupAddStates, undefined);
});
