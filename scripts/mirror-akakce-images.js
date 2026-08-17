#!/usr/bin/env node
"use strict";
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const fs = require("fs");
const { createMultiSupplierManager } = require("../lib/multi-supplier");
const { mergeCatalogProducts } = require("../lib/catalog");
const { CATEGORY_FEED_DEFAULTS } = require("../lib/product-fields");
const { mirrorAkakceCatalogImages, loadMirrorIndex } = require("../lib/product-image-mirror");
const { resolveSiteBaseUrl } = require("../lib/site-url");

const ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = process.env.PATYGO_DATA_ROOT
  ? path.resolve(process.env.PATYGO_DATA_ROOT)
  : ROOT;
const PRODUCTS_FILE = path.join(DATA_ROOT, "assets", "data", "products.json");
const supplierAllowedHosts = String(
  process.env.SUPPLIER_ALLOWED_HOSTS || "www.bilgisayarim.com.tr"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function loadProducts() {
  try {
    const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

async function main() {
  const siteBaseUrl = resolveSiteBaseUrl(process.env.SITE_BASE_URL, {
    production: process.env.NODE_ENV === "production",
    port: process.env.PORT || 5173,
  });
  const supplierManager = createMultiSupplierManager(DATA_ROOT, {
    allowedHosts: supplierAllowedHosts,
    defaultMarginPercent: process.env.SUPPLIER_MARGIN_PERCENT || 15,
    slots: [
      {
        id: "supplier-1",
        filePrefix: "supplier",
        defaultName: "XML Kaynağı 1",
        envUrl: process.env.SUPPLIER_XML_URL || "",
      },
      {
        id: "supplier-2",
        filePrefix: "supplier-2",
        defaultName: "XML Kaynağı 2",
        envUrl: process.env.SUPPLIER_XML_URL_2 || "",
      },
      {
        id: "supplier-3",
        filePrefix: "supplier-3",
        defaultName: "XML Kaynağı 3",
        envUrl: process.env.SUPPLIER_XML_URL_3 || "",
      },
    ],
  });
  const manual = loadProducts();
  const supplier = supplierManager.listProducts();
  const products = mergeCatalogProducts(manual, supplier, {
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
  });
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
