const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");

test("order store saves and updates payment status", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-1",
    total: 100,
    paymentStatus: "pending",
    status: "payment_pending",
    customer: { name: "A", email: "a@example.com", phone: "0555" },
    items: [],
    createdAt: "2026-07-20T10:00:00.000Z",
  });
  assert.equal(store.get("PTY-1").paymentStatus, "pending");
  const updated = store.update("PTY-1", {
    paymentStatus: "paid",
    paymentTaken: true,
    status: "paid",
  });
  assert.equal(updated.paymentStatus, "paid");
  assert.equal(store.get("PTY-1").paymentTaken, true);
  assert.equal(store.get("PTY-1").legalHold, true);
  assert.equal(store.list({ limit: 10 }).length, 1);
});

test("order store persists shipping carrier and tracking code", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-ship-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-SHIP",
    total: 250,
    status: "preparing",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "B", email: "b@example.com" },
    items: [],
    createdAt: "2026-07-20T11:00:00.000Z",
  });
  const updated = store.update("PTY-SHIP", {
    status: "shipped",
    shippingCarrier: "Aras Kargo",
    trackingCode: "AR123456",
  });
  assert.equal(updated.status, "shipped");
  assert.equal(updated.shippingCarrier, "Aras Kargo");
  assert.equal(updated.trackingCode, "AR123456");
  const loaded = store.get("PTY-SHIP");
  assert.equal(loaded.shippingCarrier, "Aras Kargo");
  assert.equal(loaded.trackingCode, "AR123456");
});
