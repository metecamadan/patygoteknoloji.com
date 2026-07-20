const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOrderStore } = require("../lib/orders");

test("order store saves and updates payment status", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-1",
    total: 100,
    paymentStatus: "pending",
    createdAt: "2026-07-20T10:00:00.000Z",
  });
  assert.equal(store.get("PTY-1").paymentStatus, "pending");
  const updated = store.update("PTY-1", { paymentStatus: "paid", paymentTaken: true });
  assert.equal(updated.paymentStatus, "paid");
  assert.equal(store.get("PTY-1").paymentTaken, true);
});
