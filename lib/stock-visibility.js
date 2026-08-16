"use strict";

const STOCK_READ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function stockReadAgeMs(lastSuccessfulFetchAt, now) {
  const at = Date.parse(lastSuccessfulFetchAt);
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now.getTime() - at);
}

function stockReadIsFresh(lastSuccessfulFetchAt, catalogStale, now) {
  const when = now instanceof Date ? now : new Date();
  const at = Date.parse(lastSuccessfulFetchAt);
  if (Number.isFinite(at)) return when.getTime() - at <= STOCK_READ_MAX_AGE_MS;
  return catalogStale !== true;
}

function supplierStockProbe(item) {
  return {
    source: "supplier",
    stockQty: item.stockQty,
    criticalStockQty: item.criticalStockQty,
    catalogStale: item.catalogStale,
  };
}

function isSupplierOfferLive(product, now) {
  const item = product || {};
  if (!stockReadIsFresh(item.lastSuccessfulFetchAt, item.catalogStale, now)) return false;
  const { productStock } = require("./akakce");
  return productStock(supplierStockProbe(item)) > 0;
}

function supplierVisibilityReasons(product, now) {
  const item = product || {};
  const reasons = [];
  if (!stockReadIsFresh(item.lastSuccessfulFetchAt, item.catalogStale, now)) {
    reasons.push("Son 7 günde stok okunamadı");
  }
  const { productStock } = require("./akakce");
  if (productStock(supplierStockProbe(item)) <= 0) {
    reasons.push("Stok yok");
  }
  return reasons;
}

module.exports = {
  STOCK_READ_MAX_AGE_MS,
  stockReadAgeMs,
  stockReadIsFresh,
  isSupplierOfferLive,
  supplierVisibilityReasons,
};
