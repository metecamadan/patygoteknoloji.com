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

test("order store claims each status mail only once", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-mail-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-CLAIM",
    total: 10,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "C", email: "c@example.com" },
    items: [],
    createdAt: "2026-07-20T12:00:00.000Z",
  });
  assert.equal(store.claimStatusMail("PTY-CLAIM", "paid"), true);
  assert.equal(store.claimStatusMail("PTY-CLAIM", "paid"), false);
  assert.equal(store.hasStatusMail("PTY-CLAIM", "paid"), true);
  store.releaseStatusMail("PTY-CLAIM", "paid");
  assert.equal(store.claimStatusMail("PTY-CLAIM", "paid"), true);
  resetDbForTests();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});

test("order store search matches id, email, and normalized phone", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-orders-search-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-FIND-ME",
    total: 80,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Zeynep", email: "zeynep@example.com", phone: "(0533) 444-55-66" },
    items: [],
    createdAt: "2025-12-01T09:00:00.000Z",
  });
  store.save({
    id: "PTY-OTHER",
    total: 90,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Ali", email: "ali@example.com", phone: "0212 000 00 00" },
    items: [],
    createdAt: "2026-08-18T09:00:00.000Z",
  });

  assert.deepEqual(
    store.list({ q: "FIND-ME", from: "2026-08-18", to: "2026-08-18" }).map((order) => order.id),
    ["PTY-FIND-ME"]
  );
  assert.deepEqual(
    store.list({ q: "zeynep@example.com" }).map((order) => order.id),
    ["PTY-FIND-ME"]
  );
  assert.deepEqual(
    store.list({ q: "0533 444 55 66" }).map((order) => order.id),
    ["PTY-FIND-ME"]
  );
  assert.deepEqual(
    store.list({ q: "%", from: "2026-08-18", to: "2026-08-18" }).map((order) => order.id),
    ["PTY-OTHER"]
  );
  resetDbForTests();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});
