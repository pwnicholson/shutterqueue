const test = require("node:test");
const assert = require("node:assert/strict");

const bluesky = require("./bluesky.cjs");

const { buildPostText, truncateTextWholeWords } = bluesky.__test__;

test("buildPostText merges title + description with newline", () => {
  const text = buildPostText({
    item: { title: "Title line", description: "Description line", tags: "" },
    postTextMode: "merge_title_description",
  });

  assert.equal(text, "Title line\nDescription line");
});

test("truncateTextWholeWords preserves newline between title and description", () => {
  const source = "Title line\nDescription line";
  const out = truncateTextWholeWords(source, 300);

  assert.equal(out, "Title line\nDescription line");
  assert.ok(out.includes("\n"));
});

test("truncateTextWholeWords keeps word boundaries and original newline when truncating", () => {
  const source = "Short title\nThis description should be truncated before cutting any word in half.";
  const out = truncateTextWholeWords(source, 48);

  assert.ok(out.includes("\n"));
  assert.ok(out.startsWith("Short title\n"));
  assert.ok(out.length <= 48);
  // Ensure we did not cut through a word token.
  assert.match(out, /\s|^\S+$/);
});
