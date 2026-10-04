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

test("cart and checkout steps share the wide container and the same column split", () => {
  assert.doesNotMatch(css, /\.checkout-page \.checkout-(hero|section) \.container[^{]*\{[^}]*max-width/);
  const cols = (sel) => {
    const m = css.match(new RegExp("\\n" + sel.replace(".", "\\.") + "\\s*\\{[^}]*grid-template-columns:\\s*([^;]+);"));
    return m && m[1].trim();
  };
  assert.ok(cols(".cart-layout"), "cart-layout columns");
  assert.equal(cols(".checkout-wrap"), cols(".cart-layout"));
});

test("checkout shows the unit price for a single-product cart and hides the row for mixed carts", () => {
  const checkoutJs = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");
  assert.match(html, /class="checkout-sum" id="unitPriceRow"/);
  assert.doesNotMatch(checkoutJs, /unitPrice\.textContent = "—"/);
  assert.match(checkoutJs, /const singleProduct = t\.lines\.length === 1 \? t\.lines\[0\]\.product : null;/);
  assert.match(checkoutJs, /formatTRY\(priceIncl\(singleProduct\)\)/);
  assert.match(checkoutJs, /els\.unitPriceRow\.hidden = !singleProduct/);
  assert.match(css, /\.checkout-sum\[hidden\]\s*\{\s*display:\s*none !important;/);
});

test("checkout funnel hides catalog nav and extra exits", () => {
  assert.doesNotMatch(html, /Sipariş notu/);
  assert.doesNotMatch(html, /id="not"/);
  assert.doesNotMatch(html, /Ürün kataloğuna dön/);
  assert.doesNotMatch(html, /checkout-continue-link/);
  assert.doesNotMatch(html, /nav-toggle/);
  assert.match(css, /\.checkout-page \.nav-links/);
  assert.match(css, /\.checkout-page \.checkout-hero p\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.qty-row\[hidden\]/);
});

test("cart page uses compact hero and avoids duplicate empty-state CTAs", () => {
  assert.match(cartHtml, /class="cart-page"/);
  assert.doesNotMatch(cartHtml, /breadcrumb/);
  assert.match(css, /\.cart-page \.cart-hero/);
  assert.match(css, /\.cart-checkout\[aria-disabled="true"\]/);
  assert.doesNotMatch(cartJs, /Ürün kataloğuna git/);
});

test("phone cart keeps the full summary in flow and pins only a slim total + checkout bar", () => {
  const phone = css.match(/@media \(max-width:\s*700px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(phone, "missing 700px block");
  assert.match(phone[1], /\.cart-summary\s*\{\s*position:\s*static;\s*\}/);
  assert.doesNotMatch(phone[1], /\.cart-summary\s*\{[^}]*position:\s*sticky/);
  assert.match(phone[1], /\.cart-mobile-bar:not\(\[hidden\]\)\s*\{[^}]*position:\s*fixed/);
  assert.match(phone[1], /body\.has-cart-bar \.fab\s*\{/);
  assert.match(css, /\n\.cart-mobile-bar\s*\{\s*display:\s*none;\s*\}/);
  assert.match(cartHtml, /id="cartMobileBar"[^>]*hidden/);
  assert.match(cartHtml, /id="cartMobileTotal"/);
  assert.match(cartHtml, /id="cartMobileCheckout"/);
  assert.match(cartJs, /IntersectionObserver/);
});

test("cart summary has no continue-shopping link that pulls the customer back from checkout", () => {
  assert.doesNotMatch(cartHtml, /id="cartContinue"/);
  assert.doesNotMatch(cartHtml, /Ürün kataloğuna devam et/);
  assert.doesNotMatch(cartJs, /cartContinue|continueBtn/);
  assert.doesNotMatch(css, /\.cart-continue/);
});
