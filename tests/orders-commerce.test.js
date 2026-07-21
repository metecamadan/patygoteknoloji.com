const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOrderStore } = require("../lib/orders");

test("order store commerceSummary computes paid revenue and AOV for period", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-summary-"));
  const store = createOrderStore(root);
  try {
    store.save({
      id: "PTY-1",
      total: 1200,
      paymentTaken: true,
      paymentStatus: "paid",
      createdAt: "2026-07-18T10:00:00.000Z",
      items: [
        { productId: "a", name: "Ürün A", brand: "X", qty: 2, line: 800 },
        { productId: "b", name: "Ürün B", brand: "Y", qty: 1, line: 400 },
      ],
    });
    store.save({
      id: "PTY-2",
      total: 800,
      paymentTaken: true,
      paymentStatus: "paid",
      createdAt: "2026-07-19T10:00:00.000Z",
      items: [{ productId: "a", name: "Ürün A", brand: "X", qty: 1, line: 800 }],
    });
    store.save({
      id: "PTY-3",
      total: 500,
      paymentTaken: false,
      paymentStatus: "failed",
      createdAt: "2026-07-19T12:00:00.000Z",
      items: [{ productId: "c", name: "Ürün C", qty: 5, line: 500 }],
    });
    store.save({
      id: "PTY-OLD",
      total: 9999,
      paymentTaken: true,
      paymentStatus: "paid",
      createdAt: "2026-01-01T10:00:00.000Z",
      items: [{ productId: "a", name: "Ürün A", qty: 99, line: 9999 }],
    });

    const summary = store.commerceSummary(30, new Date("2026-07-20T12:00:00.000Z"));
    assert.equal(summary.ordersPaid, 2);
    assert.equal(summary.ordersFailed, 1);
    assert.equal(summary.revenue, 2000);
    assert.equal(summary.aov, 1000);
    assert.equal(summary.periodDays, 30);
    assert.equal(summary.topPurchasedProducts[0].productId, "a");
    assert.equal(summary.topPurchasedProducts[0].qty, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
