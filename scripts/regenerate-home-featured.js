#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { createMultiSupplierManager } = require("../lib/multi-supplier");
const { mergeCatalogProducts, homeFeaturedCatalog, buildStorefrontIndex } = require("../lib/catalog");
const { loadMirrorIndex } = require("../lib/product-image-mirror");
const { atomicWriteJson } = require("../lib/supplier");
const { CATEGORY_FEED_DEFAULTS } = require("../lib/product-fields");

const ROOT = path.join(__dirname, "..");
const DATA_ROOT = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : ROOT;
const PRODUCTS_FILE = path.join(DATA_ROOT, "products.json");
const BOOT = path.join(DATA_ROOT, ".runtime", "catalog-bootstrap");
const SITE_BASE_URL = String(process.env.SITE_BASE_URL || "https://patygoteknoloji.com").replace(/\/$/, "");

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
  } catch (_) {
    return [];
  }
}

function normalizeProduct(product) {
  return product;
}

function main() {
  const supplierManager = createMultiSupplierManager(DATA_ROOT);
  const mirrorIndex = loadMirrorIndex(DATA_ROOT);
  const ctx = {
    mirrorIndex,
    siteBaseUrl: SITE_BASE_URL,
    dataRoot: DATA_ROOT,
  };
  const products = mergeCatalogProducts(loadProducts(), supplierManager.listProducts(), {
    includeInactiveManual: false,
    normalizeProduct,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
    ...ctx,
  });
  const index = buildStorefrontIndex(products, ctx);
  const featured = homeFeaturedCatalog(products, { limit: 12 }, { routeIndex: index.routeIndex, ...ctx });
  fs.mkdirSync(BOOT, { recursive: true });
  const file = path.join(BOOT, "home-featured.json");
  atomicWriteJson(file, {
    products: featured.products,
    byParent: featured.byParent,
    perCategory: featured.perCategory,
    parents: featured.parents,
    total: featured.products.length,
    page: 1,
    limit: featured.perCategory,
    totalPages: 1,
  });
  const parents = Object.keys(featured.byParent || {}).filter(
    (slug) => Array.isArray(featured.byParent[slug]) && featured.byParent[slug].length
  );
  console.log(
    JSON.stringify({
      ok: true,
      file,
      mixed: featured.products.length,
      parents: parents.length,
      perParent: parents.map((slug) => ({
        slug,
        count: featured.byParent[slug].length,
      })),
    })
  );
}

main();
