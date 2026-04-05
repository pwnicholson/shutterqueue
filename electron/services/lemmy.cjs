// NOTE: Lemmy integration is still unreliable.
// Image upload endpoint and field names vary significantly across Lemmy instances.
// ShutterQueue uses a self-healing probe cache to discover working combinations, but
// images may still not display correctly on some instances. Known issue, under investigation.

const fs = require("fs");
const https = require("https");
const FormData = require("form-data");
const mime = require("mime-types");
const path = require("path");
const { prepareImageForUpload } = require("./image-prep.cjs");

const DEFAULT_LEMMY_INSTANCE = "https://lemmy.world";
const INSTANCE_LIMITS_CACHE = new Map();
const INSTANCE_LIMITS_TTL_MS = 10 * 60 * 1000;
const DISCOVERED_LIMITS_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const INSTANCE_UPLOAD_CONFIG_CACHE = new Map();
const INSTANCE_UPLOAD_CONFIG_STALE_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeInstanceUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return DEFAULT_LEMMY_INSTANCE;
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const u = new URL(withProtocol);
  if (u.protocol !== "https:") {
    throw new Error("Lemmy instance URL must use https.");
  }
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}

function requestJson({ instanceUrl, apiPath, method, accessToken, query, body }) {
  const base = new URL(normalizeInstanceUrl(instanceUrl));
  const pathUrl = new URL(String(apiPath || "/"), `${base.toString()}/`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    pathUrl.searchParams.set(k, String(v));
  }

  const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf-8");
  const reqHeaders = {
    Accept: "application/json",
    ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
    ...(accessToken ? { Authorization: `Bearer ${String(accessToken || "")}` } : {}),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: String(method || "GET"),
        hostname: pathUrl.hostname,
        port: pathUrl.port || undefined,
        path: `${pathUrl.pathname}${pathUrl.search}`,
        headers: reqHeaders,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const status = Number(res.statusCode || 0);
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = null;
          }
          if (status < 200 || status >= 300) {
            const msg = parsed?.error || parsed?.message || data || `HTTP ${status}`;
            reject(new Error(`Lemmy API error: ${msg}`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseSizeLikeBytes(value) {
  if (typeof value === "number") return parsePositiveInt(value);
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return parsePositiveInt(Number(text));
  const m = text.match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)$/i);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = String(m[2] || "b").toLowerCase();
  const multiplier = unit === "gb" ? 1000 * 1000 * 1000
    : unit === "mb" ? 1000 * 1000
      : unit === "kb" ? 1000
        : unit === "gib" ? 1024 * 1024 * 1024
          : unit === "mib" ? 1024 * 1024
            : unit === "kib" ? 1024
              : 1;
  return parsePositiveInt(amount * multiplier);
}

function normalizeLimitsShape(value) {
  if (!value || typeof value !== "object") {
    return { maxBytes: null, maxPixels: null, maxWidth: null, maxHeight: null };
  }
  return {
    maxBytes: parsePositiveInt(value.maxBytes),
    maxPixels: parsePositiveInt(value.maxPixels),
    maxWidth: parsePositiveInt(value.maxWidth),
    maxHeight: parsePositiveInt(value.maxHeight),
  };
}

function readDiscoveredLimitsFromCache(limitsCache, instanceKey) {
  if (!limitsCache || typeof limitsCache !== "object") return null;
  const entry = limitsCache[instanceKey];
  if (!entry || typeof entry !== "object") return null;
  const cachedAt = Number(entry.cachedAt);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null;
  return {
    cachedAt,
    limits: normalizeLimitsShape(entry.limits),
  };
}

function looksLikeLimitError(err) {
  const text = String(err?.message || err || "").toLowerCase();
  return (
    text.includes("too large") ||
    text.includes("file is too big") ||
    text.includes("file too large") ||
    text.includes("payload too large") ||
    text.includes("maximum") ||
    text.includes("max size") ||
    text.includes("entity too large") ||
    text.includes("413")
  );
}

function readDiscoveredUploadConfigFromCache(uploadConfigCache, instanceKey) {
  if (!uploadConfigCache || typeof uploadConfigCache !== "object") return null;
  const entry = uploadConfigCache[instanceKey];
  if (!entry || typeof entry !== "object") return null;
  const cachedAt = Number(entry.cachedAt);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null;
  if (Date.now() - cachedAt > INSTANCE_UPLOAD_CONFIG_STALE_MS) return null;
  const apiPath = String(entry.apiPath || "").trim();
  const fieldName = String(entry.fieldName || "").trim();
  if (!apiPath || !fieldName) return null;
  return { apiPath, fieldName, cachedAt };
}

function applyResizeOverrides(limits, imageResizeOptions) {
  const base = normalizeLimitsShape(limits);
  const enabled = Boolean(imageResizeOptions?.enabled);
  if (!enabled) return base;

  const overrideW = parsePositiveInt(imageResizeOptions?.maxWidth);
  const overrideH = parsePositiveInt(imageResizeOptions?.maxHeight);

  if (overrideW) {
    base.maxWidth = base.maxWidth ? Math.min(base.maxWidth, overrideW) : overrideW;
  }
  if (overrideH) {
    base.maxHeight = base.maxHeight ? Math.min(base.maxHeight, overrideH) : overrideH;
  }

  return base;
}

function findNumericValueByKeyCandidates(root, keyPatterns) {
  const queue = [root];
  const visited = new Set();
  const values = [];

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (visited.has(node)) continue;
    visited.add(node);

    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") queue.push(v);
      if (!keyPatterns.some((re) => re.test(String(k)))) continue;
      const parsed = parseSizeLikeBytes(v);
      if (parsed) values.push(parsed);
    }
  }

  if (!values.length) return null;
  return Math.min(...values);
}

