const test = require("node:test");
const assert = require("node:assert/strict");

const tumblr = require("./tumblr.cjs");

const { buildCaption, normalizeTagsCsv, resolveTumblrPostState } = tumblr.__test__;

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
