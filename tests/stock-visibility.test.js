const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STOCK_READ_MAX_AGE_MS,
  stockReadIsFresh,
  isSupplierOfferLive,
} = require("../lib/stock-visibility");

test("stock visibility uses a rolling 7-day read window", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  assert.equal(STOCK_READ_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(stockReadIsFresh(now.toISOString(), false, now), true);
  assert.equal(
    stockReadIsFresh(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(), true, now),
    true
  );
  assert.equal(
    stockReadIsFresh(new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(), false, now),
    false
  );
  assert.equal(stockReadIsFresh("", true, now), false);
  assert.equal(stockReadIsFresh("", false, now), true);
});

test("supplier offer stays live only with fresh stock greater than zero", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const fresh = now.toISOString();
  const stale = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(
    isSupplierOfferLive({ stockQty: 4, lastSuccessfulFetchAt: fresh }, now),
    true
  );
  assert.equal(
    isSupplierOfferLive({ stockQty: 0, lastSuccessfulFetchAt: fresh }, now),
    false
  );
  assert.equal(
    isSupplierOfferLive({ stockQty: 9, catalogStale: true, lastSuccessfulFetchAt: stale }, now),
    false
  );
  assert.equal(
    isSupplierOfferLive({ stockQty: 2, criticalStockQty: 5, lastSuccessfulFetchAt: fresh }, now),
    false
  );
});
