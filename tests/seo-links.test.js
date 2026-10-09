const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const catalogJs = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
const detailJs = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");
const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
const { buildStorefrontSitemap } = require("../lib/sitemap");

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
    const href = 'href="/urunler/' + slug + '"';
    assert.match(indexHtml, new RegExp(href), slug);
  }
  assert.match(indexHtml, /<h4>Kategoriler<\/h4>/);
  assert.doesNotMatch(indexHtml, /href=["']javascript:/i);
  assert.match(indexHtml, /application\/ld\+json/);
  assert.match(indexHtml, /"@type": "Organization"/);
});

test("footer sponsor link to the hosting partner passes no link equity", () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith(".html") && f !== "admin.html" && f !== "404.html");
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    if (!html.includes('class="footer-bottom"')) continue;
    const links = html.match(/<a [^>]*skyversal\.com[^>]*>/g) || [];
    assert.equal(links.length, 1, page);
    assert.match(links[0], /rel="sponsored nofollow noopener"/, page);
    assert.match(links[0], /target="_blank"/, page);
  }
});

test("sitemap lists category pages and omits checkout surfaces", () => {
  const sitemap = buildStorefrontSitemap({
    baseUrl: "https://patygoteknoloji.com",
    categories: ANA.map((slug) => ({ slug, name: slug, children: [] })),
    routeIndex: { byId: {} },
    now: new Date("2026-09-04T12:00:00Z"),
  });
  assert.match(sitemap, /<lastmod>/);
  for (const slug of ANA) {
    assert.match(sitemap, new RegExp("urunler/" + slug));
  }
  assert.doesNotMatch(sitemap, /\/sepet/);
  assert.doesNotMatch(sitemap, /\/odeme/);
  assert.doesNotMatch(sitemap, /\/admin/);
  assert.match(robots, /Disallow: \/odeme/);
  assert.match(robots, /Disallow: \/sepet/);
  assert.match(robots, /Sitemap: https:\/\/patygoteknoloji\.com\/sitemap\.xml/);
  const indexXml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.match(indexXml, /sitemapindex/);
  assert.match(indexXml, /https:\/\/patygoteknoloji\.com\/sitemap/);
});

test("server builds dynamic storefront sitemap and bare category redirects", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /buildStorefrontSitemap/);
  assert.match(server, /storefrontSitemapXml/);
  assert.match(server, /urlPath === "\/sitemap\.xml" \|\| urlPath === "\/sitemap"/);
  assert.match(server, /categoryHref\(parent\.slug\)/);
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
