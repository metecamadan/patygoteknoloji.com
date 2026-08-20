#!/usr/bin/env node
"use strict";

/**
 * Verifies every active storefront product has an expanded __SPEC_TABLE__ (>= MIN rows).
 * Uses the same enrichment path as the live API (toPublicProduct).
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { createConfiguredSupplierManager } = require("../lib/supplier-manager-factory");
const { mergeCatalogProducts, toPublicProduct } = require("../lib/catalog");
const { CATEGORY_FEED_DEFAULTS } = require("../lib/product-fields");
const { parseProductDetailSpecTable } = require("../lib/product-detail-specs");

const ROOT = path.join(__dirname, "..");
const DATA_ROOT = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : ROOT;
const MIN_CONTENT_ROWS = 4;
const META_LABELS = new Set(
  ["barkod", "marka", "üretici kodu", "model"].map((label) => label.toLocaleLowerCase("tr-TR"))
);

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "products.json"), "utf8"));
  } catch (_) {
    return [];
  }
}

function contentRowCount(details) {
  const rows = parseProductDetailSpecTable(String(details || ""));
  return rows.filter(
    (row) => !META_LABELS.has(String(row.label || "").toLocaleLowerCase("tr-TR"))
  ).length;
}

function main() {
  const supplierManager = createConfiguredSupplierManager(DATA_ROOT);
  const products = mergeCatalogProducts(loadProducts(), supplierManager.listProducts(), {
    includeInactiveManual: false,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
  }).filter((p) => p && p.active !== false);

  const issues = [];
  let specTables = 0;
  products.forEach((product) => {
    const pub = toPublicProduct(product, { compact: false });
    const details = String(pub.details || "");
    if (!details.startsWith("__SPEC_TABLE__")) {
      issues.push({
        id: pub.id,
        reason: "missing_spec_table",
        name: pub.name,
        detailsPrefix: details.slice(0, 80),
      });
      return;
    }
    specTables += 1;
    const rows = contentRowCount(details);
    if (rows < MIN_CONTENT_ROWS) {
      issues.push({
        id: pub.id,
        reason: "thin_spec_table",
        rows,
        name: pub.name,
        detailsPrefix: details.slice(0, 160).replace(/\n/g, " | "),
      });
    }
  });

  const report = {
    ok: issues.length === 0,
    total: products.length,
    specTables,
    minContentRows: MIN_CONTENT_ROWS,
    issues: issues.length,
    sample: issues.slice(0, 25),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
