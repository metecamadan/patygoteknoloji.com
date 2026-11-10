const test = require("node:test");
const assert = require("node:assert/strict");
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
