"use strict";

const { normalizeVatPercent } = require("./product-fields");

/**
 * Round a TRY amount UP so it ends with X99.99 inside each 1.000 ₺ band.
 * basamak 9 → …999,99; basamak 7 → …799,99; basamak 0 → …099,99.
 */
function applyBasamakGrossPrice(price, basamak) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  // Number(null) === 0 — treat empty as "no basamak", not digit 0.
  if (basamak === null || basamak === undefined || basamak === "") return amount;
  const digit = Number(basamak);
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return amount;
  const cents = Math.round(amount * 100);
  const mod = 100000; // 1.000,00 ₺ in kuruş
  const target = digit * 10000 + 9999; // X99,99
  const rem = ((cents % mod) + mod) % mod;
  let next = cents - rem + target;
  if (next < cents) next += mod;
  return next / 100;
}

/**
 * Storefront prices are net (excl. VAT) but the shopper sees KDV dahil.
 * Round the gross display to X99,99, then convert back to net so the card shows that figure.
 */
function applyBasamakNetPrice(netPrice, vatPercent, basamak) {
  const net = Number(netPrice);
  if (!Number.isFinite(net) || net <= 0) return net;
  if (basamak === null || basamak === undefined || basamak === "") return Math.round(net * 100) / 100;
  const digit = Number(basamak);
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return Math.round(net * 100) / 100;
  const vat = normalizeVatPercent(vatPercent);
  const factor = 1 + vat / 100;
  const gross = Math.round(net * factor * 100) / 100;
  const roundedGross = applyBasamakGrossPrice(gross, digit);
  if (roundedGross === gross) return Math.round(net * 100) / 100;
  return Math.round((roundedGross / factor) * 100) / 100;
}

module.exports = {
  applyBasamakGrossPrice,
  applyBasamakNetPrice,
};
