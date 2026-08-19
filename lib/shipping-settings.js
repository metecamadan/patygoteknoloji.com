"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeShippingSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const freeShippingThreshold = Math.max(0, Number(input.freeShippingThreshold) || 0);
  const shippingFee = Math.max(0, Number(input.shippingFee) || 0);
  return {
    freeShippingThreshold: round2(freeShippingThreshold),
    shippingFee: round2(shippingFee),
    updatedAt: String(input.updatedAt || "").trim() || null,
  };
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
    return {
      freeShippingThreshold: s.freeShippingThreshold,
      shippingFee: s.shippingFee,
      enabled: s.shippingFee > 0,
    };
  }

  function setSettings(patch) {
    const current = read();
    const next = normalizeShippingSettings(
      Object.assign({}, current, patch || {}, { updatedAt: new Date().toISOString() })
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
  normalizeShippingSettings,
};
