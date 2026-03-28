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

function decodeHtmlEntities(input) {
  let text = String(input == null ? "" : input);
  if (!text.includes("&")) return text;

  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  for (let pass = 0; pass < 3; pass++) {
    const next = text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code) => {
      if (!code) return m;
      if (code[0] === "#") {
        const isHex = code[1]?.toLowerCase() === "x";
        const raw = isHex ? code.slice(2) : code.slice(1);
        const value = parseInt(raw, isHex ? 16 : 10);
        if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return m;
        try {
          return String.fromCodePoint(value);
        } catch {
          return m;
        }
      }
      const lower = String(code).toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : m;
    });
    if (next === text) break;
    text = next;
    if (!text.includes("&")) break;
  }

  return text;
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

async function uploadPhoto({ apiKey, apiSecret, token, tokenSecret, item, onProgress }) {
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

  // determine total length for progress reporting
  let totalLength = null;
  try {
    totalLength = await new Promise((resolve, reject) => {
      form.getLength((err, len) => {
        if (err) reject(err);
        else resolve(len);
      });
    });
  } catch (_e) {
    totalLength = null;
  }

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

    if (onProgress && totalLength != null) {
      req.on('socket', (socket) => {
        const iv = setInterval(() => {
          try {
            onProgress(socket.bytesWritten, totalLength);
          } catch (_) {}
        }, 500);
        socket.on('close', () => clearInterval(iv));
      });
    }

    form.pipe(req);
  });
  // final progress notification
  if (onProgress && totalLength != null) {
    try { onProgress(totalLength, totalLength); } catch (_) {}
  }

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

async function createAlbum({ apiKey, apiSecret, token, tokenSecret, title, primaryPhotoId }) {
  const j = await flickrRestCall({
    apiKey,
    apiSecret,
    token,
    tokenSecret,
    methodName: "flickr.photosets.create",
    params: {
      title: String(title || ""),
      primary_photo_id: String(primaryPhotoId || ""),
    },
  });

  const id = String(j?.photoset?.id || "");
  return {
    id,
    title: decodeHtmlEntities(j?.photoset?.title?._content || j?.photoset?.title || title || ""),
  };
}

async function addPhotoToGroup({ apiKey, apiSecret, token, tokenSecret, photoId, groupId }) {
  return flickrRestCall({
    apiKey, apiSecret, token, tokenSecret,
    methodName: "flickr.groups.pools.add",
    params: { group_id: groupId, photo_id: photoId }
  });
}

