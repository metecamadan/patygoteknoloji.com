"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOrderStore } = require("../lib/orders");
const { createContactStore } = require("../lib/contact");
const { resetDbForTests } = require("../lib/db");
const {
  DRAFT_RETENTION,
  isOlderThanYears,
  anonymizeOrder,
  deleteOrderHard,
  runRetentionJob,
  shouldRunRetentionTonight,
  writeLastRun,
  istanbulDayKey,
} = require("../lib/retention");

test("draft retention durations match plan (10y paid / 2y unpaid / 2y leads)", () => {
  assert.equal(DRAFT_RETENTION.paidOrderYears, 10);
  assert.equal(DRAFT_RETENTION.unpaidOrderYears, 2);
  assert.equal(DRAFT_RETENTION.contactLeadYears, 2);
});

test("isOlderThanYears age cutoffs", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");
  assert.equal(isOlderThanYears("2015-01-01T00:00:00.000Z", 10, now), true);
  assert.equal(isOlderThanYears("2020-01-01T00:00:00.000Z", 10, now), false);
  assert.equal(isOlderThanYears("2023-01-01T00:00:00.000Z", 2, now), true);
  assert.equal(isOlderThanYears("2025-09-01T00:00:00.000Z", 2, now), false);
});

test("anonymizeOrder clears PII but keeps amounts and items", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-anon-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-ANON-1",
    total: 999.5,
    subtotal: 800,
    vat: 160,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: {
      name: "Ayşe Yılmaz",
      email: "ayse@example.com",
      phone: "0532 111 22 33",
      company: "Acme",
      taxId: "1234567890",
      billingAddress: "Kadıköy",
      shippingAddress: "Beşiktaş",
    },
    items: [{ productId: "p1", name: "Laptop", qty: 1, line: 800, lineVat: 160 }],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const result = anonymizeOrder(root, "PTY-ANON-1");
  assert.equal(result.ok, true);
  assert.equal(result.already, false);

  const order = store.get("PTY-ANON-1");
  assert.ok(order.anonymizedAt);
  assert.equal(order.legalHold, true);
  assert.equal(order.total, 999.5);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].name, "Laptop");
  assert.match(String(order.customer.name || ""), /Anonim/i);
  assert.doesNotMatch(String(order.customer.email || ""), /ayse@example\.com/i);
  assert.equal(String(order.customer.phone || ""), "");
  assert.equal(String(order.customer.billingAddress || ""), "");

  const again = anonymizeOrder(root, "PTY-ANON-1");
  assert.equal(again.ok, true);
  assert.equal(again.already, true);

  resetDbForTests();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});

test("legal_hold prevents hard delete", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-hold-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-HOLD-1",
    total: 100,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Ali Veli", email: "ali@example.com", phone: "0555" },
    items: [{ productId: "p1", name: "Mouse", qty: 1, line: 100, lineVat: 0 }],
    createdAt: "2010-01-01T00:00:00.000Z",
  });
  const order = store.get("PTY-HOLD-1");
  assert.equal(order.legalHold, true);

  const deleted = deleteOrderHard(root, "PTY-HOLD-1");
  assert.equal(deleted.ok, false);
  assert.equal(deleted.error, "legal_hold");
  assert.ok(store.get("PTY-HOLD-1"));

  resetDbForTests();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});

