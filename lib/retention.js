"use strict";

/**
 * Saklama / anonimleştirme — taslak politika.
 * Süreler docs/plan-commerce-db-kvkk.md önerilen tablodan alınır.
 * Avukat / mali müşavir onayı olmadan üretim “uyumlu” iddiası taşımaz.
 */
const fs = require("fs");
const path = require("path");
const { getDb } = require("./db");

/** @type {{ paidOrderYears: number, unpaidOrderYears: number, contactLeadYears: number }} */
const DRAFT_RETENTION = {
  paidOrderYears: 10,
  unpaidOrderYears: 2,
  contactLeadYears: 2,
};

const ANON_NAME = "Anonim";

function yearsToMs(years) {
  return Number(years) * 365.25 * 24 * 60 * 60 * 1000;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

/** true if `isoDate` is strictly older than `years` relative to `now`. */
function isOlderThanYears(isoDate, years, now) {
  const then = parseIsoMs(isoDate);
  if (then == null) return false;
  const ref = now instanceof Date ? now.getTime() : Date.parse(String(now)) || Date.now();
  return then < ref - yearsToMs(years);
}

function cutoffIso(years, now) {
  const ref = now instanceof Date ? now : new Date(now || Date.now());
  return new Date(ref.getTime() - yearsToMs(years)).toISOString();
}

function buildAnonCustomerJson(seed) {
  const token = String(seed || "x")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 24)
    .toLowerCase() || "x";
  return {
    name: ANON_NAME,
    fullName: ANON_NAME,
    email: "anon-" + token + "@invalid.local",
    phone: "",
    company: "",
    taxId: "",
    billingAddress: "",
    shippingAddress: "",
    note: "",
  };
}

function isPaidOrderRow(row) {
  return Boolean(row.payment_taken) || row.payment_status === "paid" || row.status === "paid";
}

function anonymizeCustomerRow(db, customerId, nowIso) {
  const id = String(customerId || "").trim();
  if (!id) return false;
  const anon = buildAnonCustomerJson(id);
  db.prepare(
    `UPDATE customers SET full_name=?, company=?, email=?, phone=?, tax_id=?,
      billing_address=?, shipping_address=?, updated_at=? WHERE id=?`
  ).run(
    anon.name,
    "",
    anon.email,
    "",
    "",
    "",
    "",
    nowIso,
    id
  );
  return true;
}

/**
 * Clears PII on the order (+ linked customers row). Keeps amounts, items, legal_hold.
 * Does not hard-delete. Safe with legal_hold.
 */
