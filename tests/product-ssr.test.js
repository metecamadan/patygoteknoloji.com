const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  renderProductHtml,
  renderMissingProductHtml,
  renderCategoryHtml,
  renderMissingCategoryHtml,
  withListingPage,
  findCategoryNames,
  priceInclVat,
} = require("../lib/product-ssr");
const { buildStorefrontSitemap } = require("../lib/sitemap");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const detailShell = read("urun-detay.html");
const catalogShell = read("urunler.html");

const product = {
  id: "ssr-1",
  name: "Lenovo IdeaPad <Slim> 5",
  brand: "Lenovo",
  price: 1000,
  vatPercent: 20,
  description: "<p>Hafif &amp; güçlü dizüstü.</p>",
  image: "/media/catalog/ssr-1.webp",
  images: ["https://cdn.example.com/a.jpg"],
  barcode: "8690000000456",
  manufacturerCode: "LEN-5",
  urlPath: "/notebooklar/lenovo-ideapad-slim-5",
};

const categories = [
  {
    slug: "bilgisayar-tablet",
    name: "BİLGİSAYAR TABLET",
    children: [
      {
        slug: "tasinabilir-bilgisayarlar",
        name: "Taşınabilir Bilgisayarlar",
        children: [{ slug: "notebooklar", name: "Notebooklar" }],
      },
    ],
  },
];

