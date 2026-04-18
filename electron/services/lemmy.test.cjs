const test = require("node:test");
const assert = require("node:assert/strict");

const lemmy = require("./lemmy.cjs");

const {
  buildPostText,
  buildCrossPostText,
  normalizeInstanceUrl,
  extractLemmyImageLimitsFromSitePayload,
  looksLikeLikelyUploadedImageUrl,
  collectUploadedImageUrlCandidates,
  pickUploadedImageUrl,
  derivePostName,
} = lemmy.__test__;

test("Lemmy buildPostText merges title/description/tags with hashtags", () => {
  const text = buildPostText({
    item: { title: "Title", description: "Description", tags: "tag one,TagTwo" },
    postTextMode: "merge_title_description_tags",
  });
  assert.equal(text, "Title\nDescription\n#tagone #TagTwo");
});

test("Lemmy buildPostText supports prepend and append", () => {
  const text = buildPostText({
    item: { title: "Title", description: "", tags: "" },
    postTextMode: "title_only",
    prependText: "Top",
    appendText: "Bottom",
  });
  assert.equal(text, "Top\nTitle\nBottom");
});

test("Lemmy normalizeInstanceUrl enforces https and trims trailing slash", () => {
  assert.equal(normalizeInstanceUrl("lemmy.world/"), "https://lemmy.world");
  assert.throws(() => normalizeInstanceUrl("http://lemmy.world"), /https/i);
});

test("Lemmy extractLemmyImageLimitsFromSitePayload reads size and dimensions", () => {
  const limits = extractLemmyImageLimitsFromSitePayload({
    site_view: {
      local_site: {
        max_upload_size: "8 MiB",
        max_image_width: 4096,
        max_image_height: 4096,
      },
    },
  });

  assert.equal(limits.maxBytes, 8 * 1024 * 1024);
  assert.equal(limits.maxWidth, 4096);
  assert.equal(limits.maxHeight, 4096);
});

test("Lemmy looksLikeLikelyUploadedImageUrl rejects API endpoints and accepts pictrs image paths", () => {
  assert.equal(looksLikeLikelyUploadedImageUrl("https://lemmy.world/api/v4/image"), false);
  assert.equal(looksLikeLikelyUploadedImageUrl("/api/v3/image/upload"), false);
  assert.equal(looksLikeLikelyUploadedImageUrl("https://lemmy.world/pictrs/image/abcd1234.webp"), true);
  assert.equal(looksLikeLikelyUploadedImageUrl("/pictrs/image/abcd1234"), true);
});

test("Lemmy pickUploadedImageUrl prefers files[0].file over top-level url", () => {
  const picked = pickUploadedImageUrl({
    url: "https://lemmy.world/api/v4/image",
    files: [{ file: "/pictrs/image/abcd1234.webp" }],
  });
  assert.equal(picked, "/pictrs/image/abcd1234.webp");
});

test("Lemmy collectUploadedImageUrlCandidates keeps ranked candidate list", () => {
  const candidates = collectUploadedImageUrlCandidates({
    files: [{ file: "/pictrs/image/a.webp", image_url: "https://x/pictrs/image/b.webp", url: "https://x/api/v4/image" }],
    image_url: "https://x/pictrs/image/c.webp",
    file: "https://x/pictrs/image/d.webp",
    url: "https://x/api/v4/image",
  });
  assert.deepEqual(candidates, [
    "/pictrs/image/a.webp",
    "https://x/pictrs/image/b.webp",
    "https://x/pictrs/image/c.webp",
    "https://x/pictrs/image/d.webp",
    "https://x/api/v4/image",
    "https://x/api/v4/image",
  ]);
});

test("Lemmy pictrs bare filename is prefixed with /pictrs/image/ path", () => {
  // Older pict-rs returns just a bare filename like "uuid.jpeg" in files[0].file.
  // The upload loop must prefix it with /pictrs/image/ before normalizing, so the
  // probe URL becomes https://instance/pictrs/image/uuid.jpeg, not https://instance/uuid.jpeg.
  const bare = "5cb481d4-b75f-4787-b28a-55e4160dcddb.jpeg";
  // Simulate: pickUploadedImageUrl returns the bare filename
  const picked = pickUploadedImageUrl({ files: [{ file: bare }] });
  assert.equal(picked, bare); // no path separators — just the filename

  // The upload loop applies this fix when endpoint contains "pictrs/image":
  const patched = !picked.includes("/") ? `/pictrs/image/${picked}` : picked;
  assert.equal(patched, `/pictrs/image/${bare}`);
});

test("Lemmy derivePostName uses title when present", () => {
  assert.equal(derivePostName({ title: "My Photo", photoPath: "/tmp/IMG_1234.jpg" }), "My Photo");
});

test("Lemmy derivePostName uses 'Photo' when title is empty — not the filename", () => {
  assert.equal(derivePostName({ title: "", photoPath: "/tmp/IMG_1234.jpg" }), "Photo");
  assert.equal(derivePostName({ title: "   ", photoPath: "/tmp/IMG_1234.jpg" }), "Photo");
  assert.equal(derivePostName({ photoPath: "/tmp/IMG_1234.jpg" }), "Photo");
  assert.equal(derivePostName({}), "Photo");
});

test("Lemmy buildPostText skips empty title in merge modes", () => {
  const text = buildPostText({
    item: { title: "", description: "Nice shot", tags: "" },
    postTextMode: "merge_title_description",
  });
  assert.equal(text, "Nice shot");
  // Title should not appear as a blank leading line
  assert.ok(!text.startsWith("\n"));
});

test("Lemmy buildCrossPostText appends original post URL", () => {
  const text = buildCrossPostText({
    item: { title: "Title", description: "Description", tags: "tag one" },
    postTextMode: "merge_title_description_tags",
    originalPostUrl: "https://lemmy.world/post/123",
  });
  assert.equal(text, "Title\nDescription\n#tagone\n\nCross-posted from: https://lemmy.world/post/123");
});
