const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSiteBaseUrl } = require("../lib/site-url");

test("production SITE_BASE_URL must be https domain, not IP", () => {
  assert.equal(
    resolveSiteBaseUrl("https://patygoteknoloji.com", 5173, true),
    "https://patygoteknoloji.com"
  );
  assert.throws(
    () => resolveSiteBaseUrl("http://203.0.113.10", 5173, true),
    /https|alan adı/i
  );
  assert.throws(
    () => resolveSiteBaseUrl("https://127.0.0.1", 5173, true),
    /IP|localhost|alan adı/i
  );
  assert.throws(() => resolveSiteBaseUrl("", 5173, true), /zorunlu/i);
});

test("local SITE_BASE_URL may fall back to localhost", () => {
  assert.equal(resolveSiteBaseUrl("", 5173, false), "http://localhost:5173");
  assert.equal(
    resolveSiteBaseUrl("http://127.0.0.1:5173", 5173, false),
    "http://127.0.0.1:5173"
  );
});
