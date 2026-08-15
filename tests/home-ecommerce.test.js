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
  assert.match(indexHtml, /id="teklif"/);
  assert.match(indexHtml, /data-hero-orbit/);
  assert.match(indexHtml, /Alışverişe Başla/);
  assert.match(indexHtml, /Teklif Al/);
  assert.doesNotMatch(indexHtml, /hero-cta[\s\S]*Sepetim/);
  assert.doesNotMatch(indexHtml, /Güncel Katalog/);
  assert.match(indexHtml, /<strong>Hızlı<\/strong><span>Teslimat<\/span>/);
});

test("catalog product cards use cart flow without quote button", () => {
  assert.doesNotMatch(catalogJs, /btn-quote/);
  assert.doesNotMatch(catalogJs, /Teklif Al/);
  assert.match(catalogJs, /Sepete Ekle/);
  assert.match(catalogJs, /Hemen Al/);
});

test("catalog filters storefront products by site category query instead of always emptying", () => {
  assert.match(catalogJs, /function productsForSiteCategory/);
  assert.match(catalogJs, /categoryQuery/);
  assert.match(catalogJs, /Bu kategoride henüz ürün yok/);
  assert.doesNotMatch(catalogJs, /Bu kategori yakında/);
  assert.doesNotMatch(
    catalogJs,
    /if \(opts\.categoryResolved\) \{\s*renderCategoryEmpty/
  );
});

test("nav renders animated hero orbit icons from live site categories", () => {
  assert.match(navJs, /renderHeroOrbit/);
  assert.match(navJs, /hero-orbit-chip/);
  assert.match(navJs, /HERO_ORBIT_LAYOUT/);
  assert.match(navJs, /function pickHeroOrbitChips/);
  assert.match(navJs, /leftoverChildren/);
  assert.match(navJs, /tasinabilir-bilgisayarlar/);
  assert.match(navJs, /islemciler/);
  assert.match(navJs, /nav-mega-groups/);
});

test("homepage featured grid uses live catalog tabs instead of demo categories", () => {
  assert.match(indexHtml, /data-filter="oem-cevre-birimleri"/);
  assert.match(indexHtml, /data-filter="cevre-baski-birimleri"/);
  assert.match(indexHtml, /data-filter="tuketici-elektronigi"/);
  assert.match(indexHtml, /data-filter="ev-aletleri"/);
  assert.doesNotMatch(indexHtml, /data-filter="bilgisayar"/);
  assert.doesNotMatch(indexHtml, /data-filter="kisisel-bilgisayarlar"/);
  assert.doesNotMatch(indexHtml, /data-filter="kucuk-ev"/);
  assert.match(catalogJs, /if \(mode === "featured"\) list = list.slice\(0, 12\)/);
  assert.match(catalogJs, /featuredParents/);
  assert.doesNotMatch(catalogJs, /featured:\s*"1"/);
});

test("storefront catalog loads paginated products by category", () => {
  assert.match(catalogJs, /fetchProductPage/);
  assert.match(catalogJs, /data-catalog-pager|renderCatalogPager/);
  const urunler = fs.readFileSync(path.join(root, "urunler.html"), "utf8");
  assert.match(urunler, /data-catalog-pager/);
});

test("public storefront copy does not mention XML catalog sourcing", () => {
  const publicFiles = [
    "index.html",
    "urunler.html",
    "urun-detay.html",
    "sepet.html",
    "odeme.html",
    "assets/js/catalog.js",
    "assets/js/cart.js",
    "assets/js/nav.js",
    "assets/js/urun-detay.js",
    "assets/js/sepet.js",
    "assets/js/checkout.js",
    "assets/js/main.js",
    "assets/js/markalar.js",
  ];
  for (const rel of publicFiles) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8").replace(/image\/svg\+xml/gi, "");
    assert.doesNotMatch(text, /\bXML\b/i, rel + " should not mention XML to shoppers");
  }
  assert.doesNotMatch(indexHtml, /Güncel Katalog/);
  assert.doesNotMatch(catalogJs, /XML katalog/i);
});
