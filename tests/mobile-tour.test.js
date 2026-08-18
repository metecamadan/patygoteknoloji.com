const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "assets", "css", "admin.css"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "assets", "js", "main.js"), "utf8");
const catalogJs = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
const detailJs = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");
const sepetJs = fs.readFileSync(path.join(root, "assets", "js", "sepet.js"), "utf8");
const checkoutJs = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "assets", "js", "admin.js"), "utf8");
const sepetHtml = fs.readFileSync(path.join(root, "sepet.html"), "utf8");
const odemeHtml = fs.readFileSync(path.join(root, "odeme.html"), "utf8");

test("storefront skip link and global focus ring", () => {
  assert.match(mainJs, /skip-link/);
  assert.match(mainJs, /main-content/);
  assert.match(css, /\.skip-link:focus/);
  assert.match(css, /a:focus-visible/);
  assert.match(css, /button:focus-visible/);
});

test("catalog mobile filters expose active chips and qty stepper export", () => {
  assert.match(catalogJs, /renderActiveFilterChips/);
  assert.match(catalogJs, /catalog-active-filter-chip/);
  assert.match(catalogJs, /"Filtrele \(" \+/);
  assert.match(catalogJs, /createQtyStepper = createQtyStepper/);
  assert.match(css, /\.catalog-active-filters/);
});

test("product detail mobile adds qty stepper and trust copy", () => {
  assert.match(detailJs, /createQtyStepper/);
  assert.match(detailJs, /detail-trust/);
  assert.match(detailJs, /setTimeout/);
  assert.match(detailJs, /aria-current/);
  assert.doesNotMatch(detailJs, /nameCrumb/);
  assert.match(css, /\.detail-trust/);
  assert.match(css, /\.detail-qty-row/);
  assert.match(css, /\.detail-thumbs[\s\S]*?display:\s*flex/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.product-detail \.breadcrumb[\s\S]*?overflow-x:\s*auto/);
});

test("cart checkout funnel and consistent payment CTA", () => {
  assert.match(sepetHtml, /checkout-funnel/);
  assert.match(odemeHtml, /checkout-funnel/);
  assert.match(odemeHtml, /checkout-continue-link/);
  assert.match(odemeHtml, /id="sameAddress"/);
  assert.match(checkoutJs, /sameAddress/);
  assert.match(sepetJs, /Ödemeye geç/);
  assert.doesNotMatch(sepetJs, /Sipariş talebine geç/);
  assert.match(css, /\.checkout-funnel li\.is-current/);
});

test("mobile cart lines stack controls on narrow screens", () => {
  assert.match(
    css,
    /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.cart-line\s*\{[^}]*grid-template-areas/s
  );
  assert.match(css, /\.cart-stepper[\s\S]*?44px/);
});

test("admin mobile keeps health dot and sticky modal actions", () => {
  assert.match(adminJs, /dark \? "Açık" : "Koyu"/);
  assert.match(
    adminCss,
    /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.admin-modal-form > \.admin-form-actions/s
  );
});