test("product SSR writes title, description, canonical, og and escaped h1 + price", () => {
  const html = renderProductHtml(detailShell, product);
  assert.match(html, /<title>Lenovo IdeaPad &lt;Slim&gt; 5 \| Patygo Teknoloji<\/title>/);
  assert.match(html, /<meta name="description" content="Hafif &amp; güçlü dizüstü\." \/>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/patygoteknoloji\.com\/notebooklar\/lenovo-ideapad-slim-5" \/>/);
  assert.match(html, /<meta property="og:type" content="product" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/patygoteknoloji\.com\/media\/catalog\/ssr-1\.webp" \/>/);
  assert.match(html, /<meta property="product:price:amount" content="1200" \/>/);
  assert.match(html, /<h1>Lenovo IdeaPad &lt;Slim&gt; 5<\/h1>/);
  assert.match(html, /₺1\.200,00 <small>KDV dahil<\/small>/);
  assert.doesNotMatch(html, /Ürün yükleniyor/);
  assert.doesNotMatch(html, /faturalı satış/i);
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json" id="product-jsonld">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.offers.price, "1200");
  assert.equal(ld.gtin, "8690000000456");
  assert.equal(ld.brand.name, "Lenovo");
});

test("missing product page is noindex; category SSR uses tree names and 404s unknown paths", () => {
  const missing = renderMissingProductHtml(detailShell);
  assert.match(missing, /<meta name="robots" content="noindex" \/>/);
  assert.match(missing, /Ürün bulunamadı/);

  assert.deepEqual(
    findCategoryNames(categories, { parent: "bilgisayar-tablet", mid: "tasinabilir-bilgisayarlar", child: "notebooklar" }),
    ["Bilgisayar Tablet", "Taşınabilir Bilgisayarlar", "Notebooklar"]
  );
  const html = renderCategoryHtml(
    catalogShell,
    categories,
    { parent: "bilgisayar-tablet", mid: "tasinabilir-bilgisayarlar", child: "" },
    "/urunler/bilgisayar-tablet/tasinabilir-bilgisayarlar"
  );
  assert.match(html, /<title>Taşınabilir Bilgisayarlar Fiyatları ve Modelleri \| Patygo Teknoloji<\/title>/);
  assert.match(html, /data-catalog-title>Taşınabilir Bilgisayarlar<\/h1>/);
  assert.match(html, /canonical" href="https:\/\/patygoteknoloji\.com\/urunler\/bilgisayar-tablet\/tasinabilir-bilgisayarlar"/);
  assert.doesNotMatch(html, /faturalı satış/i);
  assert.equal(renderCategoryHtml(catalogShell, categories, { parent: "yok", mid: "", child: "" }, "/urunler/yok"), null);
  assert.match(renderMissingCategoryHtml(catalogShell), /noindex/);
});

test("?sayfa=N listing pages get their own canonical and title suffix", () => {
  const html = withListingPage(catalogShell, 3);
  assert.match(html, /<title>Ürünler – Sayfa 3 \| Patygo Teknoloji — Online Elektronik Mağaza<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/patygoteknoloji\.com\/urunler\?sayfa=3"/);
  assert.match(html, /og:url" content="https:\/\/patygoteknoloji\.com\/urunler\?sayfa=3"/);
  assert.equal(withListingPage(catalogShell, 1), catalogShell);
  assert.equal(priceInclVat({ price: 99.99, vatPercent: 20 }), 119.99);
});

test("sitemap lists product images with the image namespace", () => {
  const xml = buildStorefrontSitemap({
    baseUrl: "https://patygoteknoloji.com",
    categories: [],
    routeIndex: { byId: { "ssr-1": product.urlPath } },
    products: [product],
  });
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(
    xml,
    /<loc>https:\/\/patygoteknoloji\.com\/notebooklar\/lenovo-ideapad-slim-5<\/loc>[\s\S]*?<image:loc>https:\/\/patygoteknoloji\.com\/media\/catalog\/ssr-1\.webp<\/image:loc>/
  );
  const plain = buildStorefrontSitemap({ categories: [], routeIndex: { byId: {} } });
  assert.doesNotMatch(plain, /xmlns:image/);
});

test("catalog infinite scroll keeps ?sayfa= in the URL with crawlable prev/next links", () => {
  const catalogJs = read("assets/js/catalog.js");
  assert.match(catalogJs, /history\.replaceState\(history\.state, "", listingPageHref\(nextPage\)\)/);
  assert.match(catalogJs, /const startPage = onProductsPage \? readListingPageNumber\(\) : 1;/);
  assert.match(catalogJs, /startPage === 1 && !facetQueryActive\(\)/);
  assert.doesNotMatch(catalogJs, /cleanUrl\.searchParams\.delete\("sayfa"\)/);
  assert.match(catalogShell, /data-catalog-prev hidden><a href="\/urunler">/);
  assert.match(catalogShell, /data-catalog-next hidden><a href="\/urunler">/);
});

test("storefront HTML has no inline handlers (CSP script-src 'self') and ships icons/manifest/og", () => {
  const pages = fs.readdirSync(root).filter((name) => name.endsWith(".html") && name !== "admin.html");
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /\son[a-z]+="/i, page + " has an inline event handler");
    assert.match(html, /rel="apple-touch-icon" href="\/assets\/img\/apple-touch-icon\.png"/, page);
    assert.match(html, /rel="manifest" href="\/assets\/manifest\.json"/, page);
  }
  for (const page of ["index.html", "urunler.html", "kurumsal.html", "iletisim.html"]) {
    assert.match(read(page), /og:image" content="https:\/\/patygoteknoloji\.com\/assets\/img\/og-default\.png"/, page);
  }
  assert.match(read("assets/js/main.js"), /querySelectorAll\("\.fab \.top"\)[\s\S]{0,120}scrollTo\(\{ top: 0/);
  const manifest = JSON.parse(read("assets/manifest.json"));
  assert.equal(manifest.lang, "tr");
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src);
  assert.ok(fs.existsSync(path.join(root, "favicon.ico")));
  assert.equal(fs.readFileSync(path.join(root, "favicon.ico")).readUInt16LE(2), 1, "ICO header");
  const securityTxt = read(".well-known/security.txt");
  assert.match(securityTxt, /^Contact: mailto:info@patygoteknoloji\.com$/m);
  const expires = new Date(securityTxt.match(/^Expires: (.+)$/m)[1]);
  assert.ok(expires > new Date(), "security.txt Expires must stay in the future");
});

test("server renders product/category HTML from the warm index and 404s unknown paths", async (t) => {
  const { baseUrl } = await spawnTestServer(t, {}, {
    products: [
      {
        id: "ssr-live-1",
        brand: "TEST",
        name: "SSR Test Notebook",
        price: 1000,
        vatPercent: 20,
        category: "bilgisayar-tablet",
        siteParent: "bilgisayar-tablet",
        siteMid: "tasinabilir-bilgisayarlar",
        siteChild: "notebooklar",
        active: true,
        image: "/assets/img/products/macbook-air-m3.svg",
        images: ["/assets/img/products/macbook-air-m3.svg"],
        stockQty: 5,
        description: "Sunucu tarafında hazırlanan açıklama.",
        currency: "TRY",
      },
    ],
  });
  const listing = await (await fetch(baseUrl + "/api/products?limit=5")).json();
  const item = (listing.products || []).find((row) => row.id === "ssr-live-1");
  assert.ok(item && item.urlPath, "product urlPath missing from listing");

  const res = await fetch(baseUrl + item.urlPath, { headers: { Accept: "text/html" } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>[^<]*SSR Test Notebook \| Patygo Teknoloji<\/title>/);
  assert.match(html, /<h1>[^<]*SSR Test Notebook<\/h1>/);
  assert.match(html, /₺1\.200,00/);
  assert.match(res.headers.get("content-security-policy") || "", /script-src 'self'/);

  const missing = await fetch(baseUrl + "/notebooklar/boyle-bir-urun-yok", { headers: { Accept: "text/html" } });
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /noindex/);

  const category = await fetch(baseUrl + "/urunler/bilgisayar-tablet?sayfa=2", { headers: { Accept: "text/html" } });
  assert.equal(category.status, 200);
  const categoryHtml = await category.text();
  assert.match(categoryHtml, /Fiyatları ve Modelleri – Sayfa 2 \| Patygo Teknoloji<\/title>/);
  assert.match(categoryHtml, /rel="canonical" href="https:\/\/patygoteknoloji\.com\/urunler\/bilgisayar-tablet\?sayfa=2"/);
  assert.doesNotMatch(categoryHtml, /id="patygo-catalog-bootstrap"/);

  const unknownCategory = await fetch(baseUrl + "/urunler/boyle-kategori-yok", { headers: { Accept: "text/html" } });
  assert.equal(unknownCategory.status, 404);

  const sitemap = await (await fetch(baseUrl + "/sitemap.xml")).text();
  assert.match(sitemap, /<image:loc>[^<]*macbook-air-m3\.svg<\/image:loc>/);
});
