"use strict";

const { getDb } = require("./db");
const { refundedQtyByIndex } = require("./akbank-reversal");

/** A manual product without a stock value is untracked: never limited, never decremented. */
function trackedStock(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function qtyByProduct(items) {
  const out = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = String((item && item.productId) || "").trim();
    if (!id) continue;
    out.set(id, (out.get(id) || 0) + Math.max(1, Math.floor(Number(item.qty) || 1)));
  }
  return out;
}

/**
 * Checkout gate for manual products: requested quantities (summed per product) may not exceed
 * stock. Returns the first shortage or null.
 */
function findStockShortage(items, manualProducts) {
  const byId = new Map(
    (manualProducts || []).filter(Boolean).map((product) => [String(product.id), product])
  );
  for (const [productId, qty] of qtyByProduct(items)) {
    const product = byId.get(productId);
    if (!product) continue;
    const stock = trackedStock(product.stockQty);
    if (stock !== null && qty > stock) {
      return { productId, name: String(product.name || productId), requested: qty, available: stock };
    }
  }
  return null;
}

/**
 * Units a reversal returns, per product: newly refunded item quantities, or everything not yet
 * returned once the order becomes fully refunded. Amount-only partial refunds return nothing.
 */
function reversalReturnQty(before, updated) {
  const out = new Map();
  if (!updated || (before && before.paymentStatus === "refunded")) return out;
  const prev = refundedQtyByIndex(before || {});
  const next = refundedQtyByIndex(updated);
  const fully = updated.paymentStatus === "refunded";
  (Array.isArray(updated.items) ? updated.items : []).forEach((item, index) => {
    const id = String((item && item.productId) || "").trim();
    if (!id) return;
    const bought = Math.max(1, Math.floor(Number(item.qty) || 1));
    const already = Math.min(bought, prev[index] || 0);
    const now = fully ? bought : Math.min(bought, next[index] || 0);
    if (now > already) out.set(id, (out.get(id) || 0) + now - already);
  });
  return out;
}

/**
 * Manual product stock follows sales: paid orders take units out, bank refunds put them back.
 * Every move is a ledger row keyed by order, so a repeated callback never moves stock twice and
 * orders paid before tracking began never add stock on refund.
 */
function createManualStock(root, deps) {
  const db = getDb(root);
  const loadProducts = deps.loadProducts;
  const saveProducts = deps.saveProducts;
  const stampRestock = deps.stampRestock || ((product) => product);

  const insertMove = db.prepare(
    `INSERT OR IGNORE INTO manual_stock_moves
      (order_id, product_id, reason, ref, qty, stock_before, stock_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const soldQty = db.prepare(
    "SELECT COALESCE(SUM(qty), 0) AS qty FROM manual_stock_moves WHERE order_id = ? AND product_id = ? AND reason = 'sale'"
  );
  const returnedQty = db.prepare(
    "SELECT COALESCE(SUM(qty), 0) AS qty FROM manual_stock_moves WHERE order_id = ? AND product_id = ? AND reason = 'refund'"
  );

  function applyMoves(orderId, deltas, reason, ref) {
    const run = db.transaction(() => {
      const products = loadProducts();
      const nowIso = new Date().toISOString();
      const changes = [];
      for (const [productId, delta] of deltas) {
        const index = products.findIndex((item) => item && String(item.id) === productId);
        if (index < 0 || !delta) continue;
        const current = products[index];
        const before = trackedStock(current.stockQty);
        if (before === null) continue;
        const after = Math.max(0, before + delta);
        // The ledger keeps the units actually moved, so a refund of an oversold order returns no more than was taken.
        const info = insertMove.run(orderId, productId, reason, ref, after - before, before, after, nowIso);
        if (!info || !info.changes) continue;
        products[index] = stampRestock(Object.assign({}, current, { stockQty: after }), current, nowIso);
        changes.push({
          productId,
          name: String(current.name || productId),
          qty: after - before,
          before,
          after,
          shortBy: before + delta < 0 ? -(before + delta) : 0,
        });
      }
      if (changes.length) saveProducts(products);
      return changes;
    });
    return run();
  }

  function recordSale(order) {
    if (!order || !order.id) return [];
    const deltas = new Map();
    for (const [productId, qty] of qtyByProduct(order.items)) deltas.set(productId, -qty);
    return applyMoves(String(order.id), deltas, "sale", "sale");
  }

  function recordReturn(before, updated, ref) {
    if (!updated || !updated.id) return [];
    const orderId = String(updated.id);
    const deltas = new Map();
    for (const [productId, qty] of reversalReturnQty(before, updated)) {
      const sold = -Number(soldQty.get(orderId, productId).qty || 0);
      const returned = Number(returnedQty.get(orderId, productId).qty || 0);
      const allowed = Math.min(qty, sold - returned);
      if (allowed > 0) deltas.set(productId, allowed);
    }
    return applyMoves(orderId, deltas, "refund", String(ref || new Date().toISOString()).slice(0, 64));
  }

  return { recordSale, recordReturn };
}

module.exports = { createManualStock, findStockShortage, reversalReturnQty, trackedStock };
