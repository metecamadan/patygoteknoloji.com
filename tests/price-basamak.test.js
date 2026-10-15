const test = require("node:test");
const assert = require("node:assert/strict");
const { applyBasamakGrossPrice, applyBasamakNetPrice } = require("../lib/price-basamak");
const { priceInclVat } = require("../lib/product-fields");
const { priceInclVatAmount } = require("../lib/catalog");

test("basamak rounds gross TRY up to X99.99 in each 1000 band", () => {
  assert.equal(applyBasamakGrossPrice(56567.13, 9), 56999.99);
  assert.equal(applyBasamakGrossPrice(56567.13, 7), 56799.99);
  assert.equal(applyBasamakGrossPrice(56799.99, 7), 56799.99);
  assert.equal(applyBasamakGrossPrice(56800, 7), 57799.99);
  assert.equal(applyBasamakGrossPrice(100, 0), 1099.99, "100 ₺ already past …099,99 → next bin");
  assert.equal(applyBasamakGrossPrice(50, 0), 99.99);
  assert.equal(applyBasamakGrossPrice(56567.13, null), 56567.13);
  assert.equal(applyBasamakGrossPrice(56567.13, 12), 56567.13);
});

test("priceInclVat applies basamak on the KDV dahil shopper price", () => {
  // 47.000 net → 56.400 gross at %20; basamak lifts the displayed/charged amount.
  assert.equal(priceInclVat(47000, 20), 56400);
  assert.equal(priceInclVat(47000, 20, 9), 56999.99);
  assert.equal(priceInclVat(47000, 20, 7), 56799.99);
  assert.equal(priceInclVatAmount({ price: 47000, vatPercent: 20, basamak: 9 }), 56999.99);
  assert.equal(priceInclVatAmount({ price: 47000, vatPercent: 20 }), 56400);
  assert.equal(applyBasamakNetPrice(47000, 20, 9) > 47000, true);
});
