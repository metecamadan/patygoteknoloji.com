const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { queryPublicCatalog, buildStorefrontIndex, queryPublicCatalogIndexed } = require("../lib/catalog");

const sample = [
  {
    id: "p1",
    brand: "HP",
    name: "Notebook A",
    price: 1000,
    vatPercent: 20,
    category: "bilgisayar-tablet",
    siteMid: "notebooklar",
    siteChild: "nb-a",
    active: true,
  },
  {
    id: "p2",
    brand: "Lenovo",
    name: "Notebook B",
    price: 2000,
    vatPercent: 20,
    category: "bilgisayar-tablet",
    siteMid: "notebooklar",
    siteChild: "nb-b",
    active: true,
  },
  {
    id: "p3",
    brand: "Canon",
    name: "Toner",
    price: 500,
    vatPercent: 20,
    category: "kartus-toner",
    siteMid: "toner",
    siteChild: "toner-a",
    active: true,
  },
];

test("indexed catalog query matches full scan for category listing", () => {
  const index = buildStorefrontIndex(sample);
  assert.equal(index.compactAll.length, 3);
  assert.equal(index.byParent["bilgisayar-tablet"].length, 2);

  const cases = [
    { page: 1, limit: 48 },
    { kategori: "bilgisayar-tablet", page: 1, limit: 20 },
    { kategori: "bilgisayar-tablet", ara: "notebooklar", page: 1, limit: 20 },
    { marka: "HP", page: 1, limit: 48 },
  ];
  cases.forEach((params) => {
    const full = queryPublicCatalog(sample, params);
    const indexed = queryPublicCatalogIndexed(index, params);
    assert.equal(indexed.total, full.total, JSON.stringify(params));
    assert.deepEqual(
      indexed.products.map((item) => item.id),
      full.products.map((item) => item.id)
    );
  });
});

test("buildStorefrontIndex stores compact list with limited images", () => {
  const index = buildStorefrontIndex(sample);
  assert.ok(index.compactAll.every((item) => Array.isArray(item.images) && item.images.length <= 2));
});

test("server injects catalog bootstrap for urunler HTML", () => {
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /sendCatalogHtml/);
  assert.match(serverJs, /patygo-catalog-bootstrap/);
  assert.match(serverJs, /queryPublicCatalogIndexed/);
});
