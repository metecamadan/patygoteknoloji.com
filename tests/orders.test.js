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
