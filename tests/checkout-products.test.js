const test = require("node:test");
const assert = require("node:assert/strict");
const { lookupCheckoutProductsByIds } = require("../lib/checkout-products");

test("lookupCheckoutProductsByIds maps only requested ids", () => {
  const byId = lookupCheckoutProductsByIds(["a", "b", "a"], {
    loadManual: () => [
      { id: "a", brand: "A", name: "Manual A", price: 10, active: true, vatPercent: 20 },
      { id: "b", brand: "B", name: "Manual B", price: 20, active: true, vatPercent: 20 },
    ],
    getSupplierById: () => null,
    mergeOptions: {
      includeInactiveManual: false,
      normalizeProduct: (p) => p,
    },
  });
  assert.equal(Object.keys(byId).length, 2);
  assert.equal(byId.a.name, "Manual A");
  assert.equal(byId.b.price, 20);
});
