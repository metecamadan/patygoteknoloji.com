"use strict";

const { normalizeVatPercent } = require("./product-fields");

/**
 * Basamak (0–9): KDV dahil fiyatı yukarı yuvarlar. Dilim fiyata göre büyür;
 * basamak rakamı dilimin "güzel bitiş"inde yer alır.
 *
 * | Fiyat aralığı     | Dilim | Hedef bitiş (basamak D) | Örnek                          |
 * |-------------------|-------|-------------------------|--------------------------------|
 * | < 100 ₺           | 1 ₺   | .D9                     | 8,13 → D=9 → 8,99              |
 * | 100 ₺ – < 1.000 ₺ | 10 ₺  | D,99                    | 131,23 → D=4 → 134,99          |
 * | 1.000 ₺ – < 10.000| 100 ₺ | D9,99                   | 1.234 → D=6 → 1.269,99         |
 * | 10.000 ₺ – < 100k | 1.000 | D99,99                  | 56.567 → D=9 → 56.999,99       |
 * | ≥ 100.000 ₺       | 10.000| D999,99                 | (aynı örüntü)                  |
 *
 * Dilim içindeki hedefe ulaşılmışsa bir sonraki dilime geçilir (yukarı yuvarlama).
 */

/** Band width in TRY for a shopper (gross) price. */
function basamakBandForPrice(amount) {
  const n = Number(amount);
  if (!(n > 0)) return 1;
  if (n < 100) return 1;
  if (n < 1000) return 10;
  if (n < 10000) return 100;
  if (n < 100000) return 1000;
  if (n < 1000000) return 10000;
  return 100000;
}

/** Target offset inside the band for digit D: (D+1)*(band/10) - 0.01 */
function basamakTargetInBand(digit, band) {
  const step = band / 10;
  return Math.round(((digit + 1) * step - 0.01) * 100) / 100;
}

/**
 * Round a TRY amount UP to the basamak ending for its magnitude band.
 */
function applyBasamakGrossPrice(price, basamak) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  // Number(null) === 0 — treat empty as "no basamak", not digit 0.
  if (basamak === null || basamak === undefined || basamak === "") return amount;
  const digit = Number(basamak);
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return amount;

  // Work in kuruş to avoid float drift on rem/target.
  let cents = Math.round(amount * 100);
  // Re-pick band if we spill into the next magnitude (e.g. 99.50 → 99.99 stays; 99.99+ → 100+).
  for (let guard = 0; guard < 4; guard += 1) {
    const current = cents / 100;
    const band = basamakBandForPrice(current);
    const bandCents = Math.round(band * 100);
    const targetCents = Math.round(basamakTargetInBand(digit, band) * 100);
    const rem = ((cents % bandCents) + bandCents) % bandCents;
    let next = cents - rem + targetCents;
    if (next < cents) next += bandCents;
    // If crossing into a larger magnitude band, re-apply with the new band once.
    if (basamakBandForPrice(next / 100) !== band && next > cents) {
      cents = next;
      continue;
    }
    return next / 100;
  }
  return cents / 100;
}

/**
 * Storefront prices are net (excl. VAT) but the shopper sees KDV dahil.
 * Round the gross display with basamak, then convert back to net so charged totals match the card.
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
  basamakBandForPrice,
  basamakTargetInBand,
};
