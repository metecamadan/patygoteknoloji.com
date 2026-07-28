const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const catalogJs = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
const navJs = fs.readFileSync(path.join(root, "assets", "js", "nav.js"), "utf8");

test("homepage positions as e-commerce store not quote request", () => {
  assert.doesNotMatch(indexHtml, /quote-card/);
  assert.doesNotMatch(indexHtml, /id="teklif"/);
  assert.doesNotMatch(indexHtml, /Teklif Talebi/);
  assert.match(indexHtml, /data-hero-categories/);
  assert.match(indexHtml, /Alışverişe Başla/);
});

test("catalog product cards use cart flow without quote button", () => {
  assert.doesNotMatch(catalogJs, /btn-quote/);
  assert.doesNotMatch(catalogJs, /Teklif Al/);
  assert.match(catalogJs, /Sepete Ekle/);
  assert.match(catalogJs, /Hemen Al/);
});

test("nav renders hero category tiles from categories json", () => {
  assert.match(navJs, /renderHeroCategories/);
  assert.match(navJs, /hero-category-tile/);
});
