#!/usr/bin/env node
"use strict";
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const fs = require("fs");
const { createMultiSupplierManager } = require("../lib/multi-supplier");
const { mergeCatalogProducts } = require("../lib/catalog");
const { createCategoryStore } = require("../lib/categories");
const { mirrorAkakceCatalogImages, loadMirrorIndex } = require("../lib/product-image-mirror");
const { resolveSiteBaseUrl } = require("../lib/site-url");

const ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = process.env.PATYGO_DATA_ROOT
  ? path.resolve(process.env.PATYGO_DATA_ROOT)
  : ROOT;
const PRODUCTS_FILE = path.join(DATA_ROOT, "assets", "data", "products.json");

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
  } catch (_) {
    return [];
  }
}

async function main() {
  const siteBaseUrl = resolveSiteBaseUrl(process.env.SITE_BASE_URL, {
    production: process.env.NODE_ENV === "production",
    port: process.env.PORT || 5173,
  });
  const categoryStore = createCategoryStore({ root: DATA_ROOT });
  const supplierManager = createMultiSupplierManager({
    root: DATA_ROOT,
    allowedHosts: String(process.env.SUPPLIER_ALLOWED_HOSTS || "www.bilgisayarim.com.tr")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  });
  const manual = loadProducts();
  const supplier = supplierManager.activeProducts();
  const products = mergeCatalogProducts(manual, supplier, categoryStore);
  const result = await mirrorAkakceCatalogImages(products, {
    dataRoot: DATA_ROOT,
    siteBaseUrl,
    logError: (message, source, detail) =>
      console.warn(message, String(source || "").slice(0, 60), detail || ""),
  });
  const index = loadMirrorIndex(DATA_ROOT);
  console.log(
    JSON.stringify({
      ok: true,
      queued: result.mirrored,
      indexed: Object.keys(index).length,
    })
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
