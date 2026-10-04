"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

const MIN_INSTALLMENT_COUNT = 2;
const MAX_INSTALLMENT_COUNT = 12;
const MAX_RATE_PERCENT = 100;

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeOption(row) {
  const count = Math.trunc(Number(row && row.count));
  const rate = row && row.ratePercent !== "" && row.ratePercent != null ? Number(row.ratePercent) : NaN;
  if (!Number.isInteger(count) || count < MIN_INSTALLMENT_COUNT || count > MAX_INSTALLMENT_COUNT) return null;
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE_PERCENT) return null;
  return { count, ratePercent: round2(rate) };
}

function normalizeInstallmentSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const byCount = new Map();
  (Array.isArray(input.options) ? input.options : []).forEach((row) => {
    const option = normalizeOption(row);
    if (option && !byCount.has(option.count)) byCount.set(option.count, option);
  });
  const options = Array.from(byCount.values()).sort((a, b) => a.count - b.count);
  return {
    enabled: Boolean(input.enabled) && options.length > 0,
    minAmount: round2(Math.max(0, Number(input.minAmount) || 0)),
    options,
    updatedAt: String(input.updatedAt || "").trim() || null,
  };
}

/** Taksit seçenekleri: toplam = tutar × (1 + vade farkı %), aylık = toplam / taksit sayısı. */
function quoteInstallments(amount, settings) {
  const cfg = normalizeInstallmentSettings(settings);
  const base = round2(amount);
  if (!cfg.enabled || !(base > 0) || base < cfg.minAmount) return [];
  return cfg.options.map((option) => {
    const total = round2(base * (1 + option.ratePercent / 100));
    return {
      count: option.count,
      ratePercent: option.ratePercent,
      total,
      monthly: round2(total / option.count),
    };
  });
}

/** null = tek çekim; seçilen taksit ayarlarda yoksa hata (istemci tutarı belirleyemez). */
function resolveInstallment(amount, installCount, settings) {
  const count = Math.trunc(Number(installCount) || 1);
  if (count <= 1) return null;
  const quote = quoteInstallments(amount, settings).find((row) => row.count === count);
  if (!quote) throw new Error("Seçilen taksit seçeneği bu sipariş için geçerli değil. Lütfen yeniden seçin.");
  return {
    count: quote.count,
    ratePercent: quote.ratePercent,
    baseTotal: round2(amount),
    surcharge: round2(quote.total - round2(amount)),
    total: quote.total,
  };
}

function createInstallmentSettingsStore(root) {
  const file = path.join(root, ".runtime", "installment-settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  function read() {
    try {
      if (!fs.existsSync(file)) return normalizeInstallmentSettings({});
      return normalizeInstallmentSettings(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (_) {
      return normalizeInstallmentSettings({});
    }
  }

  function getPublic() {
    const s = read();
    if (!s.enabled) return { enabled: false, minAmount: 0, options: [] };
    return { enabled: true, minAmount: s.minAmount, options: s.options };
  }

  function setSettings(patch) {
    const input = patch && typeof patch === "object" ? patch : {};
    if (Array.isArray(input.options)) {
      const invalid = input.options.find((row) => !normalizeOption(row));
      if (invalid) {
        throw new Error(
          "Taksit sayısı " +
            MIN_INSTALLMENT_COUNT +
            "–" +
            MAX_INSTALLMENT_COUNT +
            " arasında, vade farkı %0–%" +
            MAX_RATE_PERCENT +
            " arasında olmalı."
        );
      }
    }
    const current = read();
    const next = normalizeInstallmentSettings({
      enabled: input.enabled !== undefined ? input.enabled : current.enabled,
      minAmount: input.minAmount !== undefined ? input.minAmount : current.minAmount,
      options: Array.isArray(input.options) ? input.options : current.options,
      updatedAt: new Date().toISOString(),
    });
    if (input.enabled && !next.options.length) {
      throw new Error("Taksiti açmak için en az bir taksit seçeneği girin.");
    }
    atomicWriteJson(file, next);
    return next;
  }

  return { getSettings: read, getPublic, setSettings, file };
}

module.exports = {
  MIN_INSTALLMENT_COUNT,
  MAX_INSTALLMENT_COUNT,
  createInstallmentSettingsStore,
  normalizeInstallmentSettings,
  quoteInstallments,
  resolveInstallment,
};
