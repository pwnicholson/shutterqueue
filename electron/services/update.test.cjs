const test = require("node:test");
const assert = require("node:assert/strict");

const update = require("./update.cjs");

test("compareSemverLoose handles v-prefix and patch versions", () => {
  assert.equal(update.compareSemverLoose("0.9.5", "v0.9.6"), -1);
  assert.equal(update.compareSemverLoose("0.9.6", "v0.9.6"), 0);
  assert.equal(update.compareSemverLoose("0.9.7", "v0.9.6"), 1);
});

test("compareSemverLoose accepts local letter suffix versions", () => {
  assert.equal(update.compareSemverLoose("0.9.6a", "v0.9.6"), 1);
  assert.equal(update.compareSemverLoose("v0.9.6a", "0.9.7"), -1);
});

test("deriveCachedUpdateResult keeps fresh cache for same current version", () => {
  const cached = {
    checkedAt: Date.now(),
    currentVersion: "0.9.5",
    latestVersion: "0.9.6",
    updateAvailable: true,
  };

  const out = update.deriveCachedUpdateResult(cached, "0.9.5");
  assert.ok(out);
  assert.equal(out.currentVersion, "0.9.5");
  assert.equal(out.updateAvailable, true);
  assert.equal(out.cacheHit, true);
});

test("deriveCachedUpdateResult clears stale update when app version catches up", () => {
  const cached = {
    checkedAt: Date.now(),
    currentVersion: "0.9.5",
    latestVersion: "0.9.6",
    updateAvailable: true,
  };

  const out = update.deriveCachedUpdateResult(cached, "0.9.6");
  assert.ok(out);
  assert.equal(out.currentVersion, "0.9.6");
  assert.equal(out.updateAvailable, false);
  assert.equal(out.cacheHit, true);
});

test("deriveCachedUpdateResult returns null for version mismatch without latestVersion", () => {
  const cached = {
    checkedAt: Date.now(),
    currentVersion: "0.9.5",
    updateAvailable: true,
  };

  const out = update.deriveCachedUpdateResult(cached, "0.9.6");
  assert.equal(out, null);
});
