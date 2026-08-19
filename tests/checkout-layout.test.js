const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "odeme.html"), "utf8");
const cartHtml = fs.readFileSync(path.join(root, "sepet.html"), "utf8");
const cartJs = fs.readFileSync(path.join(root, "assets", "js", "sepet.js"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");

test("checkout page uses compact hero and section spacing", () => {
  assert.match(html, /class="checkout-page"/);
  assert.doesNotMatch(html, /breadcrumb/);
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
  assert.doesNotMatch(html, /checkout-continue-link/);
  assert.doesNotMatch(html, /nav-toggle/);
  assert.match(css, /\.checkout-page \.nav-links/);
  assert.match(css, /\.checkout-page \.checkout-hero p\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.checkout-page \.checkout-hero \.container/);
  assert.match(css, /\.qty-row\[hidden\]/);
});

test("cart page uses compact hero and avoids duplicate empty-state CTAs", () => {
  assert.match(cartHtml, /class="cart-page"/);
  assert.doesNotMatch(cartHtml, /breadcrumb/);
  assert.match(cartHtml, /id="cartContinue"/);
  assert.match(css, /\.cart-page \.cart-hero/);
  assert.match(css, /\.cart-checkout\[aria-disabled="true"\]/);
  assert.doesNotMatch(cartJs, /Ürün kataloğuna git/);
  assert.match(cartJs, /continueBtn\.hidden = true/);
});
