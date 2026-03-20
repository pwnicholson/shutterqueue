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

test("normalizeImportedQueue defaults to flickr when service list is empty/invalid", () => {
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
  assert.deepEqual(out.items[0].targetServices, ["flickr"]);
  assert.deepEqual(out.items[1].targetServices, ["flickr"]);
});
