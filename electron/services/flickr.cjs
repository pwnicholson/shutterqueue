const https = require("https");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");
const FormData = require("form-data");
const fs = require("fs");
const mime = require("mime-types");

const FLICKR_API = "https://api.flickr.com/services/rest";
const FLICKR_UPLOAD = "https://up.flickr.com/services/upload/";

function sha1base64(text) {
  return crypto.createHash("sha1").update(text).digest("base64");
}

function makeOAuth(consumerKey, consumerSecret) {
  return OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(base_string, key) {
      return crypto.createHmac("sha1", key).update(base_string).digest("base64");
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

async function flickrRestCall({ apiKey, apiSecret, token, tokenSecret, methodName, params }) {
  const oauth = makeOAuth(apiKey, apiSecret);
  const url = new URL(FLICKR_API);
  url.searchParams.set("method", methodName);
  url.searchParams.set("format", "json");
  url.searchParams.set("nojsoncallback", "1");
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));

  const auth = oauth.toHeader(
    oauth.authorize({ url: url.toString(), method: "GET" }, token ? { key: token, secret: tokenSecret } : undefined)
  );

  const res = await request(url.toString(), "GET", { ...auth }, null);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${res.body}`);
  }
  const j = JSON.parse(res.body);
  if (j.stat && j.stat !== "ok") {
    const err = new Error(j.message || "Flickr API error");
    // Preserve Flickr numeric error codes when present.
    if (j.code !== undefined) err.code = j.code;
    throw err;
  }
  return j;
}

async function getRequestToken(apiKey, apiSecret) {
  const oauth = makeOAuth(apiKey, apiSecret);
  const url = "https://www.flickr.com/services/oauth/request_token";
  const auth = oauth.toHeader(oauth.authorize({ url, method: "POST", data: { oauth_callback: "oob" } }));
  const res = await request(url, "POST", { ...auth, "Content-Type": "application/x-www-form-urlencoded" }, "oauth_callback=oob");
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.body}`);
  const params = new URLSearchParams(res.body);
  if (params.get("oauth_callback_confirmed") !== "true") throw new Error("oauth_callback_confirmed != true");
  return {
    oauthToken: params.get("oauth_token"),
    oauthTokenSecret: params.get("oauth_token_secret"),
  };
}

function getAuthorizeUrl(oauthToken) {
  return `https://www.flickr.com/services/oauth/authorize?oauth_token=${encodeURIComponent(oauthToken)}&perms=write`;
}

async function getAccessToken(apiKey, apiSecret, oauthToken, oauthTokenSecret, verifier) {
  const oauth = makeOAuth(apiKey, apiSecret);
  const url = "https://www.flickr.com/services/oauth/access_token";
  const auth = oauth.toHeader(
    oauth.authorize(
      { url, method: "POST", data: { oauth_verifier: verifier } },
      { key: oauthToken, secret: oauthTokenSecret }
    )
  );
  const res = await request(url, "POST", { ...auth, "Content-Type": "application/x-www-form-urlencoded" }, `oauth_verifier=${encodeURIComponent(verifier)}`);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.body}`);
  const params = new URLSearchParams(res.body);
  return {
    token: params.get("oauth_token"),
    tokenSecret: params.get("oauth_token_secret"),
    userNsid: params.get("user_nsid"),
    username: params.get("username"),
    fullname: params.get("fullname"),
  };
}

function tagsToFlickr(tagsCsv) {
  // UI uses comma-separated tags.
  // Flickr expects space-separated; multi-word tags must be quoted.
  const parts = (tagsCsv || "").split(",").map(s => s.trim()).filter(Boolean);
  return parts.map(t => (t.includes(" ") ? `"${t.replace(/"/g, '\"')}"` : t)).join(" ");
}

function privacyToFlags(p) {
  // Flickr upload flags are is_public/is_friend/is_family
  // public: 1/0/0
  // friends: 0/1/0
  // family: 0/0/1
  // friends_family: 0/1/1
  // private: 0/0/0
  const out = { is_public: "0", is_friend: "0", is_family: "0" };
  if (p === "public") out.is_public = "1";
  if (p === "friends") out.is_friend = "1";
  if (p === "family") out.is_family = "1";
  if (p === "friends_family") { out.is_friend = "1"; out.is_family = "1"; }
  return out;
}

