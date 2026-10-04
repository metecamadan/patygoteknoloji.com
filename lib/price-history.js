"use strict";

// İndirimli Satış Reklamları Yönetmeliği: "indirim öncesi fiyat" = indirimden önceki son 30 günde
// uygulanan en düşük fiyat. Daily lowest net prices are kept so a badge only appears for a real drop.
const WINDOW_DAYS = 30;
const RETAIN_DAYS = 75;
const MIN_DISCOUNT_RATIO = 0.05;
const DAY_MS = 86400000;

function isoDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(day, delta) {
  return isoDay(Date.parse(day + "T00:00:00Z") + delta * DAY_MS);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * rows: ascending [{ day, price }] for one product, today's row included.
 * Returns { compareAtPrice, since } or null.
 */
function referenceFromRows(rows, today, currentPrice) {
  const current = Number(currentPrice);
  if (!(current > 0) || !Array.isArray(rows) || !rows.length) return null;
  const tolerance = current * 1.001;
  let index = rows.length - 1;
  while (index >= 0 && rows[index].day > today) index -= 1;
  // The current price run: consecutive history (newest first) at or below today's price.
  let start = index;
  while (start >= 0 && Number(rows[start].price) <= tolerance) start -= 1;
  if (start === index) return null;
  const since = rows[start + 1].day;
  if (since <= addDays(today, -WINDOW_DAYS)) return null;
  const windowStart = addDays(since, -WINDOW_DAYS);
  let lowest = Infinity;
  for (let i = start; i >= 0 && rows[i].day >= windowStart; i -= 1) {
    lowest = Math.min(lowest, Number(rows[i].price));
  }
  if (!Number.isFinite(lowest)) return null;
  if (lowest < current * (1 + MIN_DISCOUNT_RATIO)) return null;
  return { compareAtPrice: roundMoney(lowest), since };
}

function createPriceHistory(db, options) {
  const opts = options || {};
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      product_id TEXT NOT NULL,
      day TEXT NOT NULL,
      price REAL NOT NULL,
      PRIMARY KEY (product_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_price_history_day ON price_history(day);
  `);
  const upsert = db.prepare(
    "INSERT INTO price_history (product_id, day, price) VALUES (?, ?, ?) " +
      "ON CONFLICT(product_id, day) DO UPDATE SET price = MIN(price, excluded.price)"
  );
  const prune = db.prepare("DELETE FROM price_history WHERE day < ?");
  const selectSince = db.prepare(
    "SELECT product_id, day, price FROM price_history WHERE day >= ? ORDER BY product_id, day"
  );

  let recordedDay = "";
  let recorded = new Map();
  let references = new Map();
  let referencesDay = "";
  let dirty = true;

  /** products: [{ id, price }] with net sale prices; only changes since the last call hit the DB. */
  function record(products) {
    const today = isoDay(now());
    if (today !== recordedDay) {
      recordedDay = today;
      recorded = new Map();
      prune.run(addDays(today, -RETAIN_DAYS));
      dirty = true;
    }
    const changes = [];
    for (const product of Array.isArray(products) ? products : []) {
      const id = product && String(product.id || "");
      const price = roundMoney(product && product.price);
      if (!id || !(price > 0)) continue;
      const seen = recorded.get(id);
      if (seen !== undefined && seen <= price) continue;
      recorded.set(id, price);
      changes.push([id, price]);
    }
    if (!changes.length) return 0;
    const write = () => {
      for (const [id, price] of changes) upsert.run(id, today, price);
    };
    if (typeof db.transaction === "function") db.transaction(write)();
    else write();
    dirty = true;
    return changes.length;
  }

  function rebuild(today) {
    const map = new Map();
    let currentId = "";
    let rows = [];
    const flush = () => {
      if (!currentId || !rows.length) return;
      const last = rows[rows.length - 1];
      if (last.day !== today) return;
      const ref = referenceFromRows(rows, today, last.price);
      if (ref) map.set(currentId, ref);
    };
    for (const row of selectSince.all(addDays(today, -RETAIN_DAYS))) {
      if (row.product_id !== currentId) {
        flush();
        currentId = row.product_id;
        rows = [];
      }
      rows.push({ day: row.day, price: Number(row.price) });
    }
    flush();
    references = map;
    referencesDay = today;
    dirty = false;
  }

  /** compareAtPrice (net) for a product currently selling at `price`, or 0. */
  function referenceFor(id, price) {
    const today = isoDay(now());
    if (dirty || referencesDay !== today) rebuild(today);
    const ref = references.get(String(id || ""));
    if (!ref) return 0;
    return ref.compareAtPrice >= Number(price) * (1 + MIN_DISCOUNT_RATIO) ? ref.compareAtPrice : 0;
  }

  return { record, referenceFor };
}

module.exports = {
  WINDOW_DAYS,
  MIN_DISCOUNT_RATIO,
  referenceFromRows,
  createPriceHistory,
};