function extractLemmyImageLimitsFromSitePayload(payload) {
  const site = payload?.site_view?.local_site || payload?.local_site || payload?.site?.local_site || {};

  const maxBytes = (
    parseSizeLikeBytes(site?.max_upload_size) ||
    parseSizeLikeBytes(site?.max_image_upload_size) ||
    findNumericValueByKeyCandidates(payload, [
      /max.*image.*size/i,
      /image.*max.*size/i,
      /max.*upload.*size/i,
      /upload.*max.*size/i,
      /max.*file.*size/i,
      /file.*max.*size/i,
    ])
  );

  const maxWidth = (
    parsePositiveInt(site?.max_image_width) ||
    findNumericValueByKeyCandidates(payload, [
      /max.*image.*width/i,
      /image.*max.*width/i,
      /max.*width/i,
    ])
  );

  const maxHeight = (
    parsePositiveInt(site?.max_image_height) ||
    findNumericValueByKeyCandidates(payload, [
      /max.*image.*height/i,
      /image.*max.*height/i,
      /max.*height/i,
    ])
  );

  return normalizeLimitsShape({
    maxBytes,
    maxPixels: null,
    maxWidth,
    maxHeight,
  });
}

async function fetchLemmyImageLimits({ instanceUrl, accessToken, limitsCache, forceRefresh, onDiscoveredLimits }) {
  const key = normalizeInstanceUrl(instanceUrl);
  const now = Date.now();
  const cached = INSTANCE_LIMITS_CACHE.get(key);
  if (!forceRefresh && cached && (now - cached.cachedAt) < INSTANCE_LIMITS_TTL_MS) {
    return cached.limits;
  }

  const discovered = readDiscoveredLimitsFromCache(limitsCache, key);
  if (!forceRefresh && discovered && (now - discovered.cachedAt) < DISCOVERED_LIMITS_STALE_MS) {
    INSTANCE_LIMITS_CACHE.set(key, { cachedAt: discovered.cachedAt, limits: discovered.limits });
    return discovered.limits;
  }

  let payload = null;
  try {
    try {
      payload = await requestJson({
        instanceUrl: key,
        apiPath: "/api/v4/site",
        method: "GET",
        accessToken,
        query: { auth: String(accessToken || "") },
      });
    } catch {
      payload = await requestJson({
        instanceUrl: key,
        apiPath: "/api/v3/site",
        method: "GET",
        accessToken,
        query: { auth: String(accessToken || "") },
      });
    }
  } catch (e) {
    if (discovered) {
      INSTANCE_LIMITS_CACHE.set(key, { cachedAt: discovered.cachedAt, limits: discovered.limits });
      return discovered.limits;
    }
    throw e;
  }

  const limits = extractLemmyImageLimitsFromSitePayload(payload);
  const cachedAt = Date.now();
  INSTANCE_LIMITS_CACHE.set(key, { cachedAt, limits });
  if (typeof onDiscoveredLimits === "function") {
    try {
      onDiscoveredLimits({ instanceKey: key, limits, cachedAt });
    } catch {
      // Ignore cache persistence callback errors.
    }
  }
  return limits;
}

