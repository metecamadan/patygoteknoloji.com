"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");
const { stockReadIsFresh } = require("./stock-visibility");

/**
 * Every product the supplier has in stock lands in exactly one bucket. `alert` buckets are
 * gaps the shop did not choose; the others are panel decisions and are only counted.
 */
const BUCKETS = [
  { key: "akakce", label: "Akakçe XML'inde", alert: false, filter: "" },
  { key: "siteonly", label: "Sitede satışta ama Akakçe'ye gitmiyor", alert: true, filter: "feedmissing" },
  { key: "nocat", label: "Site kategorisi eşleşmedi", alert: true, filter: "nocat" },
  { key: "menu", label: "Kategorisi menüde yok", alert: true, filter: "menu" },
  { key: "image", label: "Görseli kullanılamıyor", alert: true, filter: "noimage" },
  { key: "price", label: "Satış fiyatı hesaplanamadı (kur/fiyat)", alert: true, filter: "" },
  { key: "stale", label: "Son 7 günde stok okunamadı", alert: true, filter: "" },
  { key: "inactive", label: "Kategorisi var ama yayına alınmamış", alert: true, filter: "" },
  { key: "critical", label: "Kritik stok eşiğinde (panel ayarı)", alert: false, filter: "" },
  { key: "closed", label: "Panelde kapatılmış", alert: false, filter: "" },
  { key: "unlisted", label: "Listeden kaldırılmış", alert: false, filter: "" },
];

const BUCKET_BY_KEY = new Map(BUCKETS.map((row) => [row.key, row]));
const SAMPLE_LIMIT = 40;
const HISTORY_LIMIT = 60;

