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

const ALERT_KINDS = new Set(["price", "stock"]);

function normalizeKind(value) {
  return ALERT_KINDS.has(value) ? value : "price";
}

/**
 * alert: { kind, basePrice, targetPrice, available }; product: { priceIncl } or null when not on sale.
 * Price alerts mail only on a drop (a return to sale is recorded silently): with a target
 * once the price reaches it, legacy rows without a target on a MIN_DROP_RATIO drop. Stock
 * alerts mail once when the product is on sale again.
 * Returns { kind: "drop" | "back" | null, basePrice, available }.
 */
function decideAlert(alert, product) {
  const basePrice = Number(alert && alert.basePrice) || 0;
  const targetPrice = Number(alert && alert.targetPrice) || 0;
  const wasAvailable = !alert || alert.available !== false;
  if (!product) return { kind: null, basePrice, available: false };
  const price = round2(product.priceIncl);
  if (!(price > 0)) return { kind: null, basePrice, available: wasAvailable };
  if (normalizeKind(alert && alert.kind) === "stock") return { kind: "back", basePrice: price, available: true };
  if (targetPrice > 0) {
    return price <= round2(targetPrice)
      ? { kind: "drop", basePrice: price, available: true }
      : { kind: null, basePrice, available: true };
  }
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
    kind: normalizeKind(row.kind),
    productId: row.product_id,
    productName: row.product_name,
    basePrice: Number(row.base_price) || 0,
    targetPrice: Number(row.target_price) > 0 ? Number(row.target_price) : null,
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
  const columns = db.prepare("PRAGMA table_info(price_alerts)").all().map((col) => col.name);
  if (!columns.includes("kind")) {
    db.exec("ALTER TABLE price_alerts ADD COLUMN kind TEXT NOT NULL DEFAULT 'price'");
  }
  if (!columns.includes("target_price")) {
    db.exec("ALTER TABLE price_alerts ADD COLUMN target_price REAL");
  }
  const byKey = db.prepare("SELECT * FROM price_alerts WHERE email = ? AND product_id = ?");
  const byToken = db.prepare("SELECT * FROM price_alerts WHERE token = ?");
  const byId = db.prepare("SELECT * FROM price_alerts WHERE id = ?");
  const countActive = db.prepare(
    "SELECT COUNT(*) AS n FROM price_alerts WHERE email = ? AND status = 'active'"
  );
  const insert = db.prepare(
    `INSERT INTO price_alerts (token, email, product_id, product_name, base_price, target_price, kind, available, status, created_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  );
  const restart = db.prepare(
    `UPDATE price_alerts SET base_price = ?, target_price = ?, product_name = ?, kind = ?, available = ?, status = 'active',
       notify_count = 0, last_notified_at = NULL, created_at = ?, confirmed_at = ? WHERE id = ?`
  );
  const retarget = db.prepare(
    "UPDATE price_alerts SET base_price = ?, target_price = ?, product_name = ? WHERE id = ?"
  );
  const activate = db.prepare(
    "UPDATE price_alerts SET status = 'active', confirmed_at = ? WHERE id = ?"
  );
  const removeByToken = db.prepare("DELETE FROM price_alerts WHERE token = ?");
  const removeById = db.prepare("DELETE FROM price_alerts WHERE id = ?");
  const listActive = db.prepare("SELECT * FROM price_alerts WHERE status = 'active'");
  const listForAdmin = db.prepare(
    "SELECT * FROM price_alerts WHERE kind = ? AND status IN ('active', 'notified') ORDER BY created_at DESC"
  );
  const saveState = db.prepare(
    "UPDATE price_alerts SET base_price = ?, available = ? WHERE id = ?"
  );
  const markNotified = db.prepare(
    "UPDATE price_alerts SET notify_count = notify_count + 1, last_notified_at = ? WHERE id = ?"
  );
  const closeAlert = db.prepare("UPDATE price_alerts SET status = 'notified' WHERE id = ?");
  const purgePending = db.prepare("DELETE FROM price_alerts WHERE status = 'pending' AND created_at < ?");
  const purgeActive = db.prepare(
    "DELETE FROM price_alerts WHERE status IN ('active', 'notified') AND COALESCE(confirmed_at, created_at) < ?"
  );
  const summaryRows = db.prepare(
    "SELECT status, COUNT(*) AS n FROM price_alerts GROUP BY status"
  );
  const kindCounts = db.prepare(
    "SELECT kind, COUNT(*) AS n FROM price_alerts WHERE status = 'active' GROUP BY kind"
  );

  return {
    /**
     * input.kind: "price" (one mail once the price reaches input.targetPrice) or "stock"
     * (one mail when back on sale). Alerts start active on request (the received mail
     * carries a one-click cancel link).
     * Returns { alert, state: "created" | "updated" | "active" }; a new target on an open
     * price alert is "updated"; a legacy pending, a closed or an other-kind row for the same
     * product restarts as "created". Throws a Turkish message when the address already
     * watches too many products.
     */
    subscribe(input) {
      const email = normalizeEmail(input && input.email);
      const productId = String((input && input.productId) || "").trim().slice(0, 120);
      const productName = String((input && input.productName) || "").trim().slice(0, 200);
      const basePrice = round2(input && input.price);
      const kind = normalizeKind(input && input.kind);
      const targetPrice = kind === "price" && Number(input && input.targetPrice) > 0 ? round2(input.targetPrice) : null;
      if (!email || !productId || !(basePrice > 0)) throw new Error("Fiyat alarmı bilgileri eksik.");
      const stamp = new Date(now()).toISOString();
      const available = kind === "stock" ? 0 : 1;
      const existing = rowToAlert(byKey.get(email, productId));
      if (existing && existing.status === "active" && existing.kind === kind) {
        if (kind === "price" && targetPrice && targetPrice !== existing.targetPrice) {
          retarget.run(basePrice, targetPrice, productName, existing.id);
          return { alert: rowToAlert(byKey.get(email, productId)), state: "updated" };
        }
        return { alert: existing, state: "active" };
      }
      if (!(existing && existing.status === "active") && countActive.get(email).n >= MAX_ACTIVE_PER_EMAIL) {
        throw new Error("Bu e-posta adresiyle en fazla " + MAX_ACTIVE_PER_EMAIL + " ürün takip edilebilir.");
      }
      if (existing) {
        restart.run(basePrice, targetPrice, productName, kind, available, stamp, stamp, existing.id);
        return { alert: rowToAlert(byKey.get(email, productId)), state: "created" };
      }
      insert.run(
        crypto.randomBytes(24).toString("hex"),
        email,
        productId,
        productName,
        basePrice,
        targetPrice,
        kind,
        available,
        stamp,
        stamp
      );
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
    /**
     * Stock and target-price alerts are one-shot: after their mail they close as "notified"
     * (kept for the panel until purge). Legacy price alerts without a target stay open.
     */
    markNotified(entry) {
      const { alert, decision } = entry;
      saveState.run(decision.basePrice, decision.available ? 1 : 0, alert.id);
      markNotified.run(new Date(now()).toISOString(), alert.id);
      if (alert.kind === "stock" || alert.targetPrice) closeAlert.run(alert.id);
    },
    purge() {
      const t = now();
      return (
        purgePending.run(new Date(t - PENDING_TTL_MS).toISOString()).changes +
        purgeActive.run(new Date(t - ACTIVE_TTL_MS).toISOString()).changes
      );
    },
    summary() {
      const out = { pending: 0, active: 0, notified: 0 };
      summaryRows.all().forEach((row) => {
        out[row.status] = Number(row.n) || 0;
      });
      return out;
    },
    /** Open and already-mailed (stock) requests of one kind, newest first. */
    adminList(kind) {
      return listForAdmin.all(normalizeKind(kind)).map(rowToAlert);
    },
    adminCounts() {
      const out = { price: 0, stock: 0 };
      kindCounts.all().forEach((row) => {
        out[normalizeKind(row.kind)] = Number(row.n) || 0;
      });
      return out;
    },
    remove(id) {
      const alert = rowToAlert(byId.get(Number(id) || 0));
      if (!alert) return null;
      removeById.run(alert.id);
      return alert;
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
