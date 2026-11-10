const test = require("node:test");
const assert = require("node:assert/strict");
const { applyBasamakGrossPrice, applyBasamakNetPrice, MAX_BASAMAK_UPLIFT_RATIO } = require("../lib/price-basamak");
const { priceInclVat } = require("../lib/product-fields");
const { priceInclVatAmount } = require("../lib/catalog");

test("basamak rounds gross TRY up to X99.99 in each 1000 band when uplift is small", () => {
  assert.equal(applyBasamakGrossPrice(56567.13, 9), 56999.99);
  assert.equal(applyBasamakGrossPrice(56567.13, 7), 56799.99);
  assert.equal(applyBasamakGrossPrice(56799.99, 7), 56799.99);
  assert.equal(applyBasamakGrossPrice(56800, 7), 57799.99);
  assert.equal(applyBasamakGrossPrice(90, 0), 99.99, "küçük uplift (%15 altı) uygulanır");
  assert.equal(applyBasamakGrossPrice(950, 9), 999.99);
  assert.equal(applyBasamakGrossPrice(56567.13, null), 56567.13);
  assert.equal(applyBasamakGrossPrice(56567.13, 12), 56567.13);
});

test("basamak does not jump a cheap product to the next …999,99 ladder", () => {
  assert.ok(MAX_BASAMAK_UPLIFT_RATIO > 0 && MAX_BASAMAK_UPLIFT_RATIO <= 0.2);
  // Logitech M90 class: ~340 ₺ KDV dahil must not become 999,99.
  assert.equal(applyBasamakGrossPrice(340.52, 9), 340.52);
  assert.equal(applyBasamakGrossPrice(263.71, 9), 263.71);
  assert.equal(applyBasamakGrossPrice(100, 0), 100, "100 ₺ → 1.099,99 would be a ladder jump");
  assert.equal(priceInclVat(283.77, 20, 9), 340.52);
  assert.equal(priceInclVatAmount({ price: 219.76, vatPercent: 20, basamak: 9 }), 263.71);
});

test("priceInclVat applies basamak on the KDV dahil shopper price", () => {
  // 47.000 net → 56.400 gross at %20; basamak lifts the displayed/charged amount.
  assert.equal(priceInclVat(47000, 20), 56400);
  assert.equal(priceInclVat(47000, 20, 9), 56999.99);
  assert.equal(priceInclVat(47000, 20, 7), 56799.99);
  assert.equal(priceInclVatAmount({ price: 47000, vatPercent: 20, basamak: 9 }), 56999.99);
  assert.equal(priceInclVatAmount({ price: 47000, vatPercent: 20 }), 56400);
  assert.equal(applyBasamakNetPrice(47000, 20, 9) > 47000, true);
  assert.equal(applyBasamakNetPrice(219.76, 20, 9), 219.76);
});
