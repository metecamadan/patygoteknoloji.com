const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { referenceFromRows, createPriceHistory } = require("../lib/price-history");
const { getDb } = require("../lib/db");
const { toPublicProduct } = require("../lib/catalog");

const ROOT = path.join(__dirname, "..");
const DAY_MS = 86400000;

function day(offset, base = "2026-10-04") {
  return new Date(Date.parse(base + "T12:00:00Z") + offset * DAY_MS).toISOString().slice(0, 10);
}

function series(entries) {
  return entries.map(([offset, price]) => ({ day: day(offset), price }));
}

test("referenceFromRows: real drop uses lowest price of the 30 days before the drop", () => {
  const rows = series([
    [-20, 1100],
    [-15, 1050],
    [-10, 1080],
    [-2, 900],
    [-1, 900],
    [0, 900],
  ]);
  const ref = referenceFromRows(rows, day(0), 900);
  assert.deepEqual(ref, { compareAtPrice: 1050, since: day(-2) });
});

test("referenceFromRows: raise-then-drop back to the old price shows no discount", () => {
  const rows = series([
    [-25, 1000],
    [-5, 1200],
    [-4, 1200],
    [0, 1000],
  ]);
  assert.equal(referenceFromRows(rows, day(0), 1000), null);
});

test("referenceFromRows: discount older than 30 days is no longer advertised", () => {
  const rows = series([
    [-45, 1200],
    [-31, 900],
    [-10, 900],
    [0, 900],
  ]);
  assert.equal(referenceFromRows(rows, day(0), 900), null);
});

test("referenceFromRows: drops under 5% and missing history are ignored", () => {
  assert.equal(referenceFromRows(series([[-3, 1030], [0, 1000]]), day(0), 1000), null);
  assert.equal(referenceFromRows(series([[0, 1000]]), day(0), 1000), null);
  assert.equal(referenceFromRows([], day(0), 1000), null);
  assert.equal(referenceFromRows(series([[-3, 1200], [0, 1000]]), day(0), 0), null);
});

test("price history store: records daily minimum and serves compareAtPrice", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-price-"));
  let now = Date.parse(day(-3) + "T09:00:00Z");
  const store = createPriceHistory(getDb(root), { now: () => now });

  assert.equal(store.record([{ id: "p1", price: 1000 }, { id: "p2", price: 500 }]), 2);
  assert.equal(store.record([{ id: "p1", price: 1000 }, { id: "p2", price: 500 }]), 0);
  assert.equal(store.referenceFor("p1", 1000), 0);

  now = Date.parse(day(0) + "T09:00:00Z");
  store.record([{ id: "p1", price: 850 }, { id: "p2", price: 490 }]);
  assert.equal(store.referenceFor("p1", 850), 1000);
  assert.equal(store.referenceFor("p2", 490), 0, "2% drop stays without badge");

  store.record([{ id: "p1", price: 980 }]);
  assert.equal(store.referenceFor("p1", 850), 1000, "same-day raise keeps the daily minimum");
  assert.equal(store.referenceFor("p1", 990), 0, "reference must still be 5% above the selling price");
  assert.equal(store.referenceFor("unknown", 100), 0);
});

test("toPublicProduct exposes compareAtPrice only when a reference exists", () => {
  const product = { id: "x1", name: "Test Notebook", brand: "Lenovo", price: 900, vatPercent: 20 };
  const withRef = toPublicProduct(product, { compact: true, priceReference: (id) => (id === "x1" ? 1000 : 0) });
  assert.equal(withRef.compareAtPrice, 1000);
  const withoutRef = toPublicProduct(product, { compact: true, priceReference: () => 0 });
  assert.equal("compareAtPrice" in withoutRef, false);
  assert.equal("compareAtPrice" in toPublicProduct(product, {}), false);
});

test("storefront renders strikethrough price and discount badge from compareAtPrice", () => {
  const catalogJs = fs.readFileSync(path.join(ROOT, "assets/js/catalog.js"), "utf8");
  const detailJs = fs.readFileSync(path.join(ROOT, "assets/js/urun-detay.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "assets/css/style.css"), "utf8");
  assert.match(catalogJs, /discountInfo\(product\)/);
  assert.match(catalogJs, /percent >= 5/);
  assert.match(catalogJs, /price-before/);
  assert.match(catalogJs, /discount-badge/);
  assert.match(detailJs, /discountInfo\(product\)/);
  assert.match(detailJs, /Son 30 günün en düşük fiyatına göre/);
  assert.match(css, /\.discount-badge \{/);
  assert.match(css, /\.detail-price-before \{/);
});