test("retention job anonymizes old paid and deletes old unpaid; skips legal_hold delete", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-ret-"));
  const store = createOrderStore(root);
  const contactStore = createContactStore(root);
  const now = new Date("2026-09-05T12:00:00.000Z");

  store.save({
    id: "PTY-OLD-PAID",
    total: 500,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    paidAt: "2010-01-01T00:00:00.000Z",
    customer: { name: "Eski Ödeme", email: "oldpaid@example.com", phone: "0555" },
    items: [{ productId: "p1", name: "Eski", qty: 1, line: 500, lineVat: 0 }],
    createdAt: "2010-01-01T00:00:00.000Z",
  });
  store.save({
    id: "PTY-OLD-FAIL",
    total: 200,
    status: "payment_failed",
    paymentStatus: "failed",
    paymentTaken: false,
    customer: { name: "Eski Fail", email: "oldfail@example.com", phone: "0555" },
    items: [{ productId: "p2", name: "Fail", qty: 1, line: 200, lineVat: 0 }],
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  store.save({
    id: "PTY-NEW-PAID",
    total: 300,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    paidAt: "2025-01-01T00:00:00.000Z",
    customer: { name: "Yeni", email: "new@example.com", phone: "0555" },
    items: [{ productId: "p3", name: "Yeni", qty: 1, line: 300, lineVat: 0 }],
    createdAt: "2025-01-01T00:00:00.000Z",
  });

  contactStore.append({
    id: "LEAD-OLD",
    createdAt: "2020-01-01T00:00:00.000Z",
    firma: "Eski Firma",
    email: "lead@example.com",
    tel: "0555",
  });
  contactStore.append({
    id: "LEAD-NEW",
    createdAt: "2026-01-01T00:00:00.000Z",
    firma: "Yeni Firma",
    email: "newlead@example.com",
    tel: "0555",
  });

  const summary = runRetentionJob(root, {
    contactStore,
    now,
    persistLastRun: false,
  });

  assert.equal(summary.paidAnonymized, 1);
  assert.equal(summary.unpaidDeleted, 1);
  assert.equal(summary.leadsDeleted, 1);

  const oldPaid = store.get("PTY-OLD-PAID");
  assert.ok(oldPaid);
  assert.ok(oldPaid.anonymizedAt);
  assert.equal(oldPaid.total, 500);
  assert.doesNotMatch(String(oldPaid.customer.email || ""), /oldpaid@example\.com/);

  assert.equal(store.get("PTY-OLD-FAIL"), null);
  assert.ok(store.get("PTY-NEW-PAID"));
  assert.equal(store.get("PTY-NEW-PAID").anonymizedAt, null);

  const leads = contactStore.readAll();
  assert.equal(leads.length, 1);
  assert.equal(leads[0].id, "LEAD-NEW");

  // legal_hold unpaid edge: force hold then ensure delete refused / anonymize path
  store.save({
    id: "PTY-HOLD-UNPAID",
    total: 50,
    status: "payment_pending",
    paymentStatus: "pending",
    paymentTaken: false,
    legalHold: true,
    customer: { name: "Hold", email: "hold@example.com", phone: "0555" },
    items: [],
    createdAt: "2018-01-01T00:00:00.000Z",
  });
  // save() clears legalHold for unpaid unless we set via SQL — paid path sets hold.
  // Verify deleteOrderHard still blocks when legal_hold bit is set:
  const { getDb } = require("../lib/db");
  getDb(root).prepare("UPDATE orders SET legal_hold = 1 WHERE id = ?").run("PTY-HOLD-UNPAID");
  const blocked = deleteOrderHard(root, "PTY-HOLD-UNPAID");
  assert.equal(blocked.error, "legal_hold");

  const summary2 = runRetentionJob(root, {
    contactStore,
    now,
    persistLastRun: false,
  });
  assert.ok(summary2.unpaidSkippedLegalHold >= 1);
  assert.ok(store.get("PTY-HOLD-UNPAID"));
  assert.ok(store.get("PTY-HOLD-UNPAID").anonymizedAt);

  resetDbForTests();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});

test("shouldRunRetentionTonight respects day guard", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-night-"));
  // Construct a Date that is 03:00 in Istanbul on a known day.
  // Europe/Istanbul is UTC+3 → 00:00Z == 03:00 TR.
  const night = new Date("2026-09-05T00:30:00.000Z");
  assert.equal(shouldRunRetentionTonight(root, night), true);
  writeLastRun(root, { dayKey: istanbulDayKey(night), ranAt: night.toISOString() });
  assert.equal(shouldRunRetentionTonight(root, night), false);
  const day = new Date("2026-09-05T10:00:00.000Z"); // 13:00 TR
  assert.equal(shouldRunRetentionTonight(root, day), false);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});
