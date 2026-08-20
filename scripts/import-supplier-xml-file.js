#!/usr/bin/env node
/**
 * Import a downloaded supplier XML file into the local/live product pool.
 * Usage: node scripts/import-supplier-xml-file.js /tmp/patygo-supplier.xml
 */
const fs = require("fs");
const path = require("path");
const { createSupplierStore, parseSupplierXml, decodeXmlBytes } = require("../lib/supplier");

const root = path.resolve(__dirname, "..");
const xmlPath = process.argv[2] || path.join("/tmp", "patygo-supplier.xml");
const raw = fs.readFileSync(xmlPath);
const xml = decodeXmlBytes(raw);
const store = createSupplierStore(root);
const config = JSON.parse(fs.readFileSync(path.join(root, ".runtime", "supplier-config.json"), "utf8"));
const products = parseSupplierXml(xml, new URL(config.url));
if (!products.length) {
  console.log(JSON.stringify({ ok: false, error: "XML içinde fiyatı ve adı geçerli ürün bulunamadı.", bytes: raw.length }));
  process.exit(1);
}

const runtime = path.join(root, ".runtime");
fs.mkdirSync(runtime, { recursive: true });
fs.writeFileSync(path.join(runtime, "supplier-cache.json"), JSON.stringify(products, null, 2));
const settingsPath = path.join(runtime, "supplier-settings.json");
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
} catch (_) {}
const now = new Date().toISOString();
Object.assign(settings, {
  lastFetchAt: now,
  lastSuccessfulFetchAt: now,
  lastFetchStatus: "ok",
  lastError: "",
  catalogStale: false,
  itemCount: products.length,
});
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(
  JSON.stringify(
    {
      ok: true,
      itemCount: products.length,
      sample: products.slice(0, 3).map((item) => ({
        sku: item.supplierSku,
        name: item.name,
        stock: item.stockQty,
        price: item.costPrice,
      })),
    },
    null,
    2
  )
);
