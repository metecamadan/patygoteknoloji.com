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
    });
    store.save({
      id: "PTY-2",
      total: 800,
      paymentTaken: true,
      paymentStatus: "paid",
      createdAt: "2026-07-19T10:00:00.000Z",
    });
    store.save({
      id: "PTY-3",
      total: 500,
      paymentTaken: false,
      paymentStatus: "failed",
      createdAt: "2026-07-19T12:00:00.000Z",
    });
    store.save({
      id: "PTY-OLD",
      total: 9999,
      paymentTaken: true,
      paymentStatus: "paid",
      createdAt: "2026-01-01T10:00:00.000Z",
    });

    const summary = store.commerceSummary(30, new Date("2026-07-20T12:00:00.000Z"));
    assert.equal(summary.ordersPaid, 2);
    assert.equal(summary.ordersFailed, 1);
    assert.equal(summary.revenue, 2000);
    assert.equal(summary.aov, 1000);
    assert.equal(summary.periodDays, 30);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
