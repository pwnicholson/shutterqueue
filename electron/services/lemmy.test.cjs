const test = require("node:test");
const assert = require("node:assert/strict");

const lemmy = require("./lemmy.cjs");

const {
  buildPostText,
  normalizeInstanceUrl,
  extractLemmyImageLimitsFromSitePayload,
  looksLikeLikelyUploadedImageUrl,
  collectUploadedImageUrlCandidates,
  pickUploadedImageUrl,
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
