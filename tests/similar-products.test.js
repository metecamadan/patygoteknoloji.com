const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { similarProductsIndexed } = require("../lib/catalog");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

function indexOf(items) {
  const byParent = {};
  for (const item of items) (byParent[item.category] = byParent[item.category] || []).push(item);
  return { compactAll: items, byParent };
}

test("similar products prefer the same leaf category, then the closest price", () => {
  const items = [
    { id: "base", category: "pc", mid: "notebook", alt: "gaming", price: 1000 },
    { id: "leaf-far", category: "pc", mid: "notebook", alt: "gaming", price: 3000 },
    { id: "leaf-near", category: "pc", mid: "notebook", alt: "gaming", price: 1100 },
    { id: "mid-near", category: "pc", mid: "notebook", alt: "office", price: 1000 },
    { id: "parent", category: "pc", mid: "desktop", alt: "mini", price: 1000 },
    { id: "other", category: "phone", mid: "android", alt: "x", price: 1000 },
  ];
  const ids = similarProductsIndexed(indexOf(items), "base", 10).map((item) => item.id);
  assert.deepEqual(ids, ["leaf-near", "leaf-far", "mid-near", "parent"]);
  assert.deepEqual(similarProductsIndexed(indexOf(items), "base", 2).map((item) => item.id), ["leaf-near", "leaf-far"]);
  assert.deepEqual(similarProductsIndexed(indexOf(items), "missing", 5), []);
  assert.deepEqual(similarProductsIndexed(indexOf(items), "", 5), []);
});

test("GET /api/products/similar returns storefront products from the same category", async (t) => {
  const base = {
    brand: "TEST",
    vatPercent: 20,
    category: "bilgisayar-tablet",
    siteParent: "bilgisayar-tablet",
    siteMid: "tasinabilir-bilgisayarlar",
    siteChild: "notebooklar",
    active: true,
    image: "/assets/img/products/macbook-air-m3.svg",
    images: ["/assets/img/products/macbook-air-m3.svg"],
    stockQty: 5,
    currency: "TRY",
  };
  const { baseUrl } = await spawnTestServer(t, {}, {
    products: [
      Object.assign({}, base, { id: "sim-1", name: "Benzer A", price: 1000 }),
      Object.assign({}, base, { id: "sim-2", name: "Benzer B", price: 1050 }),
      Object.assign({}, base, { id: "sim-3", name: "Benzer C", price: 4000 }),
    ],
  });
  const res = await fetch(baseUrl + "/api/products/similar?id=sim-1&limit=4");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.products.map((item) => item.id), ["sim-2", "sim-3"]);
  assert.ok(body.products[0].urlPath, "similar items carry their product URL");
  const empty = await (await fetch(baseUrl + "/api/products/similar?id=yok")).json();
  assert.deepEqual(empty.products, []);
});

test("product detail renders similar products with the shared card", () => {
  const detail = read("assets/js/urun-detay.js");
  assert.match(detail, /\/api\/products\/similar\?id=/);
  assert.match(detail, /window\.PatygoCatalog\.makeCard\(item, index, \{ compactListing: true \}\)/);
  assert.match(read("assets/js/catalog.js"), /window\.PatygoCatalog\.makeCard = makeCard;/);
  const html = read("urun-detay.html");
  assert.match(html, /id="similarProducts"[^>]*hidden/);
  assert.match(html, /id="similarGrid"/);
});

test("similar products on detail and cart are a 10-item slider showing 5 at a time", () => {
  const detail = read("assets/js/urun-detay.js");
  const cart = read("assets/js/sepet.js");
  const catalog = read("assets/js/catalog.js");
  const css = read("assets/css/style.css");
  assert.match(detail, /const SIMILAR_SLIDER_SIZE = 10;/);
  assert.match(detail, /"&limit=" \+ SIMILAR_SLIDER_SIZE/);
  assert.match(detail, /window\.PatygoCatalog\.mountProductSlider\(grid\)/);
  assert.match(cart, /const SUGGESTION_SLIDER_SIZE = 10;/);
  assert.match(cart, /\.slice\(0, SUGGESTION_SLIDER_SIZE\)/);
  assert.match(cart, /SUGGESTION_SLIDER_SIZE \+ inCart\.size/);
  assert.match(cart, /window\.PatygoCatalog\.mountProductSlider\(grid\)/);
  assert.match(catalog, /window\.PatygoCatalog\.mountProductSlider = mountProductSlider;/);
  assert.match(catalog, /aria-label", label/);
  assert.match(catalog, /"Önceki ürünler"/);
  assert.match(catalog, /"Sonraki ürünler"/);
  assert.match(catalog, /left: dir \* track\.clientWidth/);
  assert.match(css, /\.product-slider \{\s*--slider-cols: 5;/);
  assert.match(css, /grid-auto-flow: column;/);
  assert.match(css, /scroll-snap-type: x mandatory;/);
  assert.match(css, /\.product-slider\.is-scrollable \.product-slider-btn \{ display: inline-flex; \}/);
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.product-slider \{ --slider-cols: 2\.2;/);
  assert.match(css, /\.product-slider-btn:disabled \{ visibility: hidden; \}/);
  assert.match(css, /\.product-slider-track > \.product-card \{[^}]*box-shadow: 0 4px 10px/);
});

test("similar endpoint allows enough items for a 10-card cart slider after removing cart lines", () => {
  const items = [{ id: "base", category: "pc", mid: "notebook", alt: "office", price: 100 }];
  for (let i = 0; i < 25; i += 1) items.push({ id: "s" + i, category: "pc", mid: "notebook", alt: "office", price: 100 + i });
  assert.equal(similarProductsIndexed(indexOf(items), "base", 20).length, 20);
  assert.equal(similarProductsIndexed(indexOf(items), "base", 50).length, 20);
});
