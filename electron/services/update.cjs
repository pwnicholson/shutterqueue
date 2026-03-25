function parseSemverLoose(v) {
  const s = String(v || "").trim();
  const m = s.match(/^v?(\d+(?:\.\d+){0,3})([a-z]+)?(?:[-+].*)?$/i);
  if (!m) return null;
  const parts = m[1].split(".").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  while (parts.length < 4) parts.push(0);
  const suffix = m[2] ? m[2].toLowerCase() : "";
  return [...parts, suffix];
}

function compareSemverLoose(a, b) {
  const pa = parseSemverLoose(a);
  const pb = parseSemverLoose(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 4; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  // Compare suffixes: if one has a suffix and the other doesn't, the one with suffix is newer
  const suffixA = pa[4] || "";
  const suffixB = pb[4] || "";
  if (suffixA && !suffixB) return 1; // 0.9.6a > 0.9.6
  if (!suffixA && suffixB) return -1; // 0.9.6 < 0.9.6a
  if (suffixA && suffixB) return suffixA.localeCompare(suffixB); // Compare suffixes if both exist
  return 0;
}

function deriveCachedUpdateResult(cached, currentVersion) {
  if (!cached || typeof cached !== "object") return null;

  const result = {
    ...cached,
    currentVersion: String(currentVersion || ""),
    cacheHit: true,
  };

  const cachedCurrent = String(cached.currentVersion || "");
  if (cachedCurrent === result.currentVersion) {
    return result;
  }

  const latestVersion = String(cached.latestVersion || "").replace(/^v/i, "");
  if (!latestVersion) return null;

  return {
    ...result,
    latestVersion,
    updateAvailable: compareSemverLoose(result.currentVersion, latestVersion) < 0,
  };
}

module.exports = {
  parseSemverLoose,
  compareSemverLoose,
  deriveCachedUpdateResult,
};
