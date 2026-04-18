const https = require("https");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");
const FormData = require("form-data");
const fs = require("fs");
const mime = require("mime-types");
const path = require("path");
const { prepareImageForUpload } = require("./image-prep.cjs");

const TUMBLR_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // Legacy /post photo data limit is 10 MB.
const TUMBLR_OAUTH_REQUEST = "https://www.tumblr.com/oauth/request_token";
const TUMBLR_OAUTH_AUTHORIZE = "https://www.tumblr.com/oauth/authorize";
const TUMBLR_OAUTH_ACCESS = "https://www.tumblr.com/oauth/access_token";
const TUMBLR_API = "https://api.tumblr.com/v2";

function makeOAuth(consumerKey, consumerSecret) {
  return OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return crypto.createHmac("sha1", key).update(baseString).digest("base64");
    },
  });
}

const USER_AGENT = "ShutterQueue/1.0";

function request(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { "User-Agent": USER_AGENT, ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseQueryString(body) {
  const params = new URLSearchParams(String(body || ""));
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function parseApiResponse(raw, status) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(raw || "{}"));
  } catch {
    if (status >= 200 && status < 300) {
      return { ok: true, response: {} };
    }
    throw new Error(`Tumblr API error: HTTP ${status}`);
  }

  const meta = parsed && parsed.meta ? parsed.meta : {};
  const code = Number(meta.status || status || 0);
  if (code < 200 || code >= 300) {
    const responseErrors = parsed?.response?.errors;
    const responseErrorList = Array.isArray(responseErrors)
      ? responseErrors
      : (responseErrors && typeof responseErrors === "object"
          ? Object.values(responseErrors).flatMap((value) => Array.isArray(value) ? value : [value])
          : []);
    const firstResponseError = responseErrorList.find((entry) => entry != null);
    const rootErrors = parsed?.errors;
    const rootErrorList = Array.isArray(rootErrors)
      ? rootErrors
      : (rootErrors && typeof rootErrors === "object"
          ? Object.values(rootErrors).flatMap((value) => Array.isArray(value) ? value : [value])
          : []);
    const firstRootError = rootErrorList.find((entry) => entry != null);

    const detail = String(
      (typeof firstResponseError === "string" ? firstResponseError : "") ||
      firstResponseError?.detail ||
      firstResponseError?.title ||
      firstResponseError?.code ||
      parsed?.response?.detail ||
      parsed?.response?.message ||
      parsed?.response?.error ||
      parsed?.response?.error_description ||
      (typeof firstRootError === "string" ? firstRootError : "") ||
      firstRootError?.detail ||
      firstRootError?.title ||
      firstRootError?.code ||
      parsed?.message ||
      parsed?.error ||
      meta.msg ||
      "Tumblr API error"
    ).trim();

    const normalized = detail || "Tumblr API error";
    if (/^bad request$/i.test(normalized) && code > 0) {
      throw new Error(`${normalized} (HTTP ${code})`);
    }
    throw new Error(normalized);
  }

  return {
    ok: true,
    response: parsed.response || {},
  };
}

