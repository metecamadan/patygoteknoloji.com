"use strict";

const fs = require("fs");
const path = require("path");

const TCMB_TODAY = "https://www.tcmb.gov.tr/kurlar/today.xml";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function fxCachePath(root) {
  return path.join(root, ".runtime", "fx-rates.json");
}

function normalizeCurrencyCode(code) {
  const value = String(code || "TRY").trim().toUpperCase();
  if (!value || value === "TL" || value === "TRY" || value === "949") return "TRY";
  if (value === "USD" || value === "840") return "USD";
  if (value === "EUR" || value === "978") return "EUR";
  return value.slice(0, 8);
}

function parseTcmbXml(xml) {
  const rates = {};
  const blockRe = /<Currency\b([^>]*)>([\s\S]*?)<\/Currency>/gi;
  let match;
  while ((match = blockRe.exec(String(xml || "")))) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const kod = String((attrs.match(/\bKod="([^"]+)"/i) || [])[1] || "").toUpperCase();
    const selling = String((body.match(/<ForexSelling>([^<]+)<\/ForexSelling>/i) || [])[1] || "")
      .trim()
      .replace(",", ".");
    const rate = Number(selling);
    if ((kod === "USD" || kod === "EUR") && Number.isFinite(rate) && rate > 0) {
      rates[kod] = rate;
    }
  }
  if (!rates.USD || !rates.EUR) {
    throw new Error("TCMB kur yanıtında USD/EUR satış fiyatı yok.");
  }
  return rates;
}

function readCachedRates(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fxCachePath(root), "utf8"));
    const usd = Number(parsed && parsed.USD);
    const eur = Number(parsed && parsed.EUR);
    if (!(usd > 0) || !(eur > 0)) return null;
    return {
      USD: usd,
      EUR: eur,
      fetchedAt: String((parsed && parsed.fetchedAt) || ""),
      source: String((parsed && parsed.source) || "cache"),
    };
  } catch (_) {
    return null;
  }
}

function writeCachedRates(root, rates) {
  const payload = {
    USD: Number(rates.USD),
    EUR: Number(rates.EUR),
    fetchedAt: rates.fetchedAt || new Date().toISOString(),
    source: rates.source || "tcmb",
  };
  fs.mkdirSync(path.dirname(fxCachePath(root)), { recursive: true });
  const temp = fxCachePath(root) + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(temp, fxCachePath(root));
  return payload;
}

function cacheIsFresh(rates) {
  if (!rates || !rates.fetchedAt) return false;
  const at = Date.parse(rates.fetchedAt);
  return Number.isFinite(at) && Date.now() - at < CACHE_MAX_AGE_MS;
}

function convertCostToTry(amount, currency, rates) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  const code = normalizeCurrencyCode(currency);
  if (code === "TRY") return Math.round(n * 100) / 100;
  const rate = rates && Number(rates[code]);
  if (!(rate > 0)) return null;
  return Math.round(n * rate * 100) / 100;
}

async function refreshRates(root, options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || fetch;
  const timeoutMs = Number(settings.timeoutMs) || 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(TCMB_TODAY, {
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("TCMB kur servisi " + res.status + " yanıtı verdi.");
    const xml = await res.text();
    const parsed = parseTcmbXml(xml);
    return writeCachedRates(root, {
      USD: parsed.USD,
      EUR: parsed.EUR,
      fetchedAt: new Date().toISOString(),
      source: "tcmb",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureRates(root, options) {
  const cached = readCachedRates(root);
  if (cached && (cacheIsFresh(cached) || (options && options.allowStale))) return cached;
  try {
    return await refreshRates(root, options);
  } catch (err) {
    if (cached) return cached;
    throw new Error(err.message || "Döviz kuru alınamadı.");
  }
}

module.exports = {
  TCMB_TODAY,
  normalizeCurrencyCode,
  parseTcmbXml,
  readCachedRates,
  writeCachedRates,
  convertCostToTry,
  refreshRates,
  ensureRates,
};
