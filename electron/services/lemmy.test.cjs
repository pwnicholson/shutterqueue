const test = require("node:test");
const assert = require("node:assert/strict");

const lemmy = require("./lemmy.cjs");

const { buildPostText, normalizeInstanceUrl } = lemmy.__test__;

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
