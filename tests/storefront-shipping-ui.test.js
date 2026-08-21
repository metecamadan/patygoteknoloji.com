const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("shipping.js exposes product and cart shipping helpers", () => {
  const js = read("assets/js/shipping.js");
  assert.match(js, /productShippingInfo/);
  assert.match(js, /cartShippingInfo/);
  assert.match(js, /createProductShippingEl/);
  assert.match(js, /Ücretsiz kargo/);
});

test("catalog cards and detail page show shipping from panel rules", () => {
  const catalog = read("assets/js/catalog.js");
  const detail = read("assets/js/urun-detay.js");
  assert.match(catalog, /createProductShippingEl/);
  assert.match(catalog, /PatygoShipping\.load/);
  assert.match(detail, /detail-shipping/);
  assert.match(detail, /productShippingInfo/);
});

test("cart and checkout show shipping fee or free with threshold hint", () => {
  const sepet = read("assets/js/sepet.js");
  const checkout = read("assets/js/checkout.js");
  assert.match(sepet, /cartShippingInfo/);
  assert.match(sepet, /cartShippingHint/);
  assert.match(checkout, /cartShippingInfo/);
  assert.match(checkout, /checkoutShippingHint/);
});

test("storefront pages load shipping.js before catalog", () => {
  for (const page of ["index.html", "urunler.html", "urun-detay.html", "sepet.html", "odeme.html"]) {
    const html = read(page);
    assert.match(html, /shipping\.js\?v=storefront-ship-2/);
    const shipIdx = html.indexOf("shipping.js");
    const catalogIdx = html.indexOf("catalog.js");
    assert.ok(shipIdx >= 0 && catalogIdx >= 0, page + " should include both scripts");
    assert.ok(shipIdx < catalogIdx, page + " should load shipping before catalog");
  }
});

test("style.css includes product shipping badge styles", () => {
  const css = read("assets/css/style.css");
  assert.match(css, /\.product-shipping/);
  assert.match(css, /\.product-shipping--free/);
  assert.match(css, /\.shipping-hint/);
});
