const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const orders = fs.readFileSync(path.join(root, "lib", "orders.js"), "utf8");
const supplier = fs.readFileSync(path.join(root, "lib", "supplier.js"), "utf8");

test("supplier status skips catalog merge unless feed=1", () => {
  const statusFn = server.match(
    /if \(req\.method === "GET" && urlPath === "\/api\/admin\/supplier\/status"\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(statusFn, "supplier status route bulunmalı");
  assert.match(statusFn[1], /includeFeed/);
  assert.match(statusFn[1], /akakceFeedPublicMeta/);
  assert.match(statusFn[1], /akakceFeedFullSummary/);
  assert.doesNotMatch(statusFn[1], /buildAkakceFeedSummary\(mergedProducts\(false\)/);
});

test("supplier refresh does not await category sync on the HTTP response path", () => {
  const refreshFn = server.match(
    /if \(req\.method === "POST" && urlPath === "\/api\/admin\/supplier\/refresh"\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(refreshFn, "supplier refresh route bulunmalı");
  assert.match(refreshFn[1], /enqueueXmlCategorySync\(/);
  assert.doesNotMatch(refreshFn[1], /await enqueueXmlCategorySync/);
  assert.match(refreshFn[1], /categorySyncQueued:\s*true/);
});

test("supplier publish does not block on Akakçe feed analysis", () => {
  const publishFn = server.match(
    /if \(req\.method === "POST" && urlPath === "\/api\/admin\/supplier\/publish"\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(publishFn, "supplier publish route bulunmalı");
  assert.doesNotMatch(publishFn[1], /analyzeAkakceProducts\(mergedProducts/);
  assert.match(publishFn[1], /scheduleAkakceFeedSummaryWarm/);
});

test("publishSupplierSlot uses yielding async category sync", () => {
  const site = fs.readFileSync(path.join(root, "lib", "supplier-site.js"), "utf8");
  assert.match(site, /await syncXmlSiteCategoriesAsync/);
  assert.doesNotMatch(
    site,
    /publishSupplierSlot[\s\S]*const result = syncXmlSiteCategories\(/
  );
});

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

test("supplier status never parses the full product cache", () => {
  const statusFn = supplier.match(/function status\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(statusFn, "status() bulunmalı");
  assert.doesNotMatch(statusFn[1], /getCache\(\)/);
  assert.match(statusFn[1], /settings\.itemCount/);
});

test("multi-supplier decorate does not call status per product", () => {
  const multi = fs.readFileSync(path.join(root, "lib", "multi-supplier.js"), "utf8");
  assert.match(multi, /getDisplayName\(\)/);
  assert.doesNotMatch(
    multi,
    /function decorateListedProduct\([\s\S]*slot\.store\.status\(\)/
  );
  assert.match(multi, /preloadCachesAsync/);
});

test("image mirror skips empty queues and does not always invalidate", () => {
  const mirror = fs.readFileSync(path.join(root, "lib", "product-image-mirror.js"), "utf8");
  assert.match(mirror, /skipped:\s*true/);
  assert.match(server, /Number\(result\.mirrored\) > 0/);
  assert.match(server, /skipIfRecent:\s*true/);
  assert.match(server, /preloadCachesAsync/);
  assert.match(server, /eventLoopLagMs/);
});