function parseTagsCsv(tagsCsv) {
  const parts = String(tagsCsv || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/^#+/, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p.replace(/^#+/, ""));
  }
  return out;
}

function toHashtag(tag) {
  const raw = String(tag || "").trim().replace(/^#+/, "");
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  const safe = compact.replace(/[^\p{L}\p{N}_]/gu, "");
  if (!safe) return "";
  return `#${safe}`;
}

function buildHashtagLine(tagsCsv) {
  const tags = parseTagsCsv(tagsCsv);
  return tags.map(toHashtag).filter(Boolean).join(" ");
}

function buildPostText({ item, postTextMode, prependText, appendText }) {
  const mode = String(postTextMode || "merge_title_description_tags");
  const title = String(item?.title || "").trim();
  const description = String(item?.description || "").trim();
  const hashtagLine = buildHashtagLine(item?.tags || "");

  let coreText;
  if (mode === "title_only") {
    coreText = title;
  } else if (mode === "description_only") {
    coreText = description;
  } else {
    const lines = [];
    if (mode === "merge_title_description_tags") {
      if (title) lines.push(title);
      if (description) lines.push(description);
      if (hashtagLine) lines.push(hashtagLine);
    } else if (mode === "merge_title_description") {
      if (title) lines.push(title);
      if (description) lines.push(description);
    } else if (mode === "merge_title_tags") {
      if (title) lines.push(title);
      if (hashtagLine) lines.push(hashtagLine);
    } else if (mode === "merge_description_tags") {
      if (description) lines.push(description);
      if (hashtagLine) lines.push(hashtagLine);
    } else {
      if (title) lines.push(title);
      if (description) lines.push(description);
      if (hashtagLine) lines.push(hashtagLine);
    }
    coreText = lines.join("\n").trim();
  }

  const pre = String(prependText || "").trim();
  const app = String(appendText || "").trim();
  const parts = [];
  if (pre) parts.push(pre);
  if (coreText) parts.push(coreText);
  if (app) parts.push(app);
  return parts.join("\n");
}

function extractLemmyUsername(payload) {
  const p = payload || {};
  return String(
    p?.person_view?.person?.name ||
    p?.person_view?.person?.display_name ||
    p?.my_user?.local_user_view?.person?.name ||
    p?.my_user?.local_user_view?.person?.display_name ||
    p?.site_view?.my_user?.local_user_view?.person?.name ||
    ""
  );
}

async function verifyCredentials({ instanceUrl, accessToken }) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("Missing Lemmy access token");

  try {
    const v4 = await requestJson({
      instanceUrl,
      apiPath: "/api/v4/account",
      method: "GET",
      accessToken: token,
    });
    const username = extractLemmyUsername(v4);
    if (username) return { username };
  } catch {
    // fall through
  }

  const v3 = await requestJson({
    instanceUrl,
    apiPath: "/api/v3/site",
    method: "GET",
    accessToken: token,
    query: { auth: token },
  });
  const username = extractLemmyUsername(v3);
  if (!username) throw new Error("Unable to verify Lemmy account from API response.");
  return { username };
}

