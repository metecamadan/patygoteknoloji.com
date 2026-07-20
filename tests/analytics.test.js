const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAnalyticsStore } = require("../lib/analytics");

test("analytics aggregates traffic, unique visitors and conversion rate", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-analytics-"));
  let now = new Date("2026-07-20T12:00:00.000Z");
  const store = createAnalyticsStore(root, { now: () => now });
  try {
    store.record({ type: "page_view", path: "/urunler.html?utm=x", sessionId: "session-a" });
    store.record({ type: "page_view", path: "/urun-detay.html", sessionId: "session-a" });
    store.record({ type: "page_view", path: "/", sessionId: "session-b" });
    store.record({ type: "add_to_cart", path: "/urunler.html", sessionId: "session-a" });
    store.record({ type: "checkout_started", path: "/odeme.html", sessionId: "session-a" });
    store.record({ type: "order_submitted", path: "/odeme.html", sessionId: "session-a" });
    store.record({ type: "lead_submitted", path: "/iletisim.html", sessionId: "session-b" });

    const summary = store.summary(30);
    assert.equal(summary.pageViews, 3);
    assert.equal(summary.visitors, 2);
    assert.equal(summary.addToCart, 1);
    assert.equal(summary.checkoutStarted, 1);
    assert.equal(summary.conversions, 2);
    assert.equal(summary.conversionRate, 100);
    assert.deepEqual(summary.topPages[0], { path: "/urunler.html", views: 1 });
    assert.equal(summary.daily.length, 30);

    const raw = fs.readFileSync(path.join(root, ".runtime", "analytics.json"), "utf8");
    assert.doesNotMatch(raw, /session-a|session-b|utm=x/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("analytics reports current-period comparison and rejects unknown events", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-analytics-compare-"));
  let now = new Date("2026-06-15T12:00:00.000Z");
  const store = createAnalyticsStore(root, { now: () => now });
  try {
    store.record({ type: "page_view", path: "/", sessionId: "old-session" });
    now = new Date("2026-07-20T12:00:00.000Z");
    store.record({ type: "page_view", path: "/", sessionId: "new-a" });
    store.record({ type: "page_view", path: "/", sessionId: "new-b" });

    const summary = store.summary(30);
    assert.equal(summary.comparison.pageViewsPercent, 100);
    assert.equal(summary.comparison.visitorsPercent, 100);
    assert.throws(
      () => store.record({ type: "email_address", path: "/", sessionId: "x" }),
      /Analitik olayı geçersiz/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
