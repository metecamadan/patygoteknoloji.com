"use strict";

const { productStock } = require("./akakce");
const { trackedStock } = require("./manual-stock");

/**
 * How many units checkout may sell for this merged product.
 * Manual without a stock value stays untracked (null → caller keeps the 1–99 clamp only).
 * Supplier uses the same sellable rule as the storefront / Akakçe (critical stock → 0).
 */
function availableCheckoutQty(product) {
  if (!product || product.active === false || product.soldOut === true) return 0;
  if (product.source === "supplier") {
    return productStock({
      source: "supplier",
      stockQty: product.stockQty,
      criticalStockQty: product.criticalStockQty,
      catalogStale: product.catalogStale,
    });
  }
  return trackedStock(product.stockQty);
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
 * First line whose requested qty exceeds sellable stock, or null.
 * Untracked manuals (available === null) are not limited here.
 */
function findCheckoutStockShortage(items, productsById) {
  const byId = productsById || {};
  for (const [productId, qty] of qtyByProduct(items)) {
    const product = byId[productId];
    if (!product) continue;
    const available = availableCheckoutQty(product);
    if (available === null) continue;
    if (qty > available) {
      return {
        productId,
        name: String(product.name || productId),
        requested: qty,
        available,
      };
    }
  }
  return null;
}

module.exports = {
  availableCheckoutQty,
  findCheckoutStockShortage,
};