function normalizeCommunityView(entry) {
  const community = entry?.community || {};
  const counts = entry?.counts || {};
  const id = String(community.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(community.name || "").trim() || id,
    title: String(community.title || community.name || id).trim(),
    actorId: String(community.actor_id || "").trim(),
    subscribers: Number(counts.subscribers || 0),
  };
}

function normalizeCommunityInfo(entry) {
  const community = entry?.community || {};
  const counts = entry?.counts || {};
  const id = String(community.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(community.name || "").trim() || id,
    title: String(community.title || community.name || id).trim(),
    actorId: String(community.actor_id || "").trim(),
    description: String(community.description || "").trim(),
    subscribers: Number(counts.subscribers || 0),
    posts: Number(counts.posts || 0),
    removed: Boolean(community.removed),
    deleted: Boolean(community.deleted),
    nsfw: Boolean(community.nsfw),
    postingRestrictedToMods: Boolean(community.posting_restricted_to_mods),
    communityUrl: String(community.actor_id || "").trim(),
  };
}

function looksLikeLikelyUploadedImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;

  try {
    const testUrl = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw, "https://example.invalid/");
    const pathname = String(testUrl.pathname || "");
    if (!pathname || pathname === "/") return false;
    if (/^\/api\/v[34]\/image(?:\/upload)?\/?$/i.test(pathname)) return false;
  } catch {
    return false;
  }

  if (/\/pictrs\//i.test(raw)) return true;
  if (/\/api\/v[34]\/image_proxy/i.test(raw)) return true;
  if (/\.(jpe?g|png|gif|webp|avif|bmp|tiff?|svg)(\?|#|$)/i.test(raw)) return true;
  if (/\/(?:image|media)\//i.test(raw)) return true;
  return false;
}

function collectUploadedImageUrlCandidates(parsedPayload) {
  const fileRow = Array.isArray(parsedPayload?.files) ? parsedPayload.files[0] : null;
  return [
    fileRow?.file,
    fileRow?.identifier,
    fileRow?.image_url,
    parsedPayload?.image_url,
    parsedPayload?.file,
    fileRow?.url,
    parsedPayload?.url,
  ].map((v) => String(v || "").trim()).filter(Boolean);
}

function pickUploadedImageUrl(parsedPayload) {
  const rankedCandidates = collectUploadedImageUrlCandidates(parsedPayload);

  for (const candidate of rankedCandidates) {
    if (looksLikeLikelyUploadedImageUrl(candidate)) return candidate;
  }
  return "";
}

function probePublicImageUrl(urlString, redirectCount = 0) {
  const target = String(urlString || "").trim();
  if (!target) {
    return Promise.resolve({ ok: false, reason: "empty_url", status: 0, contentType: "", finalUrl: "" });
  }

  let urlObj;
  try {
    urlObj = new URL(target);
  } catch {
    return Promise.resolve({ ok: false, reason: "invalid_url", status: 0, contentType: "", finalUrl: target });
  }

  if (urlObj.protocol !== "https:") {
    return Promise.resolve({ ok: false, reason: `unsupported_protocol:${urlObj.protocol}`, status: 0, contentType: "", finalUrl: target });
  }

  if (redirectCount > 4) {
    return Promise.resolve({ ok: false, reason: "too_many_redirects", status: 0, contentType: "", finalUrl: target });
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      resolve(out);
    };

    const req = https.request(
      {
        method: "GET",
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: `${urlObj.pathname}${urlObj.search}`,
        headers: {
          Accept: "image/*,*/*;q=0.8",
          "User-Agent": "ShutterQueue/1.0",
        },
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        const contentType = String(res.headers["content-type"] || "");
        const location = String(res.headers.location || "").trim();

        if (status >= 300 && status < 400 && location) {
          res.resume();
          let nextUrl = "";
          try {
            nextUrl = new URL(location, urlObj).toString();
          } catch {
            done({ ok: false, reason: "bad_redirect", status, contentType, finalUrl: target });
            return;
          }
          probePublicImageUrl(nextUrl, redirectCount + 1).then(done);
          return;
        }

        const isImage = status >= 200 && status < 300 && /^image\//i.test(contentType);
        res.resume();
        done({
          ok: isImage,
          reason: isImage ? "" : "non_image_response",
          status,
          contentType,
          finalUrl: target,
        });
      }
    );

    req.setTimeout(7000, () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      done({ ok: false, reason: String(err?.message || err || "request_error"), status: 0, contentType: "", finalUrl: target });
    });
    req.end();
  });
}

