const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("kvkk page publishes retention schedule table", () => {
  const html = fs.readFileSync(path.join(root, "kvkk.html"), "utf8");
  assert.match(html, /Saklama Süresi/);
  assert.match(html, /10 yıl/);
  assert.match(html, /info-table/);
  assert.match(html, /Kart numarası/);
});

test("checkout requires KVKK consent and addresses", () => {
  const html = fs.readFileSync(path.join(root, "odeme.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");
  assert.match(html, /id="onayKvkk"/);
  assert.match(html, /id="faturaAdres"/);
  assert.match(html, /id="teslimatAdres"/);
  assert.match(html, /customer-identity\.js/);
  assert.match(js, /PatygoCustomerIdentity/);
  assert.match(js, /kvkkAccepted/);
  assert.match(js, /billingAddress/);
});

test("sqlite commerce plan doc exists", () => {
  const doc = fs.readFileSync(path.join(root, "docs", "plan-commerce-db-kvkk.md"), "utf8");
  assert.match(doc, /SQLite/);
  assert.match(doc, /consent_events/);
  assert.match(doc, /Faz 1/);
});
