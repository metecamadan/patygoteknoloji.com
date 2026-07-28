const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const catalogJs = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
const navJs = fs.readFileSync(path.join(root, "assets", "js", "nav.js"), "utf8");

test("homepage keeps teklif form and e-commerce hero", () => {
  assert.doesNotMatch(indexHtml, /quote-card/);
  assert.doesNotMatch(indexHtml, /Teklif Talebi/);
  assert.match(indexHtml, /id="teklif"/);
  assert.match(indexHtml, /data-hero-orbit/);
  assert.match(indexHtml, /Alışverişe Başla/);
  assert.match(indexHtml, /Teklif Al/);
});

test("catalog product cards use cart flow without quote button", () => {
  assert.doesNotMatch(catalogJs, /btn-quote/);
  assert.doesNotMatch(catalogJs, /Teklif Al/);
  assert.match(catalogJs, /Sepete Ekle/);
  assert.match(catalogJs, /Hemen Al/);
});

test("nav renders animated hero orbit icons from categories json", () => {
  assert.match(navJs, /renderHeroOrbit/);
  assert.match(navJs, /hero-orbit-chip/);
  assert.match(navJs, /HERO_ORBIT_LAYOUT/);
});
