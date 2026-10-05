const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAdminCatalogSummary } = require("../lib/admin-catalog-summary");

const NOW = new Date("2026-10-04T12:00:00Z");
const FRESH = "2026-10-04T08:00:00Z";
const OLD = "2026-09-20T08:00:00Z";

function supplierItem(overrides) {
  return Object.assign(
    {
      active: true,
      unlisted: false,
      siteCategoryAssigned: true,
      stockQty: 20,
      criticalStockQty: 3,
      catalogStale: false,
      lastSuccessfulFetchAt: FRESH,
    },
    overrides
  );
}

test("catalog summary buckets supplier stock like the storefront rules", () => {
  const summary = buildAdminCatalogSummary({
    now: NOW,
    manualProducts: [{ active: true }, { active: false }],
    supplierProducts: [
      supplierItem(),
      supplierItem({ stockQty: 3 }),
      supplierItem({ stockQty: 1 }),
      supplierItem({ stockQty: 0 }),
      supplierItem({ stockQty: null }),
      supplierItem({ lastSuccessfulFetchAt: OLD }),
      supplierItem({ active: false, stockQty: 1 }),
      supplierItem({ unlisted: true }),
      supplierItem({ siteCategoryAssigned: false }),
    ],
    storefrontCount: 4,
    slots: [
      { configured: true, criticalStockQty: 3, lastFetchStatus: "ok", lastSuccessfulFetchAt: FRESH },
      { configured: false, criticalStockQty: 0 },
      { configured: false, criticalStockQty: 0 },
    ],
  });
  assert.equal(summary.totalCount, 11);
  assert.equal(summary.manualCount, 2);
  assert.equal(summary.manualActiveCount, 1);
  assert.equal(summary.supplierCount, 9);
  assert.equal(summary.supplierPublishedCount, 7);
  assert.equal(summary.siteActiveCount, 4);
  assert.equal(summary.criticalStockCount, 2);
  assert.deepEqual(summary.criticalStockThresholds, [3]);
  assert.equal(summary.outOfStockCount, 2);
  assert.equal(summary.staleStockCount, 1);
  assert.equal(summary.unlistedCount, 2);
  assert.deepEqual(summary.xml, {
    connected: 1,
    total: 3,
    failing: 0,
    stale: 0,
    lastSuccessfulFetchAt: FRESH,
  });
});

test("frozen catalog does not count low stock as critical", () => {
  const summary = buildAdminCatalogSummary({
    now: NOW,
    supplierProducts: [supplierItem({ stockQty: 2, catalogStale: true })],
    slots: [{ configured: true, criticalStockQty: 3, lastFetchStatus: "error", catalogStale: true }],
  });
  assert.equal(summary.criticalStockCount, 0);
  assert.equal(summary.outOfStockCount, 0);
  assert.equal(summary.xml.failing, 1);
  assert.equal(summary.xml.stale, 1);
});

test("no critical threshold means no critical bucket", () => {
  const summary = buildAdminCatalogSummary({
    now: NOW,
    supplierProducts: [supplierItem({ stockQty: 1, criticalStockQty: 0 })],
    slots: [{ configured: true, criticalStockQty: 0 }],
  });
  assert.equal(summary.criticalStockCount, 0);
  assert.deepEqual(summary.criticalStockThresholds, []);
});

test("empty input yields zeroed summary", () => {
  const summary = buildAdminCatalogSummary();
  assert.equal(summary.totalCount, 0);
  assert.equal(summary.siteActiveCount, 0);
  assert.deepEqual(summary.xml, {
    connected: 0,
    total: 0,
    failing: 0,
    stale: 0,
    lastSuccessfulFetchAt: null,
  });
});
