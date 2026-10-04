"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

const DEFAULT_DISPATCH_BUSINESS_DAYS = 2;
const MAX_DISPATCH_BUSINESS_DAYS = 10;
const MAX_CLOSED_DAYS = 120;

function normalizeDispatchBusinessDays(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_DISPATCH_BUSINESS_DAYS;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_DISPATCH_BUSINESS_DAYS;
  return Math.min(MAX_DISPATCH_BUSINESS_DAYS, Math.max(1, n));
}

/** Accepts an array or newline/comma separated text of YYYY-MM-DD dates (bayram, envanter günü vb.). */
function normalizeClosedDays(value) {
  const parts = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  const days = new Set();
  for (const part of parts) {
    const text = String(part || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) continue;
    const parsed = new Date(text + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) continue;
    days.add(text);
  }
  return Array.from(days).sort().slice(-MAX_CLOSED_DAYS);
}

function normalizeShippingSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const freeShippingThreshold = Math.max(0, Number(input.freeShippingThreshold) || 0);
  const shippingFee = Math.max(0, Number(input.shippingFee) || 0);
  const minOrderAmount = Math.max(0, Number(input.minOrderAmount) || 0);
  return {
    freeShippingThreshold: round2(freeShippingThreshold),
    shippingFee: round2(shippingFee),
    minOrderAmount: round2(minOrderAmount),
    dispatchBusinessDays: normalizeDispatchBusinessDays(input.dispatchBusinessDays),
    closedDays: normalizeClosedDays(input.closedDays),
    updatedAt: String(input.updatedAt || "").trim() || null,
  };
}

/** Kargo hariç, KDV dahil ürün tutarı minimumun altındaysa eksik kalan tutar; değilse 0. */
function minimumOrderShortfall(merchandiseTotalInclVat, settings) {
  const cfg = normalizeShippingSettings(settings);
  if (cfg.minOrderAmount <= 0) return 0;
  return Math.max(0, round2(cfg.minOrderAmount - round2(merchandiseTotalInclVat)));
}

function formatTry(value) {
  return (
    "₺" + round2(value).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function minimumOrderError(merchandiseTotalInclVat, settings) {
  const shortfall = minimumOrderShortfall(merchandiseTotalInclVat, settings);
  if (shortfall <= 0) return null;
  const cfg = normalizeShippingSettings(settings);
  return (
    "Minimum sepet tutarı " +
    formatTry(cfg.minOrderAmount) +
    " (KDV dahil, kargo hariç). Siparişi tamamlamak için " +
    formatTry(shortfall) +
    " daha ürün ekleyin."
  );
}

/** merchandiseTotalInclVat = ürün ara toplam + KDV (KDV dahil sepet tutarı) */
function computeShippingFee(merchandiseTotalInclVat, settings) {
  const cfg = normalizeShippingSettings(settings);
  if (cfg.shippingFee <= 0) return 0;
  const merch = round2(merchandiseTotalInclVat);
  if (cfg.freeShippingThreshold > 0 && merch >= cfg.freeShippingThreshold) return 0;
  return cfg.shippingFee;
}

function createShippingSettingsStore(root) {
  const file = path.join(root, ".runtime", "shipping-settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  function read() {
    try {
      if (!fs.existsSync(file)) return normalizeShippingSettings({});
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      return normalizeShippingSettings(saved);
    } catch (_) {
      return normalizeShippingSettings({});
    }
  }

  function getSettings() {
    return read();
  }

  function getPublic() {
    const s = read();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return {
      freeShippingThreshold: s.freeShippingThreshold,
      shippingFee: s.shippingFee,
      minOrderAmount: s.minOrderAmount,
      enabled: s.shippingFee > 0,
      dispatchBusinessDays: s.dispatchBusinessDays,
      closedDays: s.closedDays.filter((day) => day >= yesterday),
    };
  }

  function setSettings(patch) {
    const current = read();
    const provided = Object.fromEntries(
      Object.entries(patch || {}).filter(([, value]) => value !== undefined)
    );
    const next = normalizeShippingSettings(
      Object.assign({}, current, provided, { updatedAt: new Date().toISOString() })
    );
    if (next.freeShippingThreshold > 0 && next.shippingFee <= 0) {
      throw new Error("Ücretsiz kargo eşiği tanımlıysa kargo bedeli de girilmelidir.");
    }
    atomicWriteJson(file, next);
    return next;
  }

  return { getSettings, getPublic, setSettings, file };
}

module.exports = {
  createShippingSettingsStore,
  computeShippingFee,
  minimumOrderShortfall,
  minimumOrderError,
  normalizeShippingSettings,
  normalizeClosedDays,
  DEFAULT_DISPATCH_BUSINESS_DAYS,
};
