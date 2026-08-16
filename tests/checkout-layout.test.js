const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "odeme.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");

test("checkout page uses compact hero and section spacing", () => {
  assert.match(html, /class="checkout-page"/);
  assert.match(html, /checkout-hero/);
  assert.match(html, /checkout-section/);
  assert.doesNotMatch(html, /section class="section" style="padding-top:0"/);
  assert.match(css, /\.checkout-page \.checkout-hero/);
  assert.match(css, /\.checkout-page \.checkout-section/);
  assert.match(css, /checkout-card-title/);
});

test("checkout funnel hides catalog nav and extra exits", () => {
  assert.doesNotMatch(html, /Sipariş notu/);
  assert.doesNotMatch(html, /id="not"/);
  assert.doesNotMatch(html, /Ürün kataloğuna dön/);
  assert.doesNotMatch(html, /nav-toggle/);
  assert.match(css, /\.checkout-page \.nav-links/);
  assert.match(css, /\.checkout-page \.checkout-hero p\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.checkout-page \.checkout-hero \.container/);
  assert.match(css, /\.qty-row\[hidden\]/);
});