async function tumblrApiGet({ consumerKey, consumerSecret, token, tokenSecret, endpoint, query }) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const url = new URL(`${TUMBLR_API}${endpoint}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const auth = oauth.toHeader(
    oauth.authorize({ url: url.toString(), method: "GET" }, token ? { key: token, secret: tokenSecret } : undefined)
  );

  const res = await request(url.toString(), "GET", auth, null);
  return parseApiResponse(res.body, res.status).response;
}

async function getRequestToken(consumerKey, consumerSecret, options = {}) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const callbackUrl = String(options?.callbackUrl || "").trim();

  // Tumblr may reject the legacy oob callback for some app configurations.
  // Try oob first for PIN-style auth, then fall back to app-default callback.
  const attempts = [];
  if (callbackUrl) {
    attempts.push({
      authData: { oauth_callback: callbackUrl },
      body: `oauth_callback=${encodeURIComponent(callbackUrl)}`,
      useCallback: true,
    });
  }
  attempts.push(
    {
      authData: { oauth_callback: "oob" },
      body: "oauth_callback=oob",
      useCallback: true,
    },
    {
      authData: undefined,
      body: "",
      useCallback: false,
    }
  );

  let lastError = null;
  for (const attempt of attempts) {
    const auth = oauth.toHeader(
      oauth.authorize(
        {
          url: TUMBLR_OAUTH_REQUEST,
          method: "POST",
          ...(attempt.useCallback ? { data: attempt.authData } : {}),
        },
        undefined
      )
    );

    const res = await request(
      TUMBLR_OAUTH_REQUEST,
      "POST",
      { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
      attempt.body
    );

    if (res.status >= 200 && res.status < 300) {
      const params = parseQueryString(res.body);
      return {
        oauthToken: params.oauth_token || "",
        oauthTokenSecret: params.oauth_token_secret || "",
      };
    }

    lastError = new Error(`HTTP ${res.status}: ${res.body}`);
    const bodyLower = String(res.body || "").toLowerCase();
    const callbackRejected = res.status === 400 && bodyLower.includes("disallowed oauth_callback");
    if (!callbackRejected || !attempt.useCallback) {
      throw lastError;
    }
  }

  throw lastError || new Error("Failed to request Tumblr OAuth token.");
}

function getAuthorizeUrl(oauthToken) {
  return `${TUMBLR_OAUTH_AUTHORIZE}?oauth_token=${encodeURIComponent(String(oauthToken || ""))}`;
}

async function getAccessToken(consumerKey, consumerSecret, oauthToken, oauthTokenSecret, verifier) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const auth = oauth.toHeader(
    oauth.authorize(
      { url: TUMBLR_OAUTH_ACCESS, method: "POST", data: { oauth_verifier: verifier } },
      { key: oauthToken, secret: oauthTokenSecret }
    )
  );

  const res = await request(
    TUMBLR_OAUTH_ACCESS,
    "POST",
    { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
    `oauth_verifier=${encodeURIComponent(String(verifier || ""))}`
  );
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.body}`);
  const params = parseQueryString(res.body);

  return {
    token: params.oauth_token || "",
    tokenSecret: params.oauth_token_secret || "",
    name: params.name || "",
  };
}

async function getUserInfo({ consumerKey, consumerSecret, token, tokenSecret }) {
  return tumblrApiGet({
    consumerKey,
    consumerSecret,
    token,
    tokenSecret,
    endpoint: "/user/info",
  });
}

async function listBlogs({ consumerKey, consumerSecret, token, tokenSecret }) {
  const info = await getUserInfo({ consumerKey, consumerSecret, token, tokenSecret });
  const blogs = Array.isArray(info?.user?.blogs) ? info.user.blogs : [];
  return blogs
    .map((b) => {
      const url = String(b?.url || "").trim();
      let identifier = "";
      if (url) {
        try {
          identifier = new URL(url).hostname;
        } catch {
          identifier = url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
        }
      }
      const name = String(b?.name || "");
      if (!identifier && name) identifier = `${name}.tumblr.com`;
      return {
        id: identifier,
        name,
        title: String(b?.title || name || identifier),
        url,
        primary: false,
      };
    })
    .filter((b) => b.id);
}

