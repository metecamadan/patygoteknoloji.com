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
  assert.match(indexHtml, /btn btn-primary btn-lg">Ürün kataloğunu incele/);
  assert.doesNotMatch(indexHtml, /home-featured-lead[\s\S]*Ürün kataloğunu incele/);
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
  assert.match(catalogJs, /function prefetchProductDetail/);
  assert.match(catalogJs, /onDetailPage\) \{\s*return \{ products: \[\]/s);
});

test("category listing uses four-column cards with qty stepper and infinite scroll", () => {
  const urunler = fs.readFileSync(path.join(root, "urunler.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
  assert.match(catalogJs, /LISTING_PAGE_SIZE = 20/);
  assert.match(catalogJs, /product-card--listing/);
  assert.match(catalogJs, /createQtyStepper/);
  assert.match(catalogJs, /product-qty-row/);
  assert.match(css, /\.product-card\.product-card--listing \.price\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.product-card\.product-card--listing \.price-vat/);
  assert.ok(
    css.lastIndexOf(".product-card.product-card--listing .price") >
      css.indexOf(".product-card .price {"),
    "listing VAT stack must override the generic price row"
  );
  assert.match(catalogJs, /loadMoreListing/);
  assert.match(catalogJs, /listingScroll\.totalPages <= 1/);
  assert.match(catalogJs, /IntersectionObserver/);
  assert.match(catalogJs, /if \(compactListing\)/);
  assert.match(urunler, /data-catalog-infinite/);
  assert.match(urunler, /data-catalog-load-sentinel/);
  assert.match(css, /\.catalog-layout\.has-facets \.product-grid[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /repeat\(5, minmax\(0, 1fr\)\)/);
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
  assert.match(navJs, /notebooklar/);
  assert.match(navJs, /islemciler/);
  assert.match(navJs, /published\.forEach\(\(cat\) => root\.appendChild\(buildMegaItem\(cat\)\)\)/);
});

test("homepage featured tabs are crawlable category links", () => {
  assert.match(indexHtml, /href="\/urunler\?kategori=bilgisayar-tablet"/);
  assert.match(indexHtml, /href="\/urunler\?kategori=bilgisayar-bilesenleri"/);
  assert.match(indexHtml, /href="\/urunler\?kategori=kartus-toner"/);
  assert.match(indexHtml, /href="\/urunler\?kategori=baski-cozumleri"/);
  assert.match(indexHtml, /href="\/urunler\?kategori=yapi-gerecleri"/);
  const featuredTabs = indexHtml.match(/<nav class="product-tabs[\s\S]*?<\/nav>/);
  assert.ok(featuredTabs, "featured product tabs nav");
  assert.doesNotMatch(featuredTabs[0], /ofis-urunleri/);
  assert.match(indexHtml, /<nav class="product-tabs/);
  assert.doesNotMatch(indexHtml, /<div class="product-tabs/);
  assert.match(indexHtml, /data-filter="bilgisayar-tablet"/);
  assert.match(indexHtml, /data-filter="bilgisayar-bilesenleri"/);
  assert.match(indexHtml, /data-filter="kartus-toner"/);
  assert.match(indexHtml, /data-filter="baski-cozumleri"/);
  assert.match(indexHtml, /data-filter="yapi-gerecleri"/);
  assert.doesNotMatch(indexHtml, /data-filter="ofis-urunleri"/);
  assert.doesNotMatch(indexHtml, /data-filter="bilgisayar"/);
  assert.doesNotMatch(indexHtml, /data-filter="kucuk-ev"/);
  assert.doesNotMatch(indexHtml, /data-filter="kisisel-bilgisayarlar"/);
  assert.match(catalogJs, /FEATURED_PER_CATEGORY = 12/);
  assert.match(catalogJs, /if \(mode === "featured"\) list = list.slice\(0, FEATURED_PER_CATEGORY\)/);
  assert.match(catalogJs, /featuredParents|FEATURED_PARENTS/);
  assert.match(catalogJs, /homeFeatured:\s*"1"/);
  assert.match(catalogJs, /function fetchHomeFeatured/);
  assert.match(catalogJs, /home-featured\.json/);
  assert.match(catalogJs, /fetchHomeFeaturedSnapshot/);
  assert.match(catalogJs, /home\.mixed\.length/);
  assert.match(catalogJs, /PatygoCatalog\.list/);
  assert.match(catalogJs, /product-card--skeleton/);
  assert.match(catalogJs, /function showCatalogLoading/);
  assert.match(catalogJs, /patygo_listing_v1/);
  assert.match(catalogJs, /readListingCache/);
  assert.match(catalogJs, /prefetchListingHref/);
  assert.match(catalogJs, /\/api\/catalog-bootstrap/);
  assert.match(catalogJs, /\/listing\//);
  assert.match(catalogJs, /listingSnapshotFileName/);
  assert.match(catalogJs, /listingReloadToken/);
  assert.match(catalogJs, /readCatalogBootstrap/);
  assert.match(catalogJs, /function bindFeaturedTabs/);
  assert.match(catalogJs, /featuredListForFilter/);
  assert.match(catalogJs, /homeFeaturedSnapshotUsable/);
  assert.match(catalogJs, /countDisplayedListingProducts/);
  assert.match(catalogJs, /renderCatalogMeta\([\s\S]*listingInfinite/);
  assert.match(catalogJs, /sort:\s*"popular"/);
  assert.match(catalogJs, /cartOnly:\s*mode === "featured"/);
  assert.match(indexHtml, /home-featured-lead/);
  assert.match(catalogJs, /function applyCategoryHeading/);
  assert.match(catalogJs, /function resetCatalogHeading/);
  assert.match(catalogJs, /if \(lead\) lead\.hidden = true/);
  assert.doesNotMatch(catalogJs, /kategorisindeki ürünler/);
  assert.match(catalogJs, /prettyCategoryName/);
  assert.doesNotMatch(catalogJs, /featured:\s*"1"/);
});

test("storefront catalog loads paginated products by category", () => {
  assert.match(catalogJs, /fetchProductPage/);
  assert.match(catalogJs, /LISTING_PAGE_SIZE/);
  assert.match(catalogJs, /loadMoreListing/);
  const urunler = fs.readFileSync(path.join(root, "urunler.html"), "utf8");
  assert.match(urunler, /data-catalog-infinite/);
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
