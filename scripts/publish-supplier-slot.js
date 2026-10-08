#!/usr/bin/env node
/**
 * Publish one XML slot onto the storefront (categories + active), then mirror the images of
 * newly live products like the panel publish does; the storefront hides unmirrored supplier images.
 * Usage: node scripts/publish-supplier-slot.js supplier-1
 * Does not fetch supplier XML. Restart the app afterwards so the catalog index is rebuilt.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const path = require("path");
const { createMultiSupplierManager } = require("../lib/multi-supplier");
const { createCategoryStore, setCategoryListLoader } = require("../lib/categories");
const { publishSupplierSlot } = require("../lib/supplier-site");
const { supplierStorefrontCandidates } = require("../lib/catalog");
const { mirrorAkakceCatalogImages } = require("../lib/product-image-mirror");

const root = path.resolve(__dirname, "..");
const slotId = process.argv[2] || "supplier-1";
const manager = createMultiSupplierManager(root, {
  allowedHosts: String(process.env.SUPPLIER_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  defaultMarginPercent: process.env.SUPPLIER_MARGIN_PERCENT || 15,
  slots: [
    { id: "supplier-1", filePrefix: "supplier", defaultName: "XML Kaynağı 1" },
    { id: "supplier-2", filePrefix: "supplier-2", defaultName: "XML Kaynağı 2" },
    { id: "supplier-3", filePrefix: "supplier-3", defaultName: "XML Kaynağı 3" },
  ],
});
const categoryStore = createCategoryStore(root);
setCategoryListLoader(() => categoryStore.list(), () => categoryStore.stamp());

publishSupplierSlot({ manager, categoryStore, slotId, root })
  .then(async (result) => {
    console.log(JSON.stringify(result, null, 2));
    const siteBaseUrl = String(process.env.SITE_BASE_URL || "").replace(/\/+$/, "");
    if (!siteBaseUrl) throw new Error("SITE_BASE_URL tanımlı değil; görsel aynası atlandı.");
    const mirror = await mirrorAkakceCatalogImages(supplierStorefrontCandidates(manager.listProducts()), {
      dataRoot: root,
      siteBaseUrl,
      logError: (message, source, detail) => console.warn("Görsel aynası", source, detail || message),
    });
    console.log(JSON.stringify({ mirrored: mirror.mirrored, skippedNotFound: mirror.skippedNotFound }));
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