async function listSubscribedCommunities({ instanceUrl, accessToken }) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("Missing Lemmy access token");

  const fetchWithVersion = async (version) => {
    const out = [];
    const seen = new Set();
    let page = 1;
    const limit = 50;

    while (page <= 20) {
      const payload = await requestJson({
        instanceUrl,
        apiPath: `/api/${version}/community/list`,
        method: "GET",
        accessToken: token,
        query: {
          type_: "Subscribed",
          sort: "New",
          page,
          limit,
          auth: token,
        },
      });
      const rows = Array.isArray(payload?.communities) ? payload.communities : [];
      if (!rows.length) break;
      for (const row of rows) {
        const normalized = normalizeCommunityView(row);
        if (!normalized) continue;
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        out.push(normalized);
      }
      if (rows.length < limit) break;
      page += 1;
    }

    return out;
  };

  try {
    return await fetchWithVersion("v4");
  } catch {
    return await fetchWithVersion("v3");
  }
}

async function getCommunityInfo({ instanceUrl, accessToken, communityId }) {
  const token = String(accessToken || "").trim();
  const cid = Number(communityId || 0);
  if (!token) throw new Error("Missing Lemmy access token");
  if (!Number.isFinite(cid) || cid <= 0) throw new Error("Missing Lemmy community id");

  const fetchVersion = async (version) => {
    const payload = await requestJson({
      instanceUrl,
      apiPath: `/api/${version}/community`,
      method: "GET",
      accessToken: token,
      query: {
        id: cid,
        auth: token,
      },
    });
    const normalized = normalizeCommunityInfo(payload?.community_view);
    if (!normalized) throw new Error("Unable to parse Lemmy community info response.");
    return normalized;
  };

  try {
    return await fetchVersion("v4");
  } catch {
    return await fetchVersion("v3");
  }
}

