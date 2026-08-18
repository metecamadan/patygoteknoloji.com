const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { queryPublicCatalog } = require("../lib/catalog");

const root = path.resolve(__dirname, "..");

function product(id, brand, price, extra) {
  return Object.assign(
    {
      id,
      name: id,
      brand,
      price,
      vatPercent: 20,
      category: "bilgisayar-tablet",
      active: true,
    },
    extra || {}
  );
}

test("queryPublicCatalog facets list brands and price range for the current category", () => {
  const products = [
    product("hp-1", "HP", 1000),
    product("hp-2", "HP", 2000),
    product("lenovo-1", "Lenovo", 8000),
    product("toner-1", "Canon", 200, { category: "kartus-toner" }),
  ];
  const notebooks = queryPublicCatalog(products, { kategori: "bilgisayar-tablet", limit: 48 });
  assert.deepEqual(
    notebooks.facets.brands.map((row) => [row.name, row.count]),
    [
      ["HP", 2],
      ["Lenovo", 1],
    ]
  );
  assert.equal(notebooks.facets.price.min, 1200);
  assert.equal(notebooks.facets.price.max, 9600);
  assert.ok(notebooks.facets.pricePresets.some((row) => row.label === "1.000 – 5.000 ₺"));
  assert.equal(
    notebooks.facets.pricePresets.some((row) => row.min === 15000),
    false
  );
});

test("queryPublicCatalog filters by brand and VAT-inclusive price range", () => {
  const products = [
    product("hp-low", "HP", 1000),
    product("hp-high", "HP", 9000),
    product("lenovo", "Lenovo", 2000),
  ];
  const byBrand = queryPublicCatalog(products, { marka: "hp,lenovo", limit: 48 });
  assert.equal(byBrand.total, 3);
  const hpOnly = queryPublicCatalog(products, { marka: "HP", minFiyat: 1500, maxFiyat: 2000, limit: 48 });
  assert.equal(hpOnly.total, 0);
  const mid = queryPublicCatalog(products, { marka: "HP", minFiyat: 1000, maxFiyat: 1300, limit: 48 });
  assert.deepEqual(
    mid.products.map((row) => row.id),
    ["hp-low"]
  );
  assert.equal(mid.facets.brands.length, 2);
});

test("storefront catalog renders brand and price facets", () => {
  const html = fs.readFileSync(path.join(root, "urunler.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
  assert.match(html, /data-catalog-facets/);
  assert.match(html, /data-catalog-meta/);
  assert.match(script, /function renderFacets/);
  assert.match(script, /minFiyat/);
  assert.match(script, /maxFiyat/);
  assert.match(script, /marka/);
  assert.match(script, /Filtreleri temizle/);
  assert.match(script, /btn btn-primary catalog-price-apply/);
  assert.match(script, /btn btn-outline btn-block catalog-facets-toggle/);
  assert.match(script, /prettyBrandName/);
});
