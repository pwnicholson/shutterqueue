const fs = require("fs");
const https = require("https");
const FormData = require("form-data");
const mime = require("mime-types");
const path = require("path");

const DEFAULT_LEMMY_INSTANCE = "https://lemmy.world";

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

async function uploadImage({ instanceUrl, accessToken, photoPath }) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("Missing Lemmy access token");
  const contentType = mime.lookup(photoPath) || "application/octet-stream";

  const attempt = (apiPath, fieldName) => new Promise((resolve, reject) => {
    const form = new FormData();
    form.append(fieldName, fs.createReadStream(photoPath), {
      contentType,
      filename: path.basename(photoPath),
    });

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

          const fileRow = Array.isArray(parsed?.files) ? parsed.files[0] : null;
          const urlOut = String(
            parsed?.image_url ||
            parsed?.url ||
            parsed?.file ||
            fileRow?.image_url ||
            fileRow?.url ||
            fileRow?.file ||
            ""
          ).trim();
          if (!urlOut) {
            reject(new Error("Lemmy image upload returned no image URL."));
            return;
          }
          resolve(urlOut);
        });
      }
    );
    req.on("error", reject);
    form.pipe(req);
  });

  const attempts = [
    ["/api/v4/image", "images[]"],
    ["/api/v4/image/upload", "images[]"],
    ["/api/v3/image/upload", "images[]"],
    ["/pictrs/image", "images[]"],
    ["/pictrs/image", "file"],
  ];

  let lastError = null;
  for (const [apiPath, fieldName] of attempts) {
    try {
      const imageUrl = await attempt(apiPath, fieldName);
      if (imageUrl) return imageUrl;
    } catch (e) {
      lastError = e;
    }
  }

  throw (lastError || new Error("Lemmy image upload failed."));
}

function derivePostName(item) {
  const title = String(item?.title || "").trim();
  if (title) return title;
  const basename = path.basename(String(item?.photoPath || ""));
  return basename || "Photo";
}

async function createImagePost({ instanceUrl, accessToken, item, communityId, postTextMode, prependText, appendText, nsfw }) {
  const token = String(accessToken || "").trim();
  const cid = Number(communityId || 0);
  if (!token) throw new Error("Missing Lemmy access token");
  if (!Number.isFinite(cid) || cid <= 0) throw new Error("Missing Lemmy community id");

  const imageUrl = await uploadImage({ instanceUrl, accessToken: token, photoPath: String(item?.photoPath || "") });
  const bodyText = buildPostText({ item, postTextMode, prependText, appendText });

  const payload = {
    community_id: cid,
    name: derivePostName(item),
    body: bodyText || undefined,
    url: imageUrl,
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
      url: String(post.ap_id || post.url || imageUrl || ""),
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
  },
};
