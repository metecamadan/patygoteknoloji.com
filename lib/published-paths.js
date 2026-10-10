"use strict";

const { getDb } = require("./db");

function normalizePath(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
  return /^\/[^/]+\/[^/]+$/.test(text) ? text.slice(0, 300) : "";
}

/**
 * Product URLs that were ever on the storefront (on sale or kept as sold out). Only these may
 * redirect to their category once the product is gone; any other product-shaped URL is a 404.
 */
function createPublishedPaths(root) {
  const db = getDb(root);
  const insert = db.prepare("INSERT OR IGNORE INTO published_product_paths (path, first_seen) VALUES (?, ?)");
  const lookup = db.prepare("SELECT 1 FROM published_product_paths WHERE path = ?");
  const recorded = new Set();

  const recordMany = db.transaction((paths, nowIso) => {
    for (const value of paths) insert.run(value, nowIso);
  });

  function record(urlPaths) {
    const fresh = [];
    for (const raw of urlPaths || []) {
      const value = normalizePath(raw);
      if (!value || recorded.has(value)) continue;
      recorded.add(value);
      fresh.push(value);
    }
    if (fresh.length) recordMany(fresh, new Date().toISOString());
    return fresh.length;
  }

  function has(urlPath) {
    const value = normalizePath(urlPath);
    if (!value) return false;
    if (recorded.has(value)) return true;
    return Boolean(lookup.get(value));
  }

  return { record, has };
}

module.exports = { createPublishedPaths, normalizePath };
