#!/usr/bin/env node
"use strict";

/**
 * Export Merchant ProductInput JSON for eligible catalog products.
 * Usage:
 *   node scripts/merchant_export_payload.js [--limit N] [--dry-run] [--out file]
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { createConfiguredSupplierManager } = require("../lib/supplier-manager-factory");
const { mergeCatalogProducts } = require("../lib/catalog");
const { loadMirrorIndex } = require("../lib/product-image-mirror");
const { storefrontImageIndex } = require("../lib/official-images");
const { createShippingSettingsStore } = require("../lib/shipping-settings");
const { CATEGORY_FEED_DEFAULTS } = require("../lib/product-fields");
const { buildMerchantProductInputs } = require("../lib/google-merchant");

const ROOT = path.join(__dirname, "..");
const DATA_ROOT = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : process.env.PATYGO_DATA_ROOT
    ? path.resolve(process.env.PATYGO_DATA_ROOT)
    : ROOT;
const SITE_BASE_URL = String(process.env.SITE_BASE_URL || "https://patygoteknoloji.com").replace(
  /\/+$/,
  ""
);

function parseArgs(argv) {
  const out = { limit: 0, dryRun: false, outPath: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--limit") out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (arg.startsWith("--limit=")) out.limit = Math.max(0, Number(arg.split("=")[1]) || 0);
    else if (arg === "--out") out.outPath = String(argv[++i] || "").trim();
    else if (arg.startsWith("--out=")) out.outPath = String(arg.split("=")[1] || "").trim();
  }
  return out;
}

function loadManualProducts() {
  const candidates = [
    path.join(DATA_ROOT, "products.json"),
    path.join(DATA_ROOT, "assets", "data", "products.json"),
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      /* try next */
    }
  }
  return [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^https:\/\/patygoteknoloji\.com$/i.test(SITE_BASE_URL)) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "SITE_BASE_URL must be https://patygoteknoloji.com for Merchant export",
        siteBaseUrl: SITE_BASE_URL,
      })
    );
    process.exit(1);
  }

  const supplierManager = createConfiguredSupplierManager(DATA_ROOT);
  const mirrorIndex = storefrontImageIndex(DATA_ROOT, loadMirrorIndex(DATA_ROOT));
  const shippingSettings = createShippingSettingsStore(DATA_ROOT).getSettings();
  const products = mergeCatalogProducts(loadManualProducts(), supplierManager.listProducts(), {
    includeInactiveManual: false,
    normalizeProduct: (product) => product,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
    mirrorIndex,
    siteBaseUrl: SITE_BASE_URL,
    dataRoot: DATA_ROOT,
  });

  const built = buildMerchantProductInputs(products, {
    siteBaseUrl: SITE_BASE_URL,
    mirrorIndex,
    shippingSettings,
  });

  let inputs = built.inputs;
  if (args.limit > 0) inputs = inputs.slice(0, args.limit);

  const payload = {
    ok: true,
    siteBaseUrl: SITE_BASE_URL,
    dataRoot: DATA_ROOT,
    dryRun: args.dryRun,
    catalogCount: products.length,
    eligible: built.eligible,
    excluded: built.excluded,
    reasonCounts: built.reasonCounts,
    exportCount: inputs.length,
    inputs: args.dryRun
      ? inputs.map((row) => ({
          offerId: row.offerId,
          title: row.productAttributes.title,
          priceMicros: row.productAttributes.price.amountMicros,
          link: row.productAttributes.link,
        }))
      : inputs,
  };

  const text = JSON.stringify(payload) + "\n";
  if (args.outPath) {
    fs.mkdirSync(path.dirname(path.resolve(args.outPath)), { recursive: true });
    fs.writeFileSync(args.outPath, text, "utf8");
    console.error(
      JSON.stringify({
        ok: true,
        out: args.outPath,
        exportCount: inputs.length,
        eligible: built.eligible,
      })
    );
  } else {
    process.stdout.write(text);
  }
}

main();
