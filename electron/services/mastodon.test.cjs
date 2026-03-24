const test = require("node:test");
const assert = require("node:assert/strict");

const mastodon = require("./mastodon.cjs");

const { buildPostText, mapPrivacyToVisibility } = mastodon.__test__;

test("Mastodon buildPostText keeps newline between title and description", () => {
  const text = buildPostText({
    item: { title: "Title", description: "Description", tags: "" },
    postTextMode: "merge_title_description",
  });
  assert.equal(text, "Title\nDescription");
});

test("Mastodon buildPostText appends hashtags on separate line", () => {
  const text = buildPostText({
    item: { title: "Title", description: "Description", tags: "tag one,TagTwo" },
    postTextMode: "merge_title_description_tags",
  });
  assert.equal(text, "Title\nDescription\n#tagone #TagTwo");
});

test("Mastodon buildPostText includes prepend and append lines", () => {
  const text = buildPostText({
    item: { title: "Title", description: "Description", tags: "" },
    postTextMode: "merge_title_description",
    prependText: "Prefix",
    appendText: "Suffix",
  });
  assert.equal(text, "Prefix\nTitle\nDescription\nSuffix");
});

test("Mastodon unsupported privacy maps to private with warning", () => {
  const out = mapPrivacyToVisibility("friends");
  assert.equal(out.visibility, "private");
  assert.match(out.warning, /not supported/i);
});

test("Mastodon public/private privacy values stay unchanged", () => {
  assert.equal(mapPrivacyToVisibility("public").visibility, "public");
  assert.equal(mapPrivacyToVisibility("private").visibility, "private");
});
