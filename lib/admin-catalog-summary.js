"use strict";

const { stockReadIsFresh } = require("./stock-visibility");

function finiteStock(item) {
  const qty = Number(item.stockQty);
  if (item.stockQty === null || item.stockQty === undefined || !Number.isFinite(qty)) return 0;
  return Math.max(0, Math.floor(qty));
}

function latestIso(values) {
  let best = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

// Snapshot counts for the admin overview; independent of the analytics period.
// Stock buckets mirror the storefront rules: stale reads (7 days) and stock at or
// below the slot's critical threshold keep a published supplier product off the site.
function buildAdminCatalogSummary(input) {
  const opts = input || {};
  const manual = Array.isArray(opts.manualProducts) ? opts.manualProducts : [];
  const supplier = Array.isArray(opts.supplierProducts) ? opts.supplierProducts : [];
  const slots = Array.isArray(opts.slots) ? opts.slots : [];
  const now = opts.now instanceof Date ? opts.now : new Date();

  let publishedCount = 0;
  let unlistedCount = 0;
  let criticalStockCount = 0;
  let outOfStockCount = 0;
  let staleStockCount = 0;
  for (const item of supplier) {
    if (!item) continue;
    if (item.unlisted === true) {
      unlistedCount += 1;
      continue;
    }
    if (item.active !== true) continue;
    if (item.siteCategoryAssigned !== true) unlistedCount += 1;
    publishedCount += 1;
    if (!stockReadIsFresh(item.lastSuccessfulFetchAt, item.catalogStale, now)) {
      staleStockCount += 1;
      continue;
    }
    const stock = finiteStock(item);
    const critical = Number(item.criticalStockQty);
    if (stock <= 0) {
      outOfStockCount += 1;
    } else if (item.catalogStale !== true && Number.isFinite(critical) && critical > 0 && stock <= critical) {
      criticalStockCount += 1;
    }
  }

  const configuredSlots = slots.filter((slot) => slot && slot.configured);
  const thresholds = new Set(
    configuredSlots
      .map((slot) => Number(slot.criticalStockQty))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value))
  );

  return {
    totalCount: manual.length + supplier.length,
    manualCount: manual.length,
    manualActiveCount: manual.filter((item) => item && item.active !== false).length,
    supplierCount: supplier.length,
    supplierPublishedCount: publishedCount,
    siteActiveCount: Math.max(0, Number(opts.storefrontCount) || 0),
    criticalStockCount,
    criticalStockThresholds: Array.from(thresholds).sort((a, b) => a - b),
    outOfStockCount,
    staleStockCount,
    unlistedCount,
    xml: {
      connected: configuredSlots.length,
      total: slots.length,
      failing: configuredSlots.filter((slot) => slot.lastFetchStatus === "error").length,
      stale: configuredSlots.filter((slot) => slot.catalogStale === true).length,
      lastSuccessfulFetchAt: latestIso(configuredSlots.map((slot) => slot.lastSuccessfulFetchAt)),
    },
  };
}

module.exports = { buildAdminCatalogSummary };
