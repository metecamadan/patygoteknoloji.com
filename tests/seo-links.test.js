const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const catalogJs = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
const detailJs = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");

const ANA = [
  "bilgisayar-tablet",
  "bilgisayar-bilesenleri",
  "kartus-toner",
  "baski-cozumleri",
  "yapi-gerecleri",
  "ofis-urunleri",
];

test("footer and homepage expose crawlable ANA category hrefs", () => {
  for (const slug of ANA) {
    const href = 'href="/urunler?kategori=' + slug + '"';
    assert.match(indexHtml, new RegExp(href.replace(/[?]/g, "\\?")), slug);
  }
  assert.match(indexHtml, /<h4>Kategoriler<\/h4>/);
  assert.doesNotMatch(indexHtml, /href=["']javascript:/i);
  assert.match(indexHtml, /application\/ld\+json/);
  assert.match(indexHtml, /"@type": "Organization"/);
});

test("sitemap lists category pages and omits checkout surfaces", () => {
  assert.match(sitemap, /<lastmod>/);
  for (const slug of ANA) {
    assert.match(sitemap, new RegExp("urunler\\?kategori=" + slug));
  }
  assert.doesNotMatch(sitemap, /\/sepet/);
  assert.doesNotMatch(sitemap, /\/odeme/);
  assert.doesNotMatch(sitemap, /\/admin/);
  assert.match(robots, /Disallow: \/odeme/);
  assert.match(robots, /Disallow: \/sepet/);
});

test("product cards wrap media in a real product-detail href", () => {
  assert.match(catalogJs, /product-card-media/);
  assert.match(catalogJs, /visualWrap\.href = window\.PatygoCatalog\.productHref\(product\)/);
  assert.match(catalogJs, /img\.alt = product\.name \|\| brand/);
  assert.match(catalogJs, /link\.href = href/);
  assert.match(catalogJs, /searchParams\.set\("sayfa"/);
});

test("product detail breadcrumbs follow ANA / ARA / ALT then the product", () => {
  assert.match(detailJs, /resolveProductCategoryTrail/);
  assert.match(detailJs, /BreadcrumbList/);
  assert.match(detailJs, /"@type": "Product"/);
  assert.match(detailJs, /Ürün kataloğuna dön/);
  assert.match(detailJs, /function parseProductPath\(pathname\)/);
  assert.match(catalogJs, /function resolveProductCategoryTrail|resolveProductCategoryTrail\(product/);
  assert.match(catalogJs, /prettyCategoryName/);
});
