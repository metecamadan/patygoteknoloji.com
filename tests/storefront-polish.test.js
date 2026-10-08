const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { homeFeaturedCatalog, buildBrandCounts, queryPublicCatalog } = require("../lib/catalog");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function product(id, parent, price, extra) {
  return Object.assign(
    {
      id,
      name: id,
      brand: "HP",
      price,
      vatPercent: 20,
      category: parent,
      siteParent: parent,
      active: true,
      image: "https://cdn.example/" + id + ".jpg",
    },
    extra || {}
  );
}

test("every storefront page header links to the cart", () => {
  const pages = fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".html") && !["admin.html", "404.html"].includes(name));
  for (const page of pages) {
    const html = read(page);
    if (!html.includes('class="nav-actions"')) continue;
    assert.match(html, /href="\/sepet" class="btn btn-outline cart-link"/, page);
    assert.match(html, /\/assets\/js\/cart\.js/, page);
  }
  const notFound = read("404.html");
  assert.match(notFound, /action="\/urunler"/);
  assert.match(notFound, /href="\/sepet"/);
});

test("home popular mix covers tabbed parents only and prefers orderable prices", () => {
  const products = [
    product("paper", "ofis-urunleri", 1200, { name: "A4 Fotokopi Kağıdı 5'li Koli" }),
    product("misc", "diger", 5000),
    product("cheap-cable", "bilgisayar-bilesenleri", 50),
    product("ssd", "bilgisayar-bilesenleri", 1500),
    product("notebook", "bilgisayar-tablet", 25000),
    product("toner", "kartus-toner", 900),
  ];
  const home = homeFeaturedCatalog(products, { limit: 4, minPriceInclVat: 750 });
  const ids = home.products.map((row) => row.id);
  assert.equal(ids.includes("misc"), false);
  assert.equal(ids.includes("cheap-cable"), false);
  assert.deepEqual(ids.slice().sort(), ["notebook", "paper", "ssd", "toner"]);
  assert.deepEqual(home.byParent["ofis-urunleri"].map((row) => row.id), ["paper"]);
});

test("brand counts and marka filter treat casing and dotted İ as the same brand", () => {
  const items = [
    product("a", "bilgisayar-tablet", 1000, { brand: "DELL" }),
    product("b", "bilgisayar-tablet", 1000, { brand: "Dell" }),
    product("c", "bilgisayar-bilesenleri", 1000, { brand: "TP-LINK" }),
  ];
  assert.deepEqual(
    buildBrandCounts(items).map((row) => [row.name, row.count]),
    [
      ["Dell", 2],
      ["TP-Link", 1],
    ]
  );
  assert.equal(queryPublicCatalog(items, { marka: "TP-Link", limit: 48 }).total, 1);
  assert.equal(queryPublicCatalog(items, { marka: "dell", limit: 48 }).total, 2);
});

test("listing cards show the shipping fee, not the free-shipping threshold", () => {
  const vm = require("node:vm");
  const window = {};
  const document = { createElement: () => ({ className: "", textContent: "" }) };
  vm.runInNewContext(read("assets/js/shipping.js"), { window, document });
  const settings = { enabled: true, shippingFee: 199, freeShippingThreshold: 1500 };
  const fmt = (n) => "₺" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  window.PatygoCatalog = { formatPrice: fmt };
  const info = window.PatygoShipping.productShippingInfo(899, settings);
  assert.equal(info.text, "Kargo: " + fmt(199));
  assert.equal(window.PatygoShipping.productShippingInfo(1500, settings).text, "Ücretsiz kargo");
  assert.match(info.thresholdHint, /ve üzeri ücretsiz kargo$/, "eşik notu ürün sayfasında kalır");

  const shipping = read("assets/js/shipping.js");
  assert.match(shipping, /function createProductShippingEl\(grossInclVat\) \{[\s\S]*?el\.textContent = info\.text;/);
  assert.doesNotMatch(read("assets/js/catalog.js"), /card: true/, "kart eşik metnine dönmez");
  assert.match(read("assets/js/urun-detay.js"), /shipInfo\.thresholdHint \? shipInfo\.thresholdHint \+ "\." : null/);
});

test("similar-products and cart-suggestion sliders reuse the category card, shipping line included", () => {
  const catalog = read("assets/js/catalog.js");
  assert.match(
    catalog,
    /else if \(window\.PatygoShipping && !window\.PatygoShipping\.settings[\s\S]*?window\.PatygoShipping\.load\(\)[\s\S]*?body\.querySelector\("\.product-shipping"\)[\s\S]*?body\.insertBefore\(late, actions\)/,
    "kargo ayarı kart çizildikten sonra gelirse satır sonradan eklenir"
  );
  for (const file of ["assets/js/urun-detay.js", "assets/js/sepet.js"]) {
    assert.match(read(file), /PatygoCatalog\.makeCard\(item, index, \{ compactListing: true \}\)/, file);
  }
});

test("category pages render skeleton cards and hold the generic heading until resolved", () => {
  const html = read("urunler.html");
  assert.match(html, /catalog-pending\.js/);
  assert.match(html, /product-card product-card--skeleton/);
  assert.match(read("assets/js/catalog-pending.js"), /catalog-heading-pending/);
  assert.match(read("assets/js/catalog.js"), /function settleCatalogHeading/);
});

test("product detail drops the duplicate category line and opens a lightbox", () => {
  const script = read("assets/js/urun-detay.js");
  assert.doesNotMatch(script, /detail-cat/);
  assert.match(script, /detail-lightbox/);
  assert.match(script, /showModal/);
  assert.match(script, /Görseli büyüt/);
});

test("brand tiles link to the brand listing only when products exist", () => {
  const script = read("assets/js/markalar.js");
  assert.match(script, /\/api\/brands/);
  assert.match(script, /\/urunler\?marka=/);
  assert.match(script, /row\.count > 0/);
});
