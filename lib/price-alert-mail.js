"use strict";

const { brandedMailHtml, escapeHtml, publicSiteBase } = require("./contact");

function formatMoney(value) {
  return (
    "₺" +
    Number(value || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function button(href, label) {
  return (
    '<p style="margin:20px 0;"><a href="' +
    escapeHtml(href) +
    '" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;">' +
    escapeHtml(label) +
    "</a></p>"
  );
}

function unsubscribeUrl(site, token) {
  return site + "/api/price-alerts/unsubscribe?token=" + encodeURIComponent(token);
}

function buildConfirmMail(alert, options) {
  const opts = options || {};
  const site = publicSiteBase(opts.env);
  const confirmUrl = site + "/api/price-alerts/confirm?token=" + encodeURIComponent(alert.token);
  const name = alert.productName || "seçtiğiniz ürün";
  const subject = "Fiyat alarmınızı onaylayın";
  const text = [
    "Merhaba,",
    "",
    name + " için fiyat alarmı talebi aldık (şu anki fiyat: " + formatMoney(alert.basePrice) + ").",
    "Alarmı başlatmak için bağlantıya tıklayın:",
    confirmUrl,
    "",
    "Fiyat düştüğünde veya ürün yeniden satışa girdiğinde size e-posta göndereceğiz.",
    "Bu talebi siz yapmadıysanız bu e-postayı yok sayın; onaylanmayan talepler 7 gün sonra silinir.",
  ].join("\n");
  const innerHtml =
    '<p style="margin:0 0 12px;font-size:15px;color:#0f172a;"><strong>' +
    escapeHtml(name) +
    "</strong> için fiyat alarmı talebi aldık. Şu anki fiyat: " +
    escapeHtml(formatMoney(alert.basePrice)) +
    ".</p>" +
    button(confirmUrl, "Alarmı onayla") +
    '<p style="margin:0;font-size:13px;color:#64748b;">Bu talebi siz yapmadıysanız bu e-postayı yok sayın; onaylanmayan talepler 7 gün sonra silinir.</p>';
  return {
    to: alert.email,
    subject,
    text,
    html: brandedMailHtml({ heading: subject, innerHtml, env: opts.env }),
  };
}

/** due: { alert, product: { priceIncl, name, urlPath }, kind: "drop" | "back", previousPrice } */
function buildNotifyMail(due, options) {
  const opts = options || {};
  const site = publicSiteBase(opts.env);
  const { alert, product, kind } = due;
  const name = product.name || alert.productName || "Takip ettiğiniz ürün";
  const productUrl = site + (product.urlPath || "/urunler");
  const stopUrl = unsubscribeUrl(site, alert.token);
  const price = formatMoney(product.priceIncl);
  const subject =
    kind === "back" ? name.slice(0, 100) + " yeniden satışta" : name.slice(0, 100) + " fiyatı düştü";
  const lead =
    kind === "back"
      ? name + " yeniden satışta. Güncel fiyat: " + price + "."
      : name + " fiyatı " + formatMoney(due.previousPrice) + " → " + price + " oldu.";
  const text = [
    lead,
    "",
    "Ürüne git: " + productUrl,
    "",
    "Stok ve fiyat değişebilir; ödeme adımındaki tutar geçerlidir.",
    "Bu ürün için bildirim almak istemiyorsanız: " + stopUrl,
  ].join("\n");
  const innerHtml =
    '<p style="margin:0 0 12px;font-size:15px;color:#0f172a;">' +
    escapeHtml(lead) +
    "</p>" +
    button(productUrl, "Ürüne git") +
    '<p style="margin:0 0 8px;font-size:13px;color:#64748b;">Stok ve fiyat değişebilir; ödeme adımındaki tutar geçerlidir.</p>' +
    '<p style="margin:0;font-size:12px;color:#94a3b8;"><a href="' +
    escapeHtml(stopUrl) +
    '" style="color:#64748b;">Bu ürün için bildirimleri durdur</a></p>';
  return {
    to: alert.email,
    subject,
    text,
    html: brandedMailHtml({ heading: subject, innerHtml, env: opts.env }),
  };
}

module.exports = { buildConfirmMail, buildNotifyMail, unsubscribeUrl };
