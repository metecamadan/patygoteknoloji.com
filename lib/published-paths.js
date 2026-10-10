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

const ACCESS_LOG_LINE = /"(?:GET|HEAD) ([^ "?#]+)[^"]*" (\d{3}) /;

/**
 * Product URLs that were served 200 in an nginx access log (combined format), limited to known
 * product segments. 301s are ignored: the old gone-redirect also answered made-up URLs.
 */
function productPathsFromAccessLog(text, productSegments) {
  const segments = productSegments instanceof Set ? productSegments : new Set(productSegments || []);
  const out = new Set();
  for (const line of String(text || "").split("\n")) {
    const match = ACCESS_LOG_LINE.exec(line);
    if (!match || match[2] !== "200") continue;
    const value = normalizePath(match[1]);
    if (!value || /\.[a-z0-9]{2,5}$/.test(value)) continue;
    if (!segments.has(value.split("/")[1])) continue;
    out.add(value);
  }
  return out;
}

module.exports = { createPublishedPaths, normalizePath, productPathsFromAccessLog };
