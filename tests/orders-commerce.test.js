const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");

test("order store commerceSummary computes paid revenue and AOV for period", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-summary-"));
  const store = createOrderStore(root);
  try {
    store.save({
      id: "PTY-1",
      total: 1200,
      paymentTaken: true,
      paymentStatus: "paid",
      status: "paid",
      customer: { name: "A", email: "a1@example.com", phone: "1" },
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
      status: "paid",
      customer: { name: "B", email: "b1@example.com", phone: "2" },
      createdAt: "2026-07-19T10:00:00.000Z",
      items: [{ productId: "a", name: "Ürün A", brand: "X", qty: 1, line: 800 }],
    });
    store.save({
      id: "PTY-3",
      total: 500,
      paymentTaken: false,
      paymentStatus: "failed",
      status: "payment_failed",
      customer: { name: "C", email: "c1@example.com", phone: "3" },
      createdAt: "2026-07-19T12:00:00.000Z",
      items: [{ productId: "c", name: "Ürün C", qty: 5, line: 500 }],
    });
    store.save({
      id: "PTY-OLD",
      total: 9999,
      paymentTaken: true,
      paymentStatus: "paid",
      status: "paid",
      customer: { name: "D", email: "d1@example.com", phone: "4" },
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
    assert.equal(summary.ordersRefunded, 0);
    assert.equal(summary.refundedAmount, 0);
  } finally {
    resetDbForTests();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (_) {}
  }
});

test("commerceSummary nets partial refunds and keeps voided/refunded orders out of pending", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-refund-"));
  const store = createOrderStore(root);
  const reversal = (type, amount, items) => ({
    kind: "bank_reversal",
    type,
    amount,
    success: true,
    items,
    at: "2026-07-19T15:00:00.000Z",
  });
  try {
    store.save({
      id: "PTY-PART",
      total: 1200,
      paymentTaken: true,
      paymentStatus: "paid",
      status: "delivered",
      customer: { name: "A", email: "a2@example.com" },
      createdAt: "2026-07-18T10:00:00.000Z",
      items: [{ productId: "a", name: "Ürün A", qty: 2, line: 1000 }],
      paymentEvents: [reversal("refund", "600.00", [{ index: 0, qty: 1 }])],
    });
    store.save({
      id: "PTY-VOID",
      total: 300,
      paymentTaken: false,
      paymentStatus: "refunded",
      status: "cancelled",
      customer: { name: "B", email: "b2@example.com" },
      createdAt: "2026-07-19T10:00:00.000Z",
      items: [{ productId: "b", name: "Ürün B", qty: 1, line: 250 }],
      paymentEvents: [reversal("void", "300.00")],
    });
    const now = new Date("2026-07-20T12:00:00.000Z");
    const summary = store.commerceSummary(30, now);
    assert.equal(summary.ordersPaid, 1);
    assert.equal(summary.ordersPending, 0, "iptal/iade edilen sipariş bekleyen sayılmaz");
    assert.equal(summary.ordersRefunded, 1);
    assert.equal(summary.revenue, 600);
    assert.equal(summary.refundedAmount, 900);
    assert.equal(summary.aov, 600);
    assert.deepEqual(summary.topPurchasedProducts.map((p) => [p.productId, p.qty, p.revenue]), [["a", 1, 500]]);
    assert.deepEqual(store.soldQuantities(30, now), { a: 1 });
  } finally {
    resetDbForTests();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (_) {}
  }
});
