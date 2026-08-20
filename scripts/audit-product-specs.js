#!/usr/bin/env node
"use strict";

/**
 * Lists catalog products whose auto spec table is still thin (title has more than table shows).
 * Use output to prioritize manual PSREF / manufacturer page overrides in scripts/content/*.json
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { createConfiguredSupplierManager } = require("../lib/supplier-manager-factory");
const { mergeCatalogProducts } = require("../lib/catalog");
const { CATEGORY_FEED_DEFAULTS } = require("../lib/product-fields");
const {
  buildSpecRows,
  detectProductKind,
  shouldRegenerateSpecTable,
} = require("../lib/product-description");
const { parseProductDetailSpecTable } = require("../lib/product-detail-specs");

const ROOT = path.join(__dirname, "..");
const DATA_ROOT = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : ROOT;

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "products.json"), "utf8"));
  } catch (_) {
    return [];
  }
}

function main() {
  let supplierManager;
  try {
    supplierManager = createConfiguredSupplierManager(DATA_ROOT);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
  const products = mergeCatalogProducts(loadProducts(), supplierManager.listProducts(), {
    includeInactiveManual: false,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
  }).filter((p) => p && p.active !== false);

  const thin = [];
  for (const product of products) {
    const details = String(product.details || "");
    const existing = details.startsWith("__SPEC_TABLE__")
      ? parseProductDetailSpecTable(details)
      : [];
    const fresh = buildSpecRows(product);
    if (shouldRegenerateSpecTable(product, details || "")) {
      thin.push({
        id: product.id,
        kind: detectProductKind(product),
        name: product.name,
        existingRows: existing.length,
        freshRows: fresh.length,
        freshLabels: fresh.map((row) => row.label).slice(0, 12),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        total: products.length,
        needsEnrichment: thin.length,
        sample: thin.slice(0, 40),
      },
      null,
      2
    )
  );
}

main();
