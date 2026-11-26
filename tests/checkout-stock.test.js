"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { availableCheckoutQty, findCheckoutStockShortage } = require("../lib/checkout-stock");

describe("checkout stock for supplier and manual", () => {
  it("limits supplier qty to sellable stock (critical threshold)", () => {
    const product = {
      id: "sup-1",
      source: "supplier",
      name: "Dymo Test",
      active: true,
      stockQty: 5,
      criticalStockQty: 3,
    };
    assert.equal(availableCheckoutQty(product), 5);
    assert.deepEqual(
      findCheckoutStockShortage([{ productId: "sup-1", qty: 73 }], { "sup-1": product }),
      { productId: "sup-1", name: "Dymo Test", requested: 73, available: 5 }
    );
    assert.equal(findCheckoutStockShortage([{ productId: "sup-1", qty: 5 }], { "sup-1": product }), null);
  });

  it("treats supplier stock at or below critical as zero sellable", () => {
    const product = {
      id: "sup-2",
      source: "supplier",
      name: "Low Stock",
      active: true,
      stockQty: 1,
      criticalStockQty: 3,
    };
    assert.equal(availableCheckoutQty(product), 0);
    assert.deepEqual(
      findCheckoutStockShortage([{ productId: "sup-2", qty: 1 }], { "sup-2": product }),
      { productId: "sup-2", name: "Low Stock", requested: 1, available: 0 }
    );
  });

  it("keeps untracked manuals unlimited here", () => {
    const product = { id: "m-1", source: "manual", name: "Manual", active: true };
    assert.equal(availableCheckoutQty(product), null);
    assert.equal(findCheckoutStockShortage([{ productId: "m-1", qty: 50 }], { "m-1": product }), null);
  });

  it("limits tracked manuals by stockQty", () => {
    const product = { id: "m-2", source: "manual", name: "Tracked", active: true, stockQty: 2 };
    assert.equal(availableCheckoutQty(product), 2);
    assert.deepEqual(
      findCheckoutStockShortage([{ productId: "m-2", qty: 3 }], { "m-2": product }),
      { productId: "m-2", name: "Tracked", requested: 3, available: 2 }
    );
  });
});
