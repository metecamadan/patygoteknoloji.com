const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(
  path.join(__dirname, "..", "admin-v2-preview.html"),
  "utf8"
);

test("admin v2 preview is a standalone compact design mock", () => {
  assert.match(html, /Admin Panel v2 — Önizleme/);
  assert.match(html, /Canlıya bağlı değil/);
  assert.match(html, /data-view="products"/);
  assert.match(html, /data-view="xml"/);
  assert.match(html, /workspace/);
  assert.match(html, /sticky-save/);
  assert.match(html, /min 5/);
  assert.doesNotMatch(html, /admin\.js/);
});