function parseFlickrCount(value) {
  if (value == null) return 0;
  const raw = typeof value === "object"
    ? (value._content ?? value.content ?? value.value ?? "")
    : value;
  const normalized = String(raw).replace(/[,_\s]/g, "").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readFlickrTextField(value) {
  if (value == null) return "";
  const raw = typeof value === "object"
    ? (value._content ?? value.content ?? value.value ?? "")
    : value;
  return decodeHtmlEntities(String(raw == null ? "" : raw)).trim();
}

function parseFlickrBool(value) {
  const normalized = String(readFlickrTextField(value)).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "on";
}

function buildGroupAdditionalInfo(group) {
  if (!group || typeof group !== "object") return "";

  const restrictions = (group.restrictions && typeof group.restrictions === "object") ? group.restrictions : {};
  const throttle = (group.throttle && typeof group.throttle === "object") ? group.throttle : {};
  const lines = [];

  const groupsPerPhotoRaw = restrictions.groups_per_photo
    ?? restrictions.groupsPerPhoto
    ?? restrictions.max_groups_per_photo
    ?? restrictions.maxGroupsPerPhoto
    ?? restrictions.max_groups
    ?? restrictions.maxGroups;
  if (groupsPerPhotoRaw != null) {
    const groupsPerPhoto = parseFlickrCount(groupsPerPhotoRaw);
    if (groupsPerPhoto <= 0) {
      lines.push("This group doesn’t care how many other groups a photo is in");
    } else {
      lines.push(`A photo can be in up to ${groupsPerPhoto} group${groupsPerPhoto === 1 ? "" : "s"}`);
    }
  }

  const throttleCount = parseFlickrCount(throttle.count ?? throttle.max ?? throttle.value);
  if (throttleCount > 0) {
    const modeRaw = readFlickrTextField(throttle.mode ?? throttle.period ?? "day").toLowerCase();
    const period = modeRaw.includes("week") ? "week" : modeRaw.includes("month") ? "month" : "day";
    lines.push(`Members can post ${throttleCount} thing${throttleCount === 1 ? "" : "s"} to the pool each ${period}.`);
  }

  const mediaTypes = [];
  if (parseFlickrBool(restrictions.photos_ok ?? restrictions.photo_ok ?? restrictions.photos)) mediaTypes.push("Photos");
  if (parseFlickrBool(restrictions.videos_ok ?? restrictions.video_ok ?? restrictions.videos)) mediaTypes.push("Videos");
  if (mediaTypes.length) lines.push(`Accepted media types: ${mediaTypes.join(", ")}`);

  const contentTypes = [];
  if (parseFlickrBool(restrictions.images_ok ?? restrictions.image_ok ?? restrictions.images)) contentTypes.push("Photos");
  if (parseFlickrBool(restrictions.screens_ok ?? restrictions.screenshot_ok ?? restrictions.screens)) contentTypes.push("Screenshots");
  if (parseFlickrBool(restrictions.art_ok ?? restrictions.illustration_ok ?? restrictions.art)) contentTypes.push("Artwork");
  if (contentTypes.length) lines.push(`Accepted content types: ${contentTypes.join(", ")}`);

  const safetyLevels = [];
  if (parseFlickrBool(restrictions.safe_ok ?? restrictions.safe)) safetyLevels.push("Safe");
  if (parseFlickrBool(restrictions.moderate_ok ?? restrictions.moderate)) safetyLevels.push("Moderate");
  if (parseFlickrBool(restrictions.restricted_ok ?? restrictions.restricted)) safetyLevels.push("Restricted");
  if (safetyLevels.length) lines.push(`Accepted safety levels: ${safetyLevels.join(", ")}`);

  const rawAdditionalInfo = readFlickrTextField(
    group.additional_info ||
    group.additionalInfo ||
    group.info_bottom ||
    group.infoBottom ||
    group.pool_info ||
    group.poolInfo ||
    group.pool_message ||
    group.poolMessage
  );

  const generated = lines.join("\n").trim();
  if (rawAdditionalInfo && generated) return `${rawAdditionalInfo}\n\n${generated}`;
  return rawAdditionalInfo || generated;
}

function readFlickrGroupCount(group, keys) {
  if (!group || typeof group !== "object") return 0;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(group, key)) continue;
    const parsed = parseFlickrCount(group[key]);
    if (parsed > 0) return parsed;
  }
  return 0;
}

async function getGroupInfo({ apiKey, apiSecret, token, tokenSecret, groupId }) {
  try {
    const j = await flickrRestCall({
      apiKey, apiSecret, token, tokenSecret,
      methodName: "flickr.groups.getInfo",
      params: { group_id: groupId }
    });
    
    if (j.group) {
      const description = readFlickrTextField(j.group.description);
      const rulesText = readFlickrTextField(j.group.rules || j.group.pool_rules || j.group.poolRules || j.group.rule_text);
      const additionalInfo = buildGroupAdditionalInfo(j.group);
      const adminBlast = readFlickrTextField(
        j.group.admin_blast ||
        j.group.adminBlast ||
        j.group.admin_message ||
        j.group.adminMessage ||
        j.group.blast ||
        j.group.message
      );
      const alias = readFlickrTextField(j.group.path_alias);
      const groupUrl = alias
        ? `https://www.flickr.com/groups/${encodeURIComponent(alias)}/`
        : `https://www.flickr.com/groups/${encodeURIComponent(String(groupId || ""))}/`;
      const memberCount = readFlickrGroupCount(j.group, ["members", "member_count", "membercount", "users", "user_count"]);
      const photoCount = readFlickrGroupCount(j.group, ["photos", "pool_count", "poolcount", "count_photos", "photo_count"]);

      return {
        memberCount,
        photoCount,
        description,
        rulesText,
        additionalInfo,
        adminBlast,
        groupUrl,
      };
    }
  } catch (e) {
    console.warn(`[Flickr] Failed to fetch info for group ${groupId}:`, e.message);
  }
  return {
    memberCount: 0,
    photoCount: 0,
    description: "",
    rulesText: "",
    additionalInfo: "",
    adminBlast: "",
    groupUrl: `https://www.flickr.com/groups/${encodeURIComponent(String(groupId || ""))}/`,
  };
}

