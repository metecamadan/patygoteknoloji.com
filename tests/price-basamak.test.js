const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  applyBasamakGrossPrice,
  applyBasamakNetPrice,
  basamakBandForPrice,
  basamakTargetInBand,
} = require("../lib/price-basamak");
const { priceInclVat } = require("../lib/product-fields");
const { priceInclVatAmount } = require("../lib/catalog");

test("basamak band and target follow the magnitude table", () => {
  assert.equal(basamakBandForPrice(8.13), 1);
  assert.equal(basamakBandForPrice(12.34), 1);
  assert.equal(basamakBandForPrice(99.5), 1);
  assert.equal(basamakBandForPrice(131.23), 10);
  assert.equal(basamakBandForPrice(950), 10);
  assert.equal(basamakBandForPrice(1234), 100);
  assert.equal(basamakBandForPrice(56567.13), 1000);
  assert.equal(basamakTargetInBand(9, 1), 0.99);
  assert.equal(basamakTargetInBand(7, 1), 0.79);
  assert.equal(basamakTargetInBand(4, 10), 4.99);
  assert.equal(basamakTargetInBand(6, 100), 69.99);
  assert.equal(basamakTargetInBand(9, 1000), 999.99);
});

test("basamak rounds by the shopper price table (user examples)", () => {
  assert.equal(applyBasamakGrossPrice(8.13, 9), 8.99);
  assert.equal(applyBasamakGrossPrice(12.34, 7), 12.79);
  assert.equal(applyBasamakGrossPrice(131.23, 4), 134.99);
  assert.equal(applyBasamakGrossPrice(1234, 6), 1269.99);
  assert.equal(applyBasamakGrossPrice(56567.13, 9), 56999.99);
  assert.equal(applyBasamakGrossPrice(56567.13, 7), 56799.99);
  assert.equal(applyBasamakGrossPrice(56799.99, 7), 56799.99);
  assert.equal(applyBasamakGrossPrice(56800, 7), 57799.99);
  assert.equal(applyBasamakGrossPrice(340.52, 9), 349.99, "ucuz ürün 999 değil 349,99");
  assert.equal(applyBasamakGrossPrice(263.71, 9), 269.99);
  assert.equal(applyBasamakGrossPrice(56567.13, null), 56567.13);
  assert.equal(applyBasamakGrossPrice(56567.13, 12), 56567.13);
});

test("priceInclVat applies magnitude basamak on the KDV dahil shopper price", () => {
  assert.equal(priceInclVat(47000, 20), 56400);
  assert.equal(priceInclVat(47000, 20, 9), 56999.99);
  assert.equal(priceInclVat(47000, 20, 7), 56799.99);
  assert.equal(priceInclVatAmount({ price: 47000, vatPercent: 20, basamak: 9 }), 56999.99);
  assert.equal(priceInclVatAmount({ price: 47000, vatPercent: 20 }), 56400);
  assert.equal(applyBasamakNetPrice(47000, 20, 9) > 47000, true);
  // 219.76 net × 1.20 = 263.71 → basamak 9 → 269.99 → net back-calculated
  assert.equal(priceInclVatAmount({ price: 219.76, vatPercent: 20, basamak: 9 }), 269.99);
  assert.equal(applyBasamakNetPrice(219.76, 20, 9), 224.99);
});

test("storefront catalog.js priceInclVat matches server magnitude basamak", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "catalog.js"), "utf8");
  assert.doesNotMatch(src, /const mod = 100000/, "eski sabit 1000₺ dilimi kalmamalı");
  assert.match(src, /lib\/price-basamak\.js/);
  const start = src.indexOf("priceInclVat(productOrPrice, vatPercent) {");
  const end = src.indexOf("/** Server sends compareAtPrice", start);
  assert.ok(start > 0 && end > start, "priceInclVat gövdesi catalog.js içinde bulunmalı");
  const method = src.slice(start, end).replace(/,\s*$/, "");
  const sandbox = {};
  vm.createContext(sandbox);
  const client = vm.runInContext(
    "(" +
      "function(){ return { ALLOWED_VAT:[1,8,10,20]," +
      "normalizeVatPercent(value){ const n=Number(value); return this.ALLOWED_VAT.includes(n)?n:20; }," +
      method +
      " }; })()",
    sandbox
  );
  const cases = [
    [8.13, 9, 8.99],
    [131.23, 4, 134.99],
    [340.52, 9, 349.99],
    [1234, 6, 1269.99],
    [56567.13, 9, 56999.99],
  ];
  for (const [gross, digit, expected] of cases) {
    const net = Math.round((gross / 1.2) * 100) / 100;
    const got = client.priceInclVat({ price: net, vatPercent: 20, basamak: digit });
    assert.equal(got, expected, "client " + gross + " basamak " + digit);
    assert.equal(applyBasamakGrossPrice(Math.round(net * 1.2 * 100) / 100, digit), expected);
  }
});
