const fs = require("fs");
const https = require("https");
const FormData = require("form-data");
const mime = require("mime-types");
const path = require("path");

const DEFAULT_PIXELFED_INSTANCE = "https://pixelfed.social";

function normalizeInstanceUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return DEFAULT_PIXELFED_INSTANCE;
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const u = new URL(withProtocol);
  if (u.protocol !== "https:") {
    throw new Error("PixelFed instance URL must use https.");
  }
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}

function requestJson({ instanceUrl, pathName, method, accessToken, headers, body }) {
  const base = new URL(normalizeInstanceUrl(instanceUrl));
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf-8");
  const reqHeaders = {
    Accept: "application/json",
    ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(headers || {}),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: String(method || "GET"),
        hostname: base.hostname,
        port: base.port || undefined,
        path: String(pathName || "/"),
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
            reject(new Error(`PixelFed API error: ${msg}`));
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

function requestForm({ instanceUrl, pathName, accessToken, form }) {
  const base = new URL(normalizeInstanceUrl(instanceUrl));
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${String(accessToken || "")}`,
    ...form.getHeaders(),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: base.hostname,
        port: base.port || undefined,
        path: String(pathName || "/"),
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
            reject(new Error(`PixelFed API error: ${msg}`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    form.pipe(req);
  });
}
function requestFormUrlEncodedNoAuth({ instanceUrl, pathName, formData }) {
  const base = new URL(normalizeInstanceUrl(instanceUrl));
  const body = new URLSearchParams(formData || {}).toString();
  const payload = Buffer.from(body, "utf-8");
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": String(payload.length),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: base.hostname,
        port: base.port || undefined,
        path: String(pathName || "/"),
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
            const msg = parsed?.error_description || parsed?.error || parsed?.message || data || `HTTP ${status}`;
            reject(new Error(`PixelFed API error: ${msg}`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
function requestFormUrlEncoded({ instanceUrl, pathName, accessToken, formData }) {
  const base = new URL(normalizeInstanceUrl(instanceUrl));
  const body = new URLSearchParams(formData || {}).toString();
  const payload = Buffer.from(body, "utf-8");
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${String(accessToken || "")}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": String(payload.length),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: base.hostname,
        port: base.port || undefined,
        path: String(pathName || "/"),
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
            reject(new Error(`PixelFed API error: ${msg}`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
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

function mapPrivacyToVisibility(privacy) {
  const p = String(privacy || "private");
  if (p === "public") return { visibility: "public", warning: "" };
  if (p === "private") return { visibility: "private", warning: "" };
  return {
    visibility: "private",
    warning: `visibility \"${p}\" is not supported and was mapped to \"private\".`,
  };
}

async function verifyCredentials({ instanceUrl, accessToken }) {
  const out = await requestJson({
    instanceUrl,
    pathName: "/api/v1/accounts/verify_credentials",
    method: "GET",
    accessToken,
  });

  return {
    username: String(out?.username || ""),
    acct: String(out?.acct || out?.username || ""),
    displayName: String(out?.display_name || out?.username || ""),
  };
}

async function uploadMedia({ instanceUrl, accessToken, photoPath, description }) {
  const form = new FormData();
  const contentType = mime.lookup(photoPath) || "application/octet-stream";
  form.append("file", fs.createReadStream(photoPath), {
    contentType,
    filename: path.basename(photoPath),
  });
  if (description) form.append("description", String(description));

  const out = await requestForm({
    instanceUrl,
    pathName: "/api/v2/media",
    accessToken,
    form,
  });

  const mediaId = String(out?.id || "");
  if (!mediaId) throw new Error("PixelFed media upload succeeded but returned no media id.");
  return mediaId;
}

async function createImagePost({ instanceUrl, accessToken, item, postTextMode, useDescriptionAsAltText, visibility, sensitive, prependText, appendText }) {
  const alt = useDescriptionAsAltText ? String(item?.description || "").trim() : "";
  const mediaId = await uploadMedia({
    instanceUrl,
    accessToken,
    photoPath: item.photoPath,
    description: alt,
  });

  const status = buildPostText({ item, postTextMode, prependText, appendText }) || "Photo";
  const out = await requestFormUrlEncoded({
    instanceUrl,
    pathName: "/api/v1/statuses",
    accessToken,
    formData: {
      status,
      visibility: String(visibility || "private"),
      sensitive: sensitive ? "true" : "false",
      "media_ids[]": mediaId,
    },
  });

  return {
    id: String(out?.id || ""),
    url: String(out?.url || ""),
    mediaId,
    status,
  };
}

async function registerApp({ instanceUrl, redirectUri }) {
  const out = await requestFormUrlEncodedNoAuth({
    instanceUrl,
    pathName: "/api/v1/apps",
    formData: {
      client_name: "ShutterQueue",
      redirect_uris: redirectUri,
      scopes: "read write",
      website: "https://github.com/shutterqueue/shutterqueue",
    },
  });
  const clientId = String(out?.client_id || "");
  const clientSecret = String(out?.client_secret || "");
  if (!clientId || !clientSecret) throw new Error("PixelFed app registration did not return client credentials.");
  return { clientId, clientSecret };
}

function buildAuthorizationUrl({ instanceUrl, clientId, redirectUri }) {
  const base = new URL(normalizeInstanceUrl(instanceUrl));
  const url = new URL("/oauth/authorize", base.origin);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read write");
  return url.toString();
}

async function exchangeCodeForToken({ instanceUrl, clientId, clientSecret, code, redirectUri }) {
  const out = await requestFormUrlEncodedNoAuth({
    instanceUrl,
    pathName: "/oauth/token",
    formData: {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      scope: "read write",
    },
  });
  const accessToken = String(out?.access_token || "");
  if (!accessToken) throw new Error("PixelFed token exchange did not return an access token.");
  return { accessToken };
}

module.exports = {
  DEFAULT_PIXELFED_INSTANCE,
  normalizeInstanceUrl,
  verifyCredentials,
  createImagePost,
  mapPrivacyToVisibility,
  registerApp,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  __test__: {
    buildPostText,
    mapPrivacyToVisibility,
  },
};
