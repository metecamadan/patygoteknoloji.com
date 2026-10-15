const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  reconcileSupplierCatalog,
  reconcileAlerts,
  buildReconcileAlertMail,
  createReconcileStore,
  bucketCounts,
} = require("../lib/supplier-reconcile");

const NOW = new Date("2026-10-15T13:00:00Z");
const FRESH = "2026-10-15T08:00:00Z";

function row(id, extra) {
  return Object.assign(
    {
      id,
      supplierSku: id.toUpperCase(),
      name: "Ürün " + id,
      stockQty: 10,
      criticalStockQty: 2,
      active: true,
      deactivated: false,
      unlisted: false,
      siteCategoryAssigned: true,
      siteParent: "bilgisayar-tablet",
      siteChild: "tabletler",
      salePrice: 100,
      currency: "TRY",
      lastSuccessfulFetchAt: FRESH,
      catalogStale: false,
    },
    extra || {}
  );
}

test("every stocked supplier product lands in exactly one reason bucket", () => {
  const rows = [
    row("ok"),
    row("site"),
    row("nocat", { siteCategoryAssigned: false, siteParent: "", siteChild: "", active: false }),
    row("menu", { siteCategoryAssigned: false }),
    row("img"),
    row("fx", { salePrice: 0, currency: "USD" }),
    row("crit", { stockQty: 2 }),
    row("closed", { active: false, deactivated: true }),
    row("gone", { unlisted: true }),
    row("waiting", { active: false }),
    row("stale", { lastSuccessfulFetchAt: "2026-10-01T08:00:00Z" }),
    row("zero", { stockQty: 0 }),
  ];
  const result = reconcileSupplierCatalog({
    rows,
    now: NOW,
    storefrontIds: new Set(["ok", "site"]),
    akakceIds: new Set(["ok"]),
    akakceReasons: new Map([["site", ["Barkod eksik"]]]),
  });
  assert.equal(result.stocked, 11, "stock 0 is not a gap");
  assert.deepEqual(bucketCounts(result), {
    akakce: 1,
    siteonly: 1,
    nocat: 1,
    menu: 1,
    image: 1,
    price: 1,
    stale: 1,
    inactive: 1,
    critical: 1,
    closed: 1,
    unlisted: 1,
  });
  assert.deepEqual(result.siteOnlyReasons, { "Barkod eksik": 1 });
  assert.equal(result.buckets.akakce.samples.length, 0, "published products are not listed");
  assert.equal(result.buckets.nocat.samples[0].sku, "NOCAT");
});

test("samples list the largest stock first", () => {
  const result = reconcileSupplierCatalog({
    rows: [
      row("a", { siteCategoryAssigned: false, siteParent: "", siteChild: "", stockQty: 4 }),
      row("b", { siteCategoryAssigned: false, siteParent: "", siteChild: "", stockQty: 644 }),
    ],
    now: NOW,
  });
  assert.deepEqual(result.buckets.nocat.samples.map((s) => s.sku), ["B", "A"]);
});

test("alerts fire only for gap buckets that grow by at least 5 or 10 %", () => {
  const counts = (over) => ({
    buckets: Object.fromEntries(
      Object.entries(Object.assign({ akakce: 4700, nocat: 100, image: 7, critical: 1800 }, over)).map(([k, v]) => [
        k,
        { count: v, samples: [] },
      ])
    ),
  });
  assert.deepEqual(reconcileAlerts(null, counts({})), [], "first run is the baseline");
  assert.deepEqual(reconcileAlerts(counts({}), counts({ critical: 2400, akakce: 4000 })), [], "decisions never alert");
  assert.deepEqual(reconcileAlerts(counts({}), counts({ nocat: 109 })), [], "below 10 %");
  const alerts = reconcileAlerts(counts({}), counts({ nocat: 110, image: 12 }));
  assert.deepEqual(
    alerts.map((a) => [a.key, a.was, a.now]),
    [
      ["nocat", 100, 110],
      ["image", 7, 12],
    ]
  );
});

test("alert mail names the grown buckets, sample products and the panel", () => {
  const next = reconcileSupplierCatalog({
    rows: [row("b", { siteCategoryAssigned: false, siteParent: "", siteChild: "", stockQty: 644, name: "Elba Harici DVD" })],
    now: NOW,
  });
  const mail = buildReconcileAlertMail(
    [{ key: "nocat", label: "Site kategorisi eşleşmedi", was: 0, now: 1, increase: 1 }],
    next,
    "https://patygoteknoloji.com/"
  );
  assert.match(mail.subject, /stokta/);
  assert.match(mail.text, /Site kategorisi eşleşmedi: 0 → 1 \(\+1\)/);
  assert.match(mail.text, /B · Elba Harici DVD \(stok 644\)/);
  assert.match(mail.text, /https:\/\/patygoteknoloji\.com\/admin/);
});

test("store keeps the latest run, a count history and alerts against the previous run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-reconcile-"));
  try {
    const store = createReconcileStore(root);
    const nocat = (n) =>
      reconcileSupplierCatalog({
        rows: Array.from({ length: n }, (_, i) =>
          row("p" + i, { siteCategoryAssigned: false, siteParent: "", siteChild: "" })
        ),
        now: NOW,
      });
    assert.deepEqual(store.record(nocat(10)).alerts, []);
    const second = store.record(nocat(20));
    assert.deepEqual(second.alerts.map((a) => a.key), ["nocat"]);
    const summary = store.summary();
    assert.equal(summary.latest.buckets.nocat.count, 20);
    assert.equal(summary.history.length, 2);
    assert.equal(summary.history[1].counts.nocat, 20);
    assert.equal(summary.lastAlerts[0].increase, 10);
    assert.ok(summary.buckets.some((b) => b.key === "critical" && b.alert === false));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