function anonymizeOrder(rootOrDb, orderId, options) {
  const opts = options || {};
  const db = rootOrDb && typeof rootOrDb.prepare === "function" ? rootOrDb : getDb(rootOrDb);
  const id = String(orderId || "").trim();
  if (!id) return { ok: false, error: "Sipariş kimliği gerekli." };

  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return { ok: false, error: "Sipariş bulunamadı." };
  if (row.anonymized_at) {
    return { ok: true, already: true, anonymizedAt: row.anonymized_at, orderId: id };
  }

  const now = opts.nowIso || new Date().toISOString();
  const anon = buildAnonCustomerJson(id);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE orders SET customer_json=?, anonymized_at=?, updated_at=? WHERE id=?`
    ).run(JSON.stringify(anon), now, now, id);
    if (row.customer_id) anonymizeCustomerRow(db, row.customer_id, now);
  });
  tx();

  return { ok: true, already: false, anonymizedAt: now, orderId: id, legalHold: Boolean(row.legal_hold) };
}

/** Alias used by DSAR naming. */
function anonymizeCustomer(rootOrDb, customerId, options) {
  const opts = options || {};
  const db = rootOrDb && typeof rootOrDb.prepare === "function" ? rootOrDb : getDb(rootOrDb);
  const id = String(customerId || "").trim();
  if (!id) return { ok: false, error: "Müşteri kimliği gerekli." };
  const row = db.prepare("SELECT id FROM customers WHERE id = ?").get(id);
  if (!row) return { ok: false, error: "Müşteri bulunamadı." };
  const now = opts.nowIso || new Date().toISOString();
  anonymizeCustomerRow(db, id, now);
  const orders = db.prepare("SELECT id FROM orders WHERE customer_id = ? AND anonymized_at IS NULL").all(id);
  for (const order of orders) {
    anonymizeOrder(db, order.id, { nowIso: now });
  }
  return { ok: true, customerId: id, ordersAnonymized: orders.length, anonymizedAt: now };
}

/**
 * Hard-delete order. Refuses when legal_hold is set (VUK/TTK financial record).
 */
function deleteOrderHard(rootOrDb, orderId) {
  const db = rootOrDb && typeof rootOrDb.prepare === "function" ? rootOrDb : getDb(rootOrDb);
  const id = String(orderId || "").trim();
  if (!id) return { ok: false, error: "Sipariş kimliği gerekli." };
  const row = db.prepare("SELECT id, legal_hold FROM orders WHERE id = ?").get(id);
  if (!row) return { ok: false, error: "Sipariş bulunamadı." };
  if (row.legal_hold) {
    return { ok: false, error: "legal_hold", message: "Yasal saklama (legal_hold) olan sipariş silinemez." };
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id);
    try {
      db.prepare("DELETE FROM order_status_mails WHERE order_id = ?").run(id);
    } catch (_) {}
    try {
      db.prepare("DELETE FROM order_integrations WHERE order_id = ?").run(id);
    } catch (_) {}
    db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  });
  tx();
  return { ok: true, deleted: true, orderId: id };
}

function lastRunPath(root) {
  return path.join(root, ".runtime", "retention-last-run.json");
}

function readLastRun(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastRunPath(root), "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch (_) {
    return null;
  }
}

function writeLastRun(root, payload) {
  const file = lastRunPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function istanbulHour(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const hour = parts.find((p) => p.type === "hour");
  return Number(hour && hour.value) || 0;
}

function istanbulDayKey(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

/**
 * Nightly retention pass (taslak süreler). Does not touch supplier XML.
 */
function runRetentionJob(root, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const nowIso = now.toISOString();
  const db = getDb(root);
  const contactStore = opts.contactStore;
  const durations = Object.assign({}, DRAFT_RETENTION, opts.durations || {});

  const summary = {
    policy: "draft",
    ranAt: nowIso,
    paidAnonymized: 0,
    unpaidAnonymized: 0,
    unpaidDeleted: 0,
    unpaidSkippedLegalHold: 0,
    leadsDeleted: 0,
    skippedAlreadyAnon: 0,
  };

  const paidCutoff = cutoffIso(durations.paidOrderYears, now);
  const unpaidCutoff = cutoffIso(durations.unpaidOrderYears, now);

  const paidDue = db
    .prepare(
      `SELECT id FROM orders
       WHERE anonymized_at IS NULL
         AND (payment_taken = 1 OR payment_status = 'paid' OR status = 'paid')
         AND COALESCE(paid_at, created_at) < ?
       LIMIT 500`
    )
    .all(paidCutoff);

  for (const row of paidDue) {
    const result = anonymizeOrder(db, row.id, { nowIso });
    if (result.already) summary.skippedAlreadyAnon += 1;
    else if (result.ok) summary.paidAnonymized += 1;
  }

  const unpaidDue = db
    .prepare(
      `SELECT id, legal_hold FROM orders
       WHERE anonymized_at IS NULL
         AND NOT (payment_taken = 1 OR payment_status = 'paid' OR status = 'paid')
         AND created_at < ?
       LIMIT 500`
    )
    .all(unpaidCutoff);

  for (const row of unpaidDue) {
    if (row.legal_hold) {
      // Soft path only: never hard-delete under legal_hold.
      const result = anonymizeOrder(db, row.id, { nowIso });
      if (result.ok && !result.already) summary.unpaidAnonymized += 1;
      summary.unpaidSkippedLegalHold += 1;
      continue;
    }
    if (opts.deleteUnpaid === false) {
      const result = anonymizeOrder(db, row.id, { nowIso });
      if (result.ok && !result.already) summary.unpaidAnonymized += 1;
    } else {
      const result = deleteOrderHard(db, row.id);
      if (result.ok) summary.unpaidDeleted += 1;
    }
  }

  if (contactStore && typeof contactStore.readAll === "function" && typeof contactStore.writeAll === "function") {
    const leadCutoffMs = now.getTime() - yearsToMs(durations.contactLeadYears);
    const all = contactStore.readAll();
    const kept = all.filter((lead) => {
      const ms = parseIsoMs(lead && lead.createdAt);
      if (ms == null) return true;
      return ms >= leadCutoffMs;
    });
    summary.leadsDeleted = all.length - kept.length;
    if (summary.leadsDeleted > 0) contactStore.writeAll(kept);
  }

  if (opts.persistLastRun !== false) {
    writeLastRun(root, {
      dayKey: istanbulDayKey(now),
      ranAt: nowIso,
      summary,
    });
  }

  return summary;
}

/**
 * Returns true when a nightly run should execute (Istanbul 02:00–04:59, once per day).
 */
function shouldRunRetentionTonight(root, now) {
  const ref = now instanceof Date ? now : new Date(now || Date.now());
  const hour = istanbulHour(ref);
  if (hour < 2 || hour > 4) return false;
  const dayKey = istanbulDayKey(ref);
  const last = readLastRun(root);
  if (last && last.dayKey === dayKey) return false;
  return true;
}

function createRetentionScheduler(root, options) {
  const opts = options || {};
  const intervalMs = Math.max(60 * 1000, Number(opts.intervalMs) || 60 * 60 * 1000);
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    const now = new Date();
    if (!shouldRunRetentionTonight(root, now) && !opts.force) return;
    running = true;
    try {
      const summary = runRetentionJob(root, {
        contactStore: opts.contactStore,
        now,
      });
      if (typeof opts.onComplete === "function") opts.onComplete(summary);
      else if (summary.paidAnonymized || summary.unpaidDeleted || summary.leadsDeleted) {
        console.log(
          "[retention] taslak gece işi:",
          "paidAnon=" + summary.paidAnonymized,
          "unpaidDel=" + summary.unpaidDeleted,
          "leadsDel=" + summary.leadsDeleted
        );
      }
    } catch (err) {
      console.error("[retention] gece işi hata:", (err && err.message) || err);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch(() => {});
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, runNow: () => runRetentionJob(root, opts) };
}

module.exports = {
  DRAFT_RETENTION,
  ANON_NAME,
  isOlderThanYears,
  cutoffIso,
  buildAnonCustomerJson,
  anonymizeOrder,
  anonymizeCustomer,
  deleteOrderHard,
  runRetentionJob,
  shouldRunRetentionTonight,
  readLastRun,
  writeLastRun,
  createRetentionScheduler,
  istanbulHour,
  istanbulDayKey,
  isPaidOrderRow,
};