function normalizeTagsCsv(tagsCsv) {
  return String(tagsCsv || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(",");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCaption({ title, description, postTextMode, prependText, appendText }) {
  const cleanTitle = String(title || "").trim();
  const cleanDescription = String(description || "").trim();
  const mode = String(postTextMode || "bold_title_then_description");

  let coreCaption;
  if (mode === "title_only") {
    coreCaption = cleanTitle;
  } else if (mode === "description_only") {
    coreCaption = cleanDescription;
  } else if (mode === "title_then_description") {
    coreCaption = [cleanTitle, cleanDescription].filter(Boolean).join("\n");
  } else {
    if (!cleanTitle) {
      coreCaption = cleanDescription;
    } else {
      const boldTitle = `<b>${escapeHtml(cleanTitle)}</b>`;
      coreCaption = cleanDescription ? `${boldTitle}\n${cleanDescription}` : boldTitle;
    }
  }

  const pre = String(prependText || "").trim();
  const app = String(appendText || "").trim();
  const parts = [];
  if (pre) parts.push(pre);
  if (coreCaption) parts.push(coreCaption);
  if (app) parts.push(app);
  return parts.join("\n");
}

function resolveTumblrPostState({ privacy, postTimingMode }) {
  const normalizedPrivacy = String(privacy || "private").trim().toLowerCase();
  if (normalizedPrivacy === "private") return "private";
  return String(postTimingMode || "").trim() === "add_to_queue" ? "queue" : "published";
}

function isLikelyTumblrMediaProcessingError(error) {
  const msg = String(error || "").toLowerCase();
  if (/media file too large/.test(msg)) return true;
  if (/magick error|insufficient memory/.test(msg)) return true;
  if (/invalid format|cannot process|unknown upload error/.test(msg)) return true;
  return false;
}

async function uploadTumblrPhotoData({
  endpointUrl,
  oauth,
  token,
  tokenSecret,
  caption,
  tags,
  postState,
  markMature,
  uploadPath,
  uploadFilename,
  onProgress,
}) {
  const form = new FormData();
  form.append("type", "photo");
  form.append("caption", caption);
  form.append("tags", tags);
  form.append("state", postState);
  if (markMature) {
    form.append("is_nsfw", "true");
    form.append("content_rating", "adult");
  }

  const contentType = mime.lookup(uploadPath) || "application/octet-stream";
  const fileStream = fs.createReadStream(uploadPath);
  form.append("data", fileStream, {
    contentType,
    filename: uploadFilename,
  });

  const totalLength = Number(fs.statSync(uploadPath).size || 0);
  if (onProgress && totalLength != null) {
    let loaded = 0;
    fileStream.on("data", (chunk) => {
      loaded += chunk.length;
      try { onProgress(loaded, totalLength); } catch (_) {}
    });
    fileStream.on("end", () => {
      try { onProgress(totalLength, totalLength); } catch (_) {}
    });
  }

  const signatureData = {
    type: "photo",
    caption,
    tags,
    state: postState,
    ...(markMature ? { is_nsfw: "true", content_rating: "adult" } : {}),
  };

  const auth = oauth.toHeader(
    oauth.authorize({ url: endpointUrl, method: "POST", data: signatureData }, { key: token, secret: tokenSecret })
  );

  const headers = { "User-Agent": USER_AGENT, ...auth, ...form.getHeaders() };

  const res = await new Promise((resolve, reject) => {
    const u = new URL(endpointUrl);
    const req = https.request({ method: "POST", hostname: u.hostname, path: u.pathname + u.search, headers }, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => resolve({ status: r.statusCode || 0, body: data }));
    });
    req.on("error", reject);
    form.pipe(req);
  });

  const response = parseApiResponse(res.body, res.status).response;
  const postId = String(response?.id || response?.id_string || "");
  if (!postId) throw new Error("Tumblr post created but no post id was returned.");
  return postId;
}

async function createPhotoPost({
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  blogIdentifier,
  item,
  markMature,
  postTextMode,
  useDescriptionAsImageDescription,
  prependText,
  appendText,
  postTimingMode,
  onProgress,
}) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const cleanBlog = String(blogIdentifier || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!cleanBlog) throw new Error("Missing Tumblr blog selection.");

  const endpointUrl = `${TUMBLR_API}/blog/${encodeURIComponent(cleanBlog)}/post`;

  const description = String(item?.description || "");
  const title = String(item?.title || "");
  const caption = buildCaption({ title, description, postTextMode, prependText, appendText });
  const tags = normalizeTagsCsv(item?.tags || "");
  const privacy = String(item?.privacy || "private");
  const postState = resolveTumblrPostState({ privacy, postTimingMode });

  const srcPath = String(item?.photoPath || "").trim();
  if (!srcPath) throw new Error("Missing Tumblr upload photo path.");
  const originalFilename = path.basename(srcPath);

  try {
    // Primary path: upload original file exactly as selected.
    return await uploadTumblrPhotoData({
      endpointUrl,
      oauth,
      token,
      tokenSecret,
      caption,
      tags,
      postState,
      markMature,
      uploadPath: srcPath,
      uploadFilename: originalFilename,
      onProgress,
    });
  } catch (error) {
    if (!isLikelyTumblrMediaProcessingError(error)) {
      throw error;
    }

    // Fallback path: only when Tumblr rejects media processing/size.
    const prepared = await prepareImageForUpload(srcPath, {
      maxBytes: TUMBLR_MAX_IMAGE_BYTES,
      maxWidth: 4096,
      maxHeight: 4096,
    });
    try {
      return await uploadTumblrPhotoData({
        endpointUrl,
        oauth,
        token,
        tokenSecret,
        caption,
        tags,
        postState,
        markMature,
        uploadPath: prepared.filePath,
        uploadFilename: originalFilename,
        onProgress,
      });
    } finally {
      await prepared.cleanup();
    }
  }
}

module.exports = {
  getRequestToken,
  getAuthorizeUrl,
  getAccessToken,
  getUserInfo,
  listBlogs,
  createPhotoPost,
  __test__: {
    buildCaption,
    normalizeTagsCsv,
    resolveTumblrPostState,
    parseApiResponse,
    isLikelyTumblrMediaProcessingError,
  },
};
