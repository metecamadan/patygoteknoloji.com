const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnTestServer } = require("./helpers/spawn-server");

test("clean URLs serve HTML and redirect .html aliases", async (t) => {
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: "test-admin-password" });

  const clean = await fetch(baseUrl + "/urunler");
  assert.equal(clean.status, 200);
  const cleanHtml = await clean.text();
  assert.match(cleanHtml, /Ürünler/i);
  assert.match(cleanHtml, /data-catalog-infinite/);

  const bootstrapApi = await fetch(baseUrl + "/api/catalog-bootstrap");
  assert.ok(bootstrapApi.status === 200 || bootstrapApi.status === 404);

  const aliased = await fetch(baseUrl + "/urunler.html", { redirect: "manual" });
  assert.equal(aliased.status, 301);
  assert.equal(aliased.headers.get("location"), "/urunler");

  const indexAlias = await fetch(baseUrl + "/index.html", { redirect: "manual" });
  assert.equal(indexAlias.status, 301);
  assert.equal(indexAlias.headers.get("location"), "/");

  const withQuery = await fetch(baseUrl + "/urun-detay.html?id=demo", { redirect: "manual" });
  assert.equal(withQuery.status, 301);
  assert.equal(withQuery.headers.get("location"), "/urun-detay?id=demo");

  const trailing = await fetch(baseUrl + "/markalar/", { redirect: "manual" });
  assert.equal(trailing.status, 301);
  assert.equal(trailing.headers.get("location"), "/markalar");
});
