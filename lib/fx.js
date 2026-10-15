"use strict";

const fs = require("fs");
const path = require("path");

const TCMB_TODAY = "https://www.tcmb.gov.tr/kurlar/today.xml";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// TCMB publishes the day's rates around 15:30 Istanbul (UTC+3, no DST); 15:45 leaves a margin.
const DAILY_REFRESH_UTC_MINUTES = 12 * 60 + 45;
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

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
  const rateDate = String((String(xml || "").match(/<Tarih_Date\b[^>]*\bTarih="([^"]+)"/i) || [])[1] || "");
  if (rateDate) rates.rateDate = rateDate;
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
      rateDate: String((parsed && parsed.rateDate) || ""),
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
  if (rates.rateDate) payload.rateDate = String(rates.rateDate);
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

/** Most recent daily publication cutoff at or before `now`. */
function latestDailyCutoff(now) {
  const at = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  const cutoff = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  cutoff.setUTCMinutes(DAILY_REFRESH_UTC_MINUTES);
  if (cutoff.getTime() > at.getTime()) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  return cutoff;
}

/** True when the cache predates today's TCMB publication (or is missing). */
function ratesDueForRefresh(rates, now) {
  if (!rates || !rates.fetchedAt) return true;
  const at = Date.parse(rates.fetchedAt);
  if (!Number.isFinite(at)) return true;
  return at < latestDailyCutoff(now).getTime();
}

/** True when daily refreshes have been failing long enough that prices use an old rate. */
function ratesAreStale(rates, now) {
  if (!rates || !rates.fetchedAt) return true;
  const at = Date.parse(rates.fetchedAt);
  const current = now instanceof Date ? now.getTime() : now == null ? Date.now() : Number(now);
  return !Number.isFinite(at) || current - at > STALE_AFTER_MS;
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
      rateDate: parsed.rateDate,
      fetchedAt: new Date().toISOString(),
      source: "tcmb",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Returns a fresh rate; an old cache is only a fallback when TCMB cannot be reached. */
async function ensureRates(root, options) {
  const cached = readCachedRates(root);
  if (cached && cacheIsFresh(cached)) return cached;
  try {
    return await refreshRates(root, options);
  } catch (err) {
    if (cached && !(options && options.allowStale === false)) return cached;
    throw new Error(err.message || "Döviz kuru alınamadı.");
  }
}

function fxCacheMtime(root) {
  try {
    return fs.statSync(fxCachePath(root)).mtimeMs;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  TCMB_TODAY,
  fxCachePath,
  fxCacheMtime,
  latestDailyCutoff,
  ratesDueForRefresh,
  ratesAreStale,
  normalizeCurrencyCode,
  parseTcmbXml,
  readCachedRates,
  writeCachedRates,
  convertCostToTry,
  refreshRates,
  ensureRates,
};