async function listGroups({ apiKey, apiSecret, token, tokenSecret }) {
  let allGroups = [];
  let page = 1;
  let pages = 1;
  
  // Fetch all pages
  while (page <= pages) {
    const j = await flickrRestCall({
      apiKey, apiSecret, token, tokenSecret,
      methodName: "flickr.groups.pools.getGroups",
      params: { page: String(page), per_page: "500" }
    });
    
    if (j.groups) {
      pages = Number(j.groups.pages || 1);
      const list = j.groups.group ? (Array.isArray(j.groups.group) ? j.groups.group : [j.groups.group]) : [];
      allGroups = allGroups.concat(list.map(g => ({ id: g.nsid, name: decodeHtmlEntities(g.name) })));
      
      if (pages > 1) {
        console.log(`[Flickr] Fetched groups page ${page}/${pages} (${allGroups.length} groups so far)`);
      }
    }
    
    page++;
  }
  return allGroups;
}

async function listAlbums({ apiKey, apiSecret, token, tokenSecret, userNsid }) {
  let allAlbums = [];
  let page = 1;
  let pages = 1;
  
  // Fetch all pages
  while (page <= pages) {
    const j = await flickrRestCall({
      apiKey, apiSecret, token, tokenSecret,
      methodName: "flickr.photosets.getList",
      params: { user_id: userNsid, page: String(page), per_page: "500" }
    });
    
    if (j.photosets) {
      pages = Number(j.photosets.pages || 1);
      const list = j.photosets.photoset ? (Array.isArray(j.photosets.photoset) ? j.photosets.photoset : [j.photosets.photoset]) : [];
      allAlbums = allAlbums.concat(list.map(a => ({ id: a.id, title: decodeHtmlEntities(a.title?._content || a.title || "") })));
      
      if (pages > 1) {
        console.log(`[Flickr] Fetched albums page ${page}/${pages} (${allAlbums.length} albums so far)`);
      }
    }
    
    page++;
  }
  
  return allAlbums;
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

/**
 * Convert geo privacy to Flickr permission flags
 * Flickr geo permissions: is_public, is_contact, is_friend, is_family
 */
function geoPrivacyToPerms(geoPrivacy) {
  // Default: private (all 0)
  const out = { is_public: "0", is_contact: "0", is_friend: "0", is_family: "0" };
  
  if (geoPrivacy === "public") {
    out.is_public = "1";
  } else if (geoPrivacy === "contacts") {
    out.is_contact = "1";
  } else if (geoPrivacy === "friends") {
    out.is_friend = "1";
  } else if (geoPrivacy === "family") {
    out.is_family = "1";
  } else if (geoPrivacy === "friends_family") {
    out.is_friend = "1";
    out.is_family = "1";
  }
  // else: private (all 0)
  
  return out;
}

/**
 * Set geographic location for a photo
 * @param {Object} params
 * @param {string} params.photoId - Flickr photo ID
 * @param {number} params.latitude - Latitude (-90 to 90)
 * @param {number} params.longitude - Longitude (-180 to 180)
 * @param {number} params.accuracy - Accuracy level 1-16 (1=world, 16=street)
 * @param {string} params.geoPrivacy - Who can see location (public, contacts, friends, family, friends_family, private)
 */
async function setPhotoLocation({ apiKey, apiSecret, token, tokenSecret, photoId, latitude, longitude, accuracy, geoPrivacy }) {
  // Set the location
  await flickrRestCall({
    apiKey,
    apiSecret,
    token,
    tokenSecret,
    methodName: "flickr.photos.geo.setLocation",
    params: {
      photo_id: photoId,
      lat: String(latitude),
      lon: String(longitude),
      accuracy: String(accuracy || 16)
    }
  });
  
  // Set location privacy if specified
  if (geoPrivacy) {
    const perms = geoPrivacyToPerms(geoPrivacy);
    await flickrRestCall({
      apiKey,
      apiSecret,
      token,
      tokenSecret,
      methodName: "flickr.photos.geo.setPerms",
      params: {
        photo_id: photoId,
        is_public: perms.is_public,
        is_contact: perms.is_contact,
        is_friend: perms.is_friend,
        is_family: perms.is_family
      }
    });
  }
}


module.exports = {
  getRequestToken,
  getAuthorizeUrl,
  getAccessToken,
  uploadPhoto,
  addPhotoToAlbum,
  createAlbum,
  addPhotoToGroup,
  listGroups,
  getGroupInfo,
  listAlbums,
  getPhotoUrls,
  setPhotoLocation
};