function rawStock(row) {
  const n = Number(row && row.stockQty);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function hasSitePath(row) {
  return Boolean(row.siteParent || row.siteMid || row.siteChild);
}

function bucketOf(row, context) {
  if (row.unlisted === true) return "unlisted";
  if (row.active !== true && row.deactivated === true) return "closed";
  if (!stockReadIsFresh(row.lastSuccessfulFetchAt, row.catalogStale, context.now)) return "stale";
  const critical = Number(row.criticalStockQty);
  if (row.catalogStale !== true && Number.isFinite(critical) && rawStock(row) <= critical) return "critical";
  if (row.siteCategoryAssigned !== true) return hasSitePath(row) ? "menu" : "nocat";
  if (row.active !== true) return "inactive";
  if (!(Number(row.salePrice) > 0) || String(row.currency || "TRY").toUpperCase() !== "TRY") return "price";
  if (!context.storefrontIds.has(row.id)) return "image";
  return context.akakceIds.has(row.id) ? "akakce" : "siteonly";
}

/**
 * rows: hydrated supplier rows (all slots). storefrontIds: supplier ids the storefront lists.
 * akakceIds: ids in the Akakçe feed. akakceReasons: id → exclusion reasons for storefront rows.
 */
function reconcileSupplierCatalog(input) {
  const opts = input || {};
  const context = {
    now: opts.now instanceof Date ? opts.now : new Date(),
    storefrontIds: opts.storefrontIds instanceof Set ? opts.storefrontIds : new Set(opts.storefrontIds || []),
    akakceIds: opts.akakceIds instanceof Set ? opts.akakceIds : new Set(opts.akakceIds || []),
  };
  const reasonsById = opts.akakceReasons instanceof Map ? opts.akakceReasons : new Map();
  const buckets = {};
  BUCKETS.forEach((bucket) => {
    buckets[bucket.key] = { count: 0, samples: [] };
  });
  const siteOnlyReasons = {};
  let stocked = 0;
  for (const row of opts.rows || []) {
    if (!row || rawStock(row) <= 0) continue;
    stocked += 1;
    const key = bucketOf(row, context);
    const bucket = buckets[key];
    bucket.count += 1;
    if (key === "siteonly") {
      for (const reason of reasonsById.get(row.id) || ["Feed uygun değil"]) {
        siteOnlyReasons[reason] = (siteOnlyReasons[reason] || 0) + 1;
      }
    }
    if (key !== "akakce" && bucket.samples.length < SAMPLE_LIMIT) {
      bucket.samples.push({
        sku: String(row.supplierSku || ""),
        name: String(row.name || "").slice(0, 120),
        stock: rawStock(row),
      });
    }
  }
  // Samples favour the largest stock: those are the sales the gap costs most.
  Object.values(buckets).forEach((bucket) => bucket.samples.sort((a, b) => b.stock - a.stock));
  return {
    at: context.now.toISOString(),
    stocked,
    buckets,
    siteOnlyReasons,
  };
}

function bucketCounts(result) {
  const out = {};
  BUCKETS.forEach((bucket) => {
    out[bucket.key] = (result && result.buckets && result.buckets[bucket.key] && result.buckets[bucket.key].count) || 0;
  });
  return out;
}

/** A gap bucket alerts when it grows by 5 products or 10 %, whichever is larger. */
function reconcileAlerts(previous, next) {
  if (!previous || !next) return [];
  const before = bucketCounts(previous);
  const after = bucketCounts(next);
  return BUCKETS.filter((bucket) => bucket.alert)
    .map((bucket) => {
      const was = before[bucket.key];
      const now = after[bucket.key];
      return { key: bucket.key, label: bucket.label, was, now, increase: now - was };
    })
    .filter((row) => row.increase >= Math.max(5, Math.ceil(row.was * 0.1)));
}

function buildReconcileAlertMail(alerts, next, siteBase) {
  const base = String(siteBase || "https://patygoteknoloji.com").replace(/\/+$/, "");
  const lines = [
    "Tedarikçide stokta olup sitede veya Akakçe'de olmayan ürün sayısı arttı.",
    "",
  ];
  for (const alert of alerts) {
    lines.push(alert.label + ": " + alert.was + " → " + alert.now + " (+" + alert.increase + ")");
    const samples = ((next.buckets[alert.key] || {}).samples || []).slice(0, 5);
    samples.forEach((row) => lines.push("  - " + row.sku + " · " + row.name + " (stok " + row.stock + ")"));
    lines.push("");
  }
  lines.push("Tedarikçide stokta: " + next.stocked + " ürün; Akakçe XML'inde: " + bucketCounts(next).akakce + ".");
  lines.push("Ayrıntı ve ürün listesi: " + base + "/admin (XML Yönetimi → Stokta ama satışta olmayanlar)");
  return {
    subject: "Patygo: tedarikçide stokta ama satışta olmayan ürün arttı",
    text: lines.join("\n"),
  };
}

function createReconcileStore(root) {
  const file = path.join(root, ".runtime", "supplier-reconcile.json");

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function latest() {
    return read().latest || null;
  }

  /** Saves a run and returns the alerts against the previous one (none on the first run). */
  function record(result) {
    const data = read();
    const previous = data.latest || null;
    const alerts = reconcileAlerts(previous, result);
    const history = Array.isArray(data.history) ? data.history.slice(-(HISTORY_LIMIT - 1)) : [];
    history.push({ at: result.at, stocked: result.stocked, counts: bucketCounts(result) });
    atomicWriteJson(file, { version: 1, latest: result, history, lastAlerts: alerts });
    return { previous, alerts };
  }

  function summary() {
    const data = read();
    return {
      buckets: BUCKETS,
      latest: data.latest || null,
      history: Array.isArray(data.history) ? data.history : [],
      lastAlerts: Array.isArray(data.lastAlerts) ? data.lastAlerts : [],
    };
  }

  return { latest, record, summary };
}

module.exports = {
  BUCKETS,
  BUCKET_BY_KEY,
  bucketOf,
  reconcileSupplierCatalog,
  reconcileAlerts,
  bucketCounts,
  buildReconcileAlertMail,
  createReconcileStore,
};