async function uploadImage({ instanceUrl, accessToken, photoPath, onProgress, imageResizeOptions, instanceLimitsCache, onDiscoveredLimits, uploadConfigCache, onDiscoveredUploadConfig }) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("Missing Lemmy access token");
  const instanceKey = normalizeInstanceUrl(instanceUrl);
  const ALL_ATTEMPTS = [
    ["/api/v4/image", "images[]"],
    ["/api/v4/image", "image"],
    ["/api/v4/image", "images"],
    ["/api/v4/image", "file"],
    ["/api/v3/image/upload", "images"],
    ["/api/v3/image/upload", "file"],
    ["/pictrs/image", "file"],
    ["/pictrs/image", "images"],
    ["/api/v4/image/upload", "images"],
    ["/api/v4/image/upload", "file"],
    ["/api/v4/image/upload", "images[]"],
    ["/api/v3/image/upload", "images[]"],
    ["/pictrs/image", "images[]"],
  ];

  // Prefer cached working combo; fall back to probing all combinations
  const memCached = INSTANCE_UPLOAD_CONFIG_CACHE.get(instanceKey);
  const persistedConfig = readDiscoveredUploadConfigFromCache(uploadConfigCache, instanceKey);
  const cachedConfig = memCached || persistedConfig;
  const orderedAttempts = cachedConfig && cachedConfig.apiPath && cachedConfig.fieldName
    ? [[cachedConfig.apiPath, cachedConfig.fieldName], ...ALL_ATTEMPTS.filter(([p, f]) => !(p === cachedConfig.apiPath && f === cachedConfig.fieldName))]
    : ALL_ATTEMPTS;

  let refreshedAfterError = false;

  while (true) {
    const limits = await fetchLemmyImageLimits({
      instanceUrl,
      accessToken: token,
      limitsCache: instanceLimitsCache,
      forceRefresh: refreshedAfterError,
      onDiscoveredLimits,
    });
    const effectiveLimits = applyResizeOverrides(limits, imageResizeOptions);
    const prepared = await prepareImageForUpload(photoPath, effectiveLimits);

    try {
      const attempt = (apiPath, fieldName) => new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(prepared.filePath);
        const form = new FormData();
        form.append(fieldName, fileStream, {
          contentType: prepared.contentType || mime.lookup(prepared.filePath) || "application/octet-stream",
          filename: path.basename(prepared.filePath),
        });

        const totalLength = Number(prepared.sizeBytes || fs.statSync(prepared.filePath).size || 0);
        if (onProgress && totalLength > 0) {
          let loaded = 0;
          fileStream.on("data", (chunk) => {
            loaded += chunk.length;
            try { onProgress(loaded, totalLength); } catch (_) {}
          });
          fileStream.on("end", () => {
            try { onProgress(totalLength, totalLength); } catch (_) {}
          });
        }

        const base = new URL(normalizeInstanceUrl(instanceUrl));
        const url = new URL(String(apiPath || "/"), `${base.toString()}/`);
        url.searchParams.set("auth", token);

        const headers = {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...form.getHeaders(),
        };

        const req = https.request(
          {
            method: "POST",
            hostname: url.hostname,
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            headers,
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              const status = Number(res.statusCode || 0);
              let parsed = null;
              try {
                parsed = data ? JSON.parse(data) : null;
              } catch {
                parsed = null;
              }
              if (status < 200 || status >= 300) {
                const msg = parsed?.error || parsed?.message || data || `HTTP ${status}`;
                reject(new Error(`Lemmy image upload failed: ${msg}`));
                return;
              }

              const urlOut = pickUploadedImageUrl(parsed);
              const candidates = collectUploadedImageUrlCandidates(parsed);
              if (!urlOut) {
                reject(new Error(`Lemmy image upload returned no usable image URL. Raw response: ${data || "<empty>"}`));
                return;
              }
              resolve({ urlOut, candidates });
            });
          }
        );
        req.on("error", reject);
        form.pipe(req);
      });

      const attemptResults = [];
      for (const [apiPath, fieldName] of orderedAttempts) {
        try {
          const uploadOut = await attempt(apiPath, fieldName);
          let imageUrl = String(uploadOut?.urlOut || "").trim();
          // For /pictrs/image endpoints, the response gives a bare filename (e.g. "uuid.jpeg")
          // with no path. The correct serving URL is /pictrs/image/{filename}, not just /{filename}.
          if (imageUrl && !imageUrl.includes("/") && apiPath.includes("pictrs/image")) {
            imageUrl = `/pictrs/image/${imageUrl}`;
          }
          if (imageUrl) {
            const normalizedCandidate = normalizeUploadedImageUrlForPost(imageUrl, instanceUrl);
            const probe = await probePublicImageUrl(normalizedCandidate);
            if (!probe.ok) {
              const candidateList = Array.isArray(uploadOut?.candidates) ? uploadOut.candidates.join(",") : "";
              attemptResults.push(`${apiPath}[${fieldName}] candidate=${normalizedCandidate} status=${probe.status || 0} contentType=${probe.contentType || "<none>"} reason=${probe.reason || "unknown"} rawCandidates=${candidateList}`);
              continue;
            }
            const cachedAt = Date.now();
            INSTANCE_UPLOAD_CONFIG_CACHE.set(instanceKey, { apiPath, fieldName, cachedAt });
            if (typeof onDiscoveredUploadConfig === "function") {
              try { onDiscoveredUploadConfig({ instanceKey, apiPath, fieldName, cachedAt }); } catch (_) {}
            }
            return normalizedCandidate;
          }
        } catch (e) {
          const errText = String(e?.message || e || "").replace(/^Lemmy image upload failed: /, "");
          attemptResults.push(`${apiPath}[${fieldName}]: ${errText}`);
        }
      }

      const detail = attemptResults.length ? ` Tried: ${attemptResults.join("; ")}` : "";
      throw new Error(`Lemmy image upload failed on all endpoints.${detail}`);
    } catch (e) {
      if (!refreshedAfterError && looksLikeLimitError(e)) {
        refreshedAfterError = true;
        continue;
      }
      throw e;
    } finally {
      await prepared.cleanup();
    }
  }
}

