const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const orders = fs.readFileSync(path.join(root, "lib", "orders.js"), "utf8");
const supplier = fs.readFileSync(path.join(root, "lib", "supplier.js"), "utf8");

test("dashboard does not hydrate the full supplier catalog for product names", () => {
  assert.match(server, /function resolveProductNamesByIds/);
  assert.match(server, /getProductById\(id\)/);
  assert.doesNotMatch(server, /mergedProducts\(true\)\.map/);
});

test("product id lookup never scans the merged storefront memo", () => {
  assert.match(server, /function lookupPublicProductsByIds/);
  assert.doesNotMatch(
    server,
    /lookupPublicProductsByIds[\s\S]*queryPublicCatalog\(memo\.products/
  );
});

test("checkout resolves only cart product ids", () => {
  assert.match(server, /lookupCheckoutProductsByIds/);
  const fn = server.match(/function buildCheckoutOrder\(body\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, "buildCheckoutOrder bulunmalı");
  assert.doesNotMatch(fn[1], /mergedProducts\(false\)/);
});

test("order list loads items in batches instead of per-row queries", () => {
  assert.match(orders, /function loadItemsForOrderIds/);
  assert.match(orders, /WHERE order_id IN/);
  assert.match(orders, /rowToOrder\(db, row, itemsByOrder\.get\(row\.id\)/);
  assert.match(orders, /JOIN orders o ON o\.id = i\.order_id/);
});

test("supplier getProductById uses an id map", () => {
  assert.match(supplier, /function cacheIndex/);
  assert.match(supplier, /cacheIndex\(\)\.get\(wanted\)/);
  assert.doesNotMatch(supplier, /cache\.find\(\(row\) => row && row\.id === wanted\)/);
});
