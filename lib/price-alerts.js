"use strict";

const crypto = require("crypto");

const MIN_DROP_RATIO = 0.02;
const MAX_ACTIVE_PER_EMAIL = 20;
const PENDING_TTL_MS = 7 * 86400000;
const ACTIVE_TTL_MS = 180 * 86400000;

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

/**
 * alert: { basePrice, available }; product: { priceIncl } or null when not on sale.
 * Returns { kind: "drop" | "back" | null, basePrice, available }.
 */
function decideAlert(alert, product) {
  const basePrice = Number(alert && alert.basePrice) || 0;
  const wasAvailable = !alert || alert.available !== false;
  if (!product) return { kind: null, basePrice, available: false };
  const price = round2(product.priceIncl);
  if (!(price > 0)) return { kind: null, basePrice, available: wasAvailable };
  if (!wasAvailable) return { kind: "back", basePrice: Math.min(basePrice || price, price), available: true };
  if (basePrice > 0 && price <= round2(basePrice * (1 - MIN_DROP_RATIO))) {
    return { kind: "drop", basePrice: price, available: true };
  }
  return { kind: null, basePrice, available: true };
}

function rowToAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    productId: row.product_id,
    productName: row.product_name,
    basePrice: Number(row.base_price) || 0,
    status: row.status,
    available: Number(row.available) === 1,
    notifyCount: Number(row.notify_count) || 0,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
    lastNotifiedAt: row.last_notified_at || null,
  };
}

function createPriceAlertStore(db, options) {
  const opts = options || {};
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      base_price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      available INTEGER NOT NULL DEFAULT 1,
      notify_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      last_notified_at TEXT,
      UNIQUE (email, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_price_alerts_status ON price_alerts(status);
  `);
  const byKey = db.prepare("SELECT * FROM price_alerts WHERE email = ? AND product_id = ?");
  const byToken = db.prepare("SELECT * FROM price_alerts WHERE token = ?");
  const countActive = db.prepare(
    "SELECT COUNT(*) AS n FROM price_alerts WHERE email = ? AND status = 'active'"
  );
  const insert = db.prepare(
    `INSERT INTO price_alerts (token, email, product_id, product_name, base_price, status, created_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  );
  const activatePending = db.prepare(
    "UPDATE price_alerts SET base_price = ?, product_name = ?, status = 'active', confirmed_at = ? WHERE id = ?"
  );
  const activate = db.prepare(
    "UPDATE price_alerts SET status = 'active', confirmed_at = ? WHERE id = ?"
  );
  const removeByToken = db.prepare("DELETE FROM price_alerts WHERE token = ?");
  const listActive = db.prepare("SELECT * FROM price_alerts WHERE status = 'active'");
  const saveState = db.prepare(
    "UPDATE price_alerts SET base_price = ?, available = ? WHERE id = ?"
  );
  const markNotified = db.prepare(
    "UPDATE price_alerts SET notify_count = notify_count + 1, last_notified_at = ? WHERE id = ?"
  );
  const purgePending = db.prepare("DELETE FROM price_alerts WHERE status = 'pending' AND created_at < ?");
  const purgeActive = db.prepare(
    "DELETE FROM price_alerts WHERE status = 'active' AND COALESCE(confirmed_at, created_at) < ?"
  );
  const summaryRows = db.prepare(
    "SELECT status, COUNT(*) AS n FROM price_alerts GROUP BY status"
  );

  return {
    /**
     * Alerts start active on request (the received mail carries a one-click cancel link).
     * Returns { alert, state: "created" | "active" }; a legacy pending row is activated as
     * "created". Throws a Turkish message when the address already watches too many products.
     */
    subscribe(input) {
      const email = normalizeEmail(input && input.email);
      const productId = String((input && input.productId) || "").trim().slice(0, 120);
      const productName = String((input && input.productName) || "").trim().slice(0, 200);
      const basePrice = round2(input && input.price);
      if (!email || !productId || !(basePrice > 0)) throw new Error("Fiyat alarmı bilgileri eksik.");
      const stamp = new Date(now()).toISOString();
      const existing = rowToAlert(byKey.get(email, productId));
      if (existing && existing.status === "active") return { alert: existing, state: "active" };
      if (countActive.get(email).n >= MAX_ACTIVE_PER_EMAIL) {
        throw new Error("Bu e-posta adresiyle en fazla " + MAX_ACTIVE_PER_EMAIL + " ürün takip edilebilir.");
      }
      if (existing) {
        activatePending.run(basePrice, productName, stamp, existing.id);
        return { alert: rowToAlert(byKey.get(email, productId)), state: "created" };
      }
      insert.run(crypto.randomBytes(24).toString("hex"), email, productId, productName, basePrice, stamp, stamp);
      return { alert: rowToAlert(byKey.get(email, productId)), state: "created" };
    },
    confirm(token) {
      const alert = rowToAlert(byToken.get(String(token || "")));
      if (!alert) return null;
      if (alert.status !== "active") activate.run(new Date(now()).toISOString(), alert.id);
      return rowToAlert(byToken.get(alert.token));
    },
    unsubscribe(token) {
      const alert = rowToAlert(byToken.get(String(token || "")));
      if (!alert) return null;
      removeByToken.run(alert.token);
      return alert;
    },
    get(token) {
      return rowToAlert(byToken.get(String(token || "")));
    },
    /**
     * lookup(productId) → { priceIncl, name, urlPath } or null. Returns the alerts to mail;
     * their new state is written by markNotified only after the mail went out, so a failed
     * send is retried on the next run.
     */
    evaluate(lookup) {
      const due = [];
      const rows = listActive.all().map(rowToAlert);
      const write = () => {
        for (const alert of rows) {
          const product = lookup(alert.productId);
          const decision = decideAlert(alert, product);
          if (decision.kind) {
            due.push({ alert, product, kind: decision.kind, previousPrice: alert.basePrice, decision });
          } else if (decision.basePrice !== alert.basePrice || decision.available !== alert.available) {
            saveState.run(decision.basePrice, decision.available ? 1 : 0, alert.id);
          }
        }
      };
      if (typeof db.transaction === "function") db.transaction(write)();
      else write();
      return due;
    },
    markNotified(entry) {
      const { alert, decision } = entry;
      saveState.run(decision.basePrice, decision.available ? 1 : 0, alert.id);
      markNotified.run(new Date(now()).toISOString(), alert.id);
    },
    purge() {
      const t = now();
      return (
        purgePending.run(new Date(t - PENDING_TTL_MS).toISOString()).changes +
        purgeActive.run(new Date(t - ACTIVE_TTL_MS).toISOString()).changes
      );
    },
    summary() {
      const out = { pending: 0, active: 0 };
      summaryRows.all().forEach((row) => {
        out[row.status] = Number(row.n) || 0;
      });
      return out;
    },
  };
}

module.exports = {
  decideAlert,
  normalizeEmail,
  createPriceAlertStore,
  MIN_DROP_RATIO,
  MAX_ACTIVE_PER_EMAIL,
};
