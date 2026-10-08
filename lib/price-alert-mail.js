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

/** options.productPath: site path of the product page (falls back to /urunler). */
function buildReceivedMail(alert, options) {
  const opts = options || {};
  const site = publicSiteBase(opts.env);
  const stopUrl = unsubscribeUrl(site, alert.token);
  const productUrl = site + (opts.productPath || "/urunler");
  const name = alert.productName || "seçtiğiniz ürün";
  const price = formatMoney(alert.basePrice);
  const subject = "Fiyat alarmı talebinizi aldık";
  const text = [
    "Merhaba,",
    "",
    name + " için fiyat alarmı talebinizi aldık. Şu anki fiyat: " + price + ".",
    "Fiyatı düştüğünde veya ürün tükenip yeniden satışa girdiğinde sizi e-postayla bilgilendireceğiz.",
    "",
    "Ürüne git: " + productUrl,
    "",
    "Alarm en fazla 180 gün açık kalır.",
    "Bu talebi siz yapmadıysanız veya artık bildirim almak istemiyorsanız alarmı iptal edin: " + stopUrl,
  ].join("\n");
  const innerHtml =
    '<p style="margin:0 0 12px;font-size:15px;color:#0f172a;"><strong>' +
    escapeHtml(name) +
    "</strong> için fiyat alarmı talebinizi aldık. Şu anki fiyat: " +
    escapeHtml(price) +
    ".</p>" +
    '<p style="margin:0 0 12px;font-size:15px;color:#0f172a;">Fiyatı düştüğünde veya ürün tükenip yeniden satışa girdiğinde sizi e-postayla bilgilendireceğiz.</p>' +
    button(productUrl, "Ürüne git") +
    '<p style="margin:0 0 8px;font-size:13px;color:#64748b;">Alarm en fazla 180 gün açık kalır.</p>' +
    '<p style="margin:0;font-size:12px;color:#94a3b8;">Bu talebi siz yapmadıysanız veya artık bildirim almak istemiyorsanız <a href="' +
    escapeHtml(stopUrl) +
    '" style="color:#64748b;">alarmı iptal edin</a>.</p>';
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

module.exports = { buildReceivedMail, buildNotifyMail, unsubscribeUrl };
