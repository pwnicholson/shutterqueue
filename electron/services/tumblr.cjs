const https = require("https");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");
const FormData = require("form-data");
const fs = require("fs");
const mime = require("mime-types");
const path = require("path");

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

function request(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers,
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
    const detail = String(meta.msg || parsed?.errors?.[0]?.detail || parsed?.error || "Tumblr API error");
    throw new Error(detail);
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

async function getRequestToken(consumerKey, consumerSecret) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const auth = oauth.toHeader(oauth.authorize({ url: TUMBLR_OAUTH_REQUEST, method: "POST", data: { oauth_callback: "oob" } }));
  const res = await request(
    TUMBLR_OAUTH_REQUEST,
    "POST",
    { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
    "oauth_callback=oob"
  );
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.body}`);
  const params = parseQueryString(res.body);
  return {
    oauthToken: params.oauth_token || "",
    oauthTokenSecret: params.oauth_token_secret || "",
  };
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

async function createPhotoPost({
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  blogIdentifier,
  item,
  markMature,
}) {
  const oauth = makeOAuth(consumerKey, consumerSecret);
  const cleanBlog = String(blogIdentifier || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!cleanBlog) throw new Error("Missing Tumblr blog selection.");

  const endpointUrl = `${TUMBLR_API}/blog/${encodeURIComponent(cleanBlog)}/post`;
  const form = new FormData();

  const description = String(item?.description || "");
  const title = String(item?.title || "");
  const tags = normalizeTagsCsv(item?.tags || "");

  form.append("type", "photo");
  form.append("title", title);
  form.append("caption", description);
  form.append("tags", tags);
  if (markMature) {
    form.append("is_nsfw", "true");
    form.append("content_rating", "adult");
  }

  const contentType = mime.lookup(item.photoPath) || "application/octet-stream";
  form.append("data", fs.createReadStream(item.photoPath), {
    contentType,
    filename: path.basename(item.photoPath),
  });

  const signatureData = {
    type: "photo",
    title,
    caption: description,
    tags,
    ...(markMature ? { is_nsfw: "true", content_rating: "adult" } : {}),
  };

  const auth = oauth.toHeader(
    oauth.authorize({ url: endpointUrl, method: "POST", data: signatureData }, { key: token, secret: tokenSecret })
  );

  const headers = { ...auth, ...form.getHeaders() };

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

module.exports = {
  getRequestToken,
  getAuthorizeUrl,
  getAccessToken,
  getUserInfo,
  listBlogs,
  createPhotoPost,
};