async function uploadPhoto({ apiKey, apiSecret, token, tokenSecret, item }) {
  const oauth = makeOAuth(apiKey, apiSecret);
  const url = FLICKR_UPLOAD;

  const form = new FormData();
  form.append("api_key", apiKey);
  form.append("title", item.title || "");
  form.append("description", item.description || "");
  form.append("tags", tagsToFlickr(item.tags || ""));
  const flags = privacyToFlags(item.privacy || "private");
  form.append("is_public", flags.is_public);
  form.append("is_friend", flags.is_friend);
  form.append("is_family", flags.is_family);
  const safety = Number(item.safetyLevel || 1);
  form.append("safety_level", String(safety));

  const contentType = mime.lookup(item.photoPath) || "application/octet-stream";
  form.append("photo", fs.createReadStream(item.photoPath), { contentType, filename: require("path").basename(item.photoPath) });

  // OAuth header must be computed over the final URL (no querystring) and method POST
  const signatureData = {
    api_key: apiKey,
    title: item.title || "",
    description: item.description || "",
    tags: tagsToFlickr(item.tags || ""),
    is_public: flags.is_public,
    is_friend: flags.is_friend,
    is_family: flags.is_family,
    safety_level: String(Number(item.safetyLevel || 1)),
  };
  const auth = oauth.toHeader(oauth.authorize({ url, method: "POST", data: signatureData }, { key: token, secret: tokenSecret }));
  const headers = { ...auth, ...form.getHeaders() };

  const res = await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method: "POST", hostname: u.hostname, path: u.pathname, headers }, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => resolve({ status: r.statusCode || 0, body: data }));
    });
    req.on("error", reject);
    form.pipe(req);
  });

  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${res.body}`);

  // Flickr upload returns XML. Extract photoid.
  const m = String(res.body).match(/<photoid>(\d+)<\/photoid>/);
  if (!m) throw new Error(`Upload failed: ${res.body}`);
  return m[1];
}

async function addPhotoToAlbum({ apiKey, apiSecret, token, tokenSecret, photoId, albumId }) {
  return flickrRestCall({
    apiKey, apiSecret, token, tokenSecret,
    methodName: "flickr.photosets.addPhoto",
    params: { photoset_id: albumId, photo_id: photoId }
  });
}

async function addPhotoToGroup({ apiKey, apiSecret, token, tokenSecret, photoId, groupId }) {
  return flickrRestCall({
    apiKey, apiSecret, token, tokenSecret,
    methodName: "flickr.groups.pools.add",
    params: { group_id: groupId, photo_id: photoId }
  });
}

async function listGroups({ apiKey, apiSecret, token, tokenSecret }) {
  const j = await flickrRestCall({
    apiKey, apiSecret, token, tokenSecret,
    methodName: "flickr.groups.pools.getGroups",
    params: {}
  });
  const list = (j.groups && j.groups.group) ? j.groups.group : [];
  return list.map(g => ({ id: g.nsid, name: g.name }));
}

async function listAlbums({ apiKey, apiSecret, token, tokenSecret, userNsid }) {
  const j = await flickrRestCall({
    apiKey, apiSecret, token, tokenSecret,
    methodName: "flickr.photosets.getList",
    params: { user_id: userNsid }
  });
  const list = (j.photosets && j.photosets.photoset) ? j.photosets.photoset : [];
  return list.map(a => ({ id: a.id, title: a.title?._content || a.title || "" }));
}


async function getPhotoUrls({ apiKey, apiSecret, token, tokenSecret, photoId }) {
  const j = await flickrRestCall({
    apiKey,
    apiSecret,
    token,
    tokenSecret,
    methodName: "flickr.photos.getSizes",
    params: { photo_id: photoId }
  });
  const sizes = (j && j.sizes && Array.isArray(j.sizes.size)) ? j.sizes.size : [];
  // Normalize numbers
  const parsed = sizes.map(s => ({
    label: String(s.label || ""),
    width: Number(s.width || 0),
    height: Number(s.height || 0),
    source: String(s.source || ""),
    url: String(s.url || "")
  })).filter(s => s.source);

  const byLabel = new Map(parsed.map(s => [s.label, s]));

  const pickThumb = () => {
    const prefs = ["Small 320", "Small", "Thumbnail", "Square 150", "Square"];
    for (const lab of prefs) if (byLabel.has(lab)) return byLabel.get(lab);
    // fallback: smallest >= 120, else smallest overall
    const ge = parsed.filter(s => s.width >= 120).sort((a,b)=>a.width-b.width);
    if (ge.length) return ge[0];
    return parsed.sort((a,b)=>a.width-b.width)[0];
  };

  const pickPreview = () => {
    const prefs = ["Large 1600", "Large 2048", "Large", "Medium 800", "Medium 640", "Medium"];
    for (const lab of prefs) if (byLabel.has(lab)) return byLabel.get(lab);
    // fallback: largest <= 2048 else largest overall
    const le = parsed.filter(s => s.width && s.width <= 2048).sort((a,b)=>b.width-a.width);
    if (le.length) return le[0];
    return parsed.sort((a,b)=>b.width-a.width)[0];
  };

  const t = pickThumb();
  const p = pickPreview();
  return {
    thumbUrl: t ? t.source : "",
    previewUrl: p ? p.source : (t ? t.source : ""),
    sizes: parsed
  };
}


module.exports = {
  getRequestToken,
  getAuthorizeUrl,
  getAccessToken,
  uploadPhoto,
  addPhotoToAlbum,
  addPhotoToGroup,
  listGroups,
  listAlbums,
  getPhotoUrls
};