function derivePostName(item) {
  const title = String(item?.title || "").trim();
  if (title) return title;
  const basename = path.basename(String(item?.photoPath || ""));
  return basename || "Photo";
}

function normalizeUploadedImageUrlForPost(imageUrl, instanceUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";

  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).toString();
    if (raw.startsWith("//")) return `https:${raw}`;
    const base = new URL(`${normalizeInstanceUrl(instanceUrl)}/`);
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

async function createImagePost({ instanceUrl, accessToken, item, communityId, postTextMode, prependText, appendText, nsfw, imageResizeOptions, instanceLimitsCache, onDiscoveredLimits, uploadConfigCache, onDiscoveredUploadConfig }) {
  const token = String(accessToken || "").trim();
  const cid = Number(communityId || 0);
  if (!token) throw new Error("Missing Lemmy access token");
  if (!Number.isFinite(cid) || cid <= 0) throw new Error("Missing Lemmy community id");

  const imageUrl = await uploadImage({
    instanceUrl,
    accessToken: token,
    photoPath: String(item?.photoPath || ""),
    imageResizeOptions,
    instanceLimitsCache,
    onDiscoveredLimits,
    uploadConfigCache,
    onDiscoveredUploadConfig,
  });
  const postImageUrl = normalizeUploadedImageUrlForPost(imageUrl, instanceUrl);
  const bodyText = buildPostText({ item, postTextMode, prependText, appendText });

  const payload = {
    community_id: cid,
    name: derivePostName(item),
    body: bodyText || undefined,
    url: postImageUrl,
    nsfw: Boolean(nsfw),
    alt_text: String(item?.description || "").trim() || undefined,
    auth: token,
  };

  const tryCreate = async (version) => {
    const out = await requestJson({
      instanceUrl,
      apiPath: `/api/${version}/post`,
      method: "POST",
      accessToken: token,
      body: payload,
    });
    const post = out?.post_view?.post || out?.post || {};
    return {
      id: String(post.id || ""),
      url: String(post.ap_id || post.url || postImageUrl || ""),
      imageUrl,
    };
  };

  try {
    return await tryCreate("v4");
  } catch {
    return await tryCreate("v3");
  }
}

module.exports = {
  DEFAULT_LEMMY_INSTANCE,
  normalizeInstanceUrl,
  verifyCredentials,
  listSubscribedCommunities,
  getCommunityInfo,
  buildPostText,
  createImagePost,
  __test__: {
    buildPostText,
    normalizeInstanceUrl,
    extractLemmyImageLimitsFromSitePayload,
    looksLikeLikelyUploadedImageUrl,
    collectUploadedImageUrlCandidates,
    pickUploadedImageUrl,
  },
};
