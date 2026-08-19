#!/usr/bin/env node
/**
 * Apply SEO description/details override for one supplier SKU.
 * Usage: node scripts/apply-supplier-seo-override.js scripts/content/<product>.json
 */
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});

const { createMultiSupplierManager } = require("../lib/multi-supplier");

const root = path.resolve(__dirname, "..");
const contentPath = path.resolve(process.argv[2] || "");
if (!contentPath || !fs.existsSync(contentPath)) {
  console.error("Usage: node scripts/apply-supplier-seo-override.js <content.json>");
  process.exit(1);
}

const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));
const description = String(content.description || "").trim();
const details = String(content.details || "").trim();
if (!description || !details) {
  console.error("content.json must include description and details");
  process.exit(1);
}

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

let supplierSku = String(content.supplierSku || "").trim();
const productId = String(content.productId || "").trim();
const supplierSlot = String(content.supplierSlot || "supplier-1").trim();

if (!supplierSku && productId) {
  const product = manager.getProductById(productId);
  if (!product) {
    console.error("Product not found for id:", productId);
    process.exit(1);
  }
  supplierSku = String(product.supplierSku || "").trim();
}

if (!supplierSku) {
  console.error("supplierSku or resolvable productId required");
  process.exit(1);
}

manager.updateProducts([
  {
    supplierSku,
    supplierSlot,
    description,
    details,
  },
]);

console.log(
  JSON.stringify(
    {
      ok: true,
      productId: productId || null,
      supplierSku,
      supplierSlot,
      descriptionLength: description.length,
      detailsLength: details.length,
    },
    null,
    2
  )
);
