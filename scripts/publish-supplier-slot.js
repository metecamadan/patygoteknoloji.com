#!/usr/bin/env node
/**
 * Publish one XML slot onto the storefront (categories + active).
 * Usage: node scripts/publish-supplier-slot.js supplier-1
 * Does not fetch supplier XML.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const path = require("path");
const { createMultiSupplierManager } = require("../lib/multi-supplier");
const { createCategoryStore, setCategoryListLoader } = require("../lib/categories");
const { publishSupplierSlot } = require("../lib/supplier-site");

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
setCategoryListLoader(() => categoryStore.list());

publishSupplierSlot({ manager, categoryStore, slotId, root })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
