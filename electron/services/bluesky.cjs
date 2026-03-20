const fs = require("fs");
const https = require("https");
const mime = require("mime-types");

const DEFAULT_BSKY_SERVICE = "https://bsky.social";
const MAX_BSKY_TEXT = 300;

function requestJson({ serviceUrl, path, method, accessJwt, body, headers }) {
  const base = new URL(String(serviceUrl || DEFAULT_BSKY_SERVICE));
  const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf-8");
  const reqHeaders = {
    Accept: "application/json",
    ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
    ...(accessJwt ? { Authorization: `Bearer ${accessJwt}` } : {}),
    ...(headers || {}),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: String(method || "GET"),
        hostname: base.hostname,
        port: base.port || undefined,
        path,
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
            const msg = parsed?.message || data || `HTTP ${status}`;
            const code = parsed?.error ? String(parsed.error) : "";
            reject(new Error(`Bluesky API error: ${msg}${code ? ` [${code}]` : ""}`));
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

function requestBinary({ serviceUrl, path, accessJwt, contentType, bodyBuffer }) {
  const base = new URL(String(serviceUrl || DEFAULT_BSKY_SERVICE));
  const payload = Buffer.isBuffer(bodyBuffer) ? bodyBuffer : Buffer.from([]);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessJwt}`,
    "Content-Type": String(contentType || "application/octet-stream"),
    "Content-Length": String(payload.length),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: base.hostname,
        port: base.port || undefined,
        path,
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
            const msg = parsed?.message || data || `HTTP ${status}`;
            const code = parsed?.error ? String(parsed.error) : "";
            reject(new Error(`Bluesky API error: ${msg}${code ? ` [${code}]` : ""}`));
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

function buildPostText({ item, postTextMode }) {
  const mode = String(postTextMode || "merge_title_description_tags");
  const title = String(item?.title || "").trim();
  const description = String(item?.description || "").trim();
  const hashtagLine = buildHashtagLine(item?.tags || "");

  if (mode === "title_only") return title;
  if (mode === "description_only") return description;

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

  return lines.join("\n").trim();
}

function splitTextForPosts(text, maxLen = MAX_BSKY_TEXT) {
  const source = String(text || "").trim();
  if (!source) return ["Photo"];
  if (source.length <= maxLen) return [source];

  const chunks = [];
  const tokens = source.split(/(\s+)/);
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const token of tokens) {
    if (!token) continue;
    if (token.length > maxLen) {
      if (current.trim()) pushCurrent();
      for (let i = 0; i < token.length; i += maxLen) {
        const part = token.slice(i, i + maxLen).trim();
        if (part) chunks.push(part);
      }
      continue;
    }

    if ((current + token).length > maxLen) {
      pushCurrent();
      current = token.trimStart();
    } else {
      current += token;
    }
  }

  if (current.trim()) pushCurrent();
  return chunks.length ? chunks : [source.slice(0, maxLen)];
}

function truncateTextWholeWords(text, maxLen = MAX_BSKY_TEXT) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (source.length <= maxLen) return source;

  // Keep original whitespace/newlines but never cut through a word token.
  const tokens = source.match(/\S+|\s+/g) || [];
  let out = "";

  for (const token of tokens) {
    if (!token) continue;

    if (!token.trim()) {
      if (!out) continue;
      if ((out + token).length > maxLen) break;
      out += token;
      continue;
    }

    if ((out + token).length > maxLen) break;
    out += token;
  }

  return out.trimEnd();
}

async function createPostRecord({ accessJwt, did, serviceUrl, record }) {
  return requestJson({
    serviceUrl,
    path: "/xrpc/com.atproto.repo.createRecord",
    method: "POST",
    accessJwt,
    body: {
      repo: did,
      collection: "app.bsky.feed.post",
      record,
    },
  });
}

async function createSession({ identifier, appPassword, serviceUrl }) {
  const out = await requestJson({
    serviceUrl,
    path: "/xrpc/com.atproto.server.createSession",
    method: "POST",
    body: {
      identifier: String(identifier || "").trim(),
      password: String(appPassword || ""),
    },
  });

  return {
    accessJwt: String(out?.accessJwt || ""),
    refreshJwt: String(out?.refreshJwt || ""),
    did: String(out?.did || ""),
    handle: String(out?.handle || ""),
    serviceUrl: String(serviceUrl || DEFAULT_BSKY_SERVICE),
  };
}

async function uploadBlob({ accessJwt, photoPath, serviceUrl }) {
  const binary = fs.readFileSync(photoPath);
  const contentType = mime.lookup(photoPath) || "application/octet-stream";
  const out = await requestBinary({
    serviceUrl,
    path: "/xrpc/com.atproto.repo.uploadBlob",
    accessJwt,
    contentType,
    bodyBuffer: binary,
  });
  return out?.blob || out;
}

async function createImagePost({ accessJwt, did, serviceUrl, item, postTextMode, longPostMode, safetyLevel, useDescriptionAsAltText }) {
  if (!String(did || "").trim()) throw new Error("Missing Bluesky DID.");
  if (!item?.photoPath) throw new Error("Missing local photo path for Bluesky upload.");

  const blob = await uploadBlob({ accessJwt, photoPath: item.photoPath, serviceUrl });
  const text = buildPostText({ item, postTextMode });
  const mode = String(longPostMode || "truncate");
  const chunks = mode === "thread" ? splitTextForPosts(text, MAX_BSKY_TEXT) : [];
  const descriptionAlt = String(item?.description || "").trim();
  const titleAlt = String(item?.title || "").trim();
  const alt = useDescriptionAsAltText
    ? (descriptionAlt || titleAlt || "Photo uploaded via ShutterQueue")
    : (titleAlt || "Photo uploaded via ShutterQueue");
  // Bluesky adult flag: true for Moderate (2) and Restricted (3), false for Safe (1)
  const adultFlag = safetyLevel && (safetyLevel === 2 || safetyLevel === 3);

  const firstText = mode === "thread" ? chunks[0] : (truncateTextWholeWords(text, MAX_BSKY_TEXT) || "Photo");
  const firstRecord = {
    $type: "app.bsky.feed.post",
    text: firstText || "Photo",
    createdAt: new Date().toISOString(),
    embed: {
      $type: "app.bsky.embed.images",
      images: [
        {
          alt,
          image: blob,
        },
      ],
    },
    labels: adultFlag ? {
      $type: "com.atproto.label.defs#labelValueSet",
      values: [{ val: "adult" }],
    } : undefined,
  };

  let out = await createPostRecord({ accessJwt, did, serviceUrl, record: firstRecord });

  if (mode === "thread" && chunks.length > 1) {
    const root = { uri: String(out?.uri || ""), cid: String(out?.cid || "") };
    let parent = { ...root };
    for (let i = 1; i < chunks.length; i++) {
      const record = {
        $type: "app.bsky.feed.post",
        text: chunks[i],
        createdAt: new Date().toISOString(),
        reply: {
          root,
          parent,
        },
            labels: adultFlag ? {
              $type: "com.atproto.label.defs#labelValueSet",
              values: [{ val: "adult" }],
            } : undefined,
      };
      const nextOut = await createPostRecord({ accessJwt, did, serviceUrl, record });
      parent = { uri: String(nextOut?.uri || ""), cid: String(nextOut?.cid || "") };
    }
  }

  return {
    uri: String(out?.uri || ""),
    cid: String(out?.cid || ""),
    text,
    postCount: mode === "thread" ? chunks.length : 1,
  };
}

module.exports = {
  createSession,
  createImagePost,
  DEFAULT_BSKY_SERVICE,
  // Exported for regression tests around text composition/truncation behavior.
  __test__: {
    buildPostText,
    truncateTextWholeWords,
    splitTextForPosts,
  },
};
