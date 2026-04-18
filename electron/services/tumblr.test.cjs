const test = require("node:test");
const assert = require("node:assert/strict");

const tumblr = require("./tumblr.cjs");

const { buildCaption, normalizeTagsCsv, resolveTumblrPostState, parseApiResponse, isLikelyTumblrMediaProcessingError } = tumblr.__test__;

test("Tumblr buildCaption merges bold title and description", () => {
  const caption = buildCaption({
    title: "Title",
    description: "Description",
    postTextMode: "bold_title_then_description",
  });

  assert.equal(caption, "<b>Title</b>\nDescription");
});

test("Tumblr buildCaption includes prepend and append lines", () => {
  const caption = buildCaption({
    title: "Title",
    description: "Description",
    postTextMode: "title_then_description",
    prependText: "Prefix",
    appendText: "Suffix",
  });

  assert.equal(caption, "Prefix\nTitle\nDescription\nSuffix");
});

test("Tumblr normalizeTagsCsv trims and removes blanks", () => {
  const tags = normalizeTagsCsv(" one, , two ,three ");
  assert.equal(tags, "one,two,three");
});

test("Tumblr resolveTumblrPostState maps setup timing mode for non-private posts", () => {
  assert.equal(resolveTumblrPostState({ privacy: "public", postTimingMode: "publish_now" }), "published");
  assert.equal(resolveTumblrPostState({ privacy: "public", postTimingMode: "add_to_queue" }), "queue");
});

test("Tumblr resolveTumblrPostState keeps private visibility as private", () => {
  assert.equal(resolveTumblrPostState({ privacy: "private", postTimingMode: "publish_now" }), "private");
  assert.equal(resolveTumblrPostState({ privacy: "private", postTimingMode: "add_to_queue" }), "private");
});

test("Tumblr parseApiResponse prefers nested response.errors detail for 400s", () => {
  const payload = JSON.stringify({
    meta: { status: 400, msg: "Bad Request" },
    response: {
      errors: [
        {
          title: "Invalid request",
          detail: "Queue is full for this blog",
          code: 1234,
        },
      ],
    },
  });

  assert.throws(() => parseApiResponse(payload, 400), /Queue is full for this blog/);
});

test("Tumblr parseApiResponse falls back to meta.msg when no nested detail exists", () => {
  const payload = JSON.stringify({
    meta: { status: 400, msg: "Bad Request" },
    response: {},
  });

  assert.throws(() => parseApiResponse(payload, 400), /Bad Request \(HTTP 400\)/);
});

test("Tumblr parseApiResponse handles object-shaped response.errors", () => {
  const payload = JSON.stringify({
    meta: { status: 400, msg: "Bad Request" },
    response: {
      errors: {
        post: [{ detail: "Caption is too long" }],
      },
    },
  });

  assert.throws(() => parseApiResponse(payload, 400), /Caption is too long/);
});

test("Tumblr parseApiResponse uses response.error_description when present", () => {
  const payload = JSON.stringify({
    meta: { status: 401, msg: "Unauthorized" },
    response: {
      error_description: "Token expired",
    },
  });

  assert.throws(() => parseApiResponse(payload, 401), /Token expired/);
});

test("Tumblr media-processing detector catches size and magick failures", () => {
  assert.equal(isLikelyTumblrMediaProcessingError("Media file too large"), true);
  assert.equal(isLikelyTumblrMediaProcessingError("Magick error: convert: Insufficient memory (case 4)"), true);
});

test("Tumblr media-processing detector ignores unrelated errors", () => {
  assert.equal(isLikelyTumblrMediaProcessingError("Unauthorized"), false);
  assert.equal(isLikelyTumblrMediaProcessingError("Blog not found"), false);
});
