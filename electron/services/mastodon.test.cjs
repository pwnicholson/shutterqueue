const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("https");

const mastodon = require("./mastodon.cjs");

const { buildPostText, mapPrivacyToVisibility, normalizeStatusUrl } = mastodon.__test__;

async function withMockedHttpsRequest(mockImpl, run) {
  const original = https.request;
  https.request = mockImpl;
  try {
    return await run();
  } finally {
    https.request = original;
  }
}

function createJsonRequestMock(responder) {
  return (options, onResponse) => {
    const req = new EventEmitter();
    let body = "";

    req.write = (chunk) => {
      body += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk || "");
      return true;
    };

    req.end = () => {
      const result = responder(options || {}, body);
      const statusCode = Number(result?.statusCode || 200);
      const payload = result?.json == null ? "" : JSON.stringify(result.json);
      const res = new EventEmitter();
      res.statusCode = statusCode;
      process.nextTick(() => {
        onResponse(res);
        process.nextTick(() => {
          if (payload) res.emit("data", payload);
          res.emit("end");
        });
      });
    };

    return req;
  };
}

test("Mastodon buildPostText keeps newline between title and description", () => {
  const text = buildPostText({
    item: { title: "Title", description: "Description", tags: "" },
    postTextMode: "merge_title_description",
  });
  assert.equal(text, "Title\nDescription");
});

test("Mastodon buildPostText appends hashtags on separate line", () => {
  const text = buildPostText({
    item: { title: "Title", description: "Description", tags: "tag one,TagTwo" },
    postTextMode: "merge_title_description_tags",
  });
  assert.equal(text, "Title\nDescription\n#tagone #TagTwo");
});

test("Mastodon buildPostText includes prepend and append lines", () => {
  const text = buildPostText({
    item: { title: "Title", description: "Description", tags: "" },
    postTextMode: "merge_title_description",
    prependText: "Prefix",
    appendText: "Suffix",
  });
  assert.equal(text, "Prefix\nTitle\nDescription\nSuffix");
});

test("Mastodon unsupported privacy maps to private with warning", () => {
  const out = mapPrivacyToVisibility("friends");
  assert.equal(out.visibility, "private");
  assert.match(out.warning, /not supported/i);
});

test("Mastodon public/private privacy values stay unchanged", () => {
  assert.equal(mapPrivacyToVisibility("public").visibility, "public");
  assert.equal(mapPrivacyToVisibility("private").visibility, "private");
});

test("Mastodon normalizeStatusUrl strips query/hash/trailing slash", () => {
  const out = normalizeStatusUrl("https://Pixelfed.Example/@alice/12345/?utm=abc#fragment");
  assert.equal(out, "https://pixelfed.example/@alice/12345");
});

test("Mastodon resolveStatusIdByUrl chooses exact URL match from search", async () => {
  await withMockedHttpsRequest(
    createJsonRequestMock((options) => {
      assert.match(String(options.path || ""), /^\/api\/v2\/search\?/);
      return {
        statusCode: 200,
        json: {
          statuses: [
            { id: "111", url: "https://other.example/@x/1" },
            { id: "222", url: "https://pixelfed.example/@alice/12345" },
          ],
        },
      };
    }),
    async () => {
      const id = await mastodon.resolveStatusIdByUrl({
        instanceUrl: "https://mastodon.social",
        accessToken: "token",
        statusUrl: "https://pixelfed.example/@alice/12345/",
      });
      assert.equal(id, "222");
    }
  );
});

test("Mastodon reblogStatus hits encoded reblog endpoint", async () => {
  await withMockedHttpsRequest(
    createJsonRequestMock((options) => {
      assert.equal(String(options.method || ""), "POST");
      assert.equal(String(options.path || ""), "/api/v1/statuses/123%2Fabc/reblog");
      return {
        statusCode: 200,
        json: {
          id: "boost-1",
          url: "https://mastodon.social/@me/boost-1",
        },
      };
    }),
    async () => {
      const out = await mastodon.reblogStatus({
        instanceUrl: "https://mastodon.social",
        accessToken: "token",
        statusId: "123/abc",
      });
      assert.equal(out.id, "boost-1");
      assert.equal(out.url, "https://mastodon.social/@me/boost-1");
      assert.equal(out.statusId, "123/abc");
    }
  );
});
