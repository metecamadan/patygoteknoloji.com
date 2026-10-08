"use strict";

const { brandedMailHtml, escapeHtml, publicSiteBase } = require("./contact");
const { absoluteImageUrl, isOwnSiteImage } = require("./product-image-mirror");

function formatMoney(value) {
  return (
    "₺" +
    Number(value || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Only images served from our own domain (mirrored catalog); supplier hosts may block hotlinks from mail clients. */
function mailImageUrl(image, site) {
  const abs = absoluteImageUrl(image, site);
  return abs && isOwnSiteImage(abs, site) ? abs : "";
}

/** Product card: image | name + price line | "Ürüne git" button on the right. */
function productBlock(href, imageUrl, name, priceLine) {
  const imageCell = imageUrl
    ? '<td style="padding:12px;width:80px;vertical-align:middle;"><a href="' +
      escapeHtml(href) +
      '"><img src="' +
      escapeHtml(imageUrl) +
      '" width="80" height="80" alt="' +
      escapeHtml(name) +
      '" style="display:block;width:80px;height:80px;object-fit:contain;border:0;border-radius:8px;background:#ffffff;" /></a></td>'
    : "";
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;"><tr>' +
    imageCell +
    '<td style="padding:12px' +
    (imageUrl ? " 12px 12px 0" : "") +
    ';vertical-align:middle;font-size:14px;line-height:1.4;color:#0f172a;"><a href="' +
    escapeHtml(href) +
    '" style="color:#0f172a;text-decoration:none;font-weight:600;">' +
    escapeHtml(name) +
    '</a><br /><span style="font-size:13px;color:#475569;">' +
    escapeHtml(priceLine) +
    "</span></td>" +
    '<td style="padding:12px 12px 12px 0;width:1%;vertical-align:middle;text-align:right;white-space:nowrap;"><a href="' +
    escapeHtml(href) +
    '" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:10px;">Ürüne git</a></td>' +
    "</tr></table>"
  );
}

function unsubscribeUrl(site, token) {
  return site + "/api/price-alerts/unsubscribe?token=" + encodeURIComponent(token);
}

const RECEIVED_COPY = {
  price: {
    subject: "Fiyat alarmı talebinizi aldık",
    lead: "Aşağıdaki ürün için fiyat alarmı talebinizi aldık.",
    promise: "Fiyatı düştüğünde sizi e-postayla bilgilendireceğiz.",
    ttl: "Alarm en fazla 180 gün açık kalır.",
    cancel: "alarmı iptal edin",
  },
  stock: {
    subject: "Stok bildirimi talebinizi aldık",
    lead: "Aşağıdaki ürün için stok bildirimi talebinizi aldık.",
    promise: "Ürün yeniden stoğa girdiğinde sizi bir kez e-postayla bilgilendireceğiz.",
    ttl: "Talep en fazla 180 gün açık kalır.",
    cancel: "talebi iptal edin",
  },
};

/** options.productPath: product page path (falls back to /urunler); options.productImage: catalog image. */
function buildReceivedMail(alert, options) {
  const opts = options || {};
  const site = publicSiteBase(opts.env);
  const stopUrl = unsubscribeUrl(site, alert.token);
  const productUrl = site + (opts.productPath || "/urunler");
  const name = alert.productName || "seçtiğiniz ürün";
  const stock = alert.kind === "stock";
  const copy = stock ? RECEIVED_COPY.stock : RECEIVED_COPY.price;
  const priceLine = stock ? "Şu anda tükendi" : "Şu anki fiyat: " + formatMoney(alert.basePrice);
  const text = [
    "Merhaba,",
    "",
    copy.lead,
    name + " — " + priceLine + ".",
    copy.promise,
    "",
    "Ürüne git: " + productUrl,
    "",
    copy.ttl,
    "Bu talebi siz yapmadıysanız veya artık bildirim almak istemiyorsanız " + copy.cancel + ": " + stopUrl,
  ].join("\n");
  const innerHtml =
    '<p style="margin:0 0 12px;font-size:15px;color:#0f172a;">' +
    escapeHtml(copy.lead) +
    "</p>" +
    productBlock(productUrl, mailImageUrl(opts.productImage, site), name, priceLine) +
    '<p style="margin:0 0 12px;font-size:15px;color:#0f172a;">' +
    escapeHtml(copy.promise) +
    "</p>" +
    '<p style="margin:0 0 8px;font-size:13px;color:#64748b;">' +
    escapeHtml(copy.ttl) +
    "</p>" +
    '<p style="margin:0;font-size:12px;color:#94a3b8;">Bu talebi siz yapmadıysanız veya artık bildirim almak istemiyorsanız <a href="' +
    escapeHtml(stopUrl) +
    '" style="color:#64748b;">' +
    escapeHtml(copy.cancel) +
    "</a>.</p>";
  return {
    to: alert.email,
    subject: copy.subject,
    text,
    html: brandedMailHtml({ heading: copy.subject, innerHtml, env: opts.env }),
  };
}

/** due: { alert, product: { priceIncl, name, urlPath, image }, kind: "drop" | "back", previousPrice } */
function buildNotifyMail(due, options) {
  const opts = options || {};
  const site = publicSiteBase(opts.env);
  const { alert, product, kind } = due;
  const back = kind === "back";
  const name = product.name || alert.productName || "Takip ettiğiniz ürün";
  const productUrl = site + (product.urlPath || "/urunler");
  const stopUrl = unsubscribeUrl(site, alert.token);
  const price = formatMoney(product.priceIncl);
  const subject = name.slice(0, 100) + (back ? " yeniden stokta" : " fiyatı düştü");
  const lead = back
    ? "Takip ettiğiniz ürün yeniden stokta. Güncel fiyat: " + price + "."
    : name + " fiyatı " + formatMoney(due.previousPrice) + " → " + price + " oldu.";
  const priceLine = back ? "Güncel fiyat: " + price : formatMoney(due.previousPrice) + " → " + price;
  const closing = back
    ? "Bu bildirim tek seferliktir; stok talebiniz kapatıldı."
    : "Bu ürün için bildirim almak istemiyorsanız: " + stopUrl;
  const text = [
    lead,
    "",
    "Ürüne git: " + productUrl,
    "",
    "Stok ve fiyat değişebilir; ödeme adımındaki tutar geçerlidir.",
    closing,
  ].join("\n");
  const innerHtml =
    '<p style="margin:0 0 12px;font-size:15px;color:#0f172a;">' +
    escapeHtml(lead) +
    "</p>" +
    productBlock(productUrl, mailImageUrl(product.image, site), name, priceLine) +
    '<p style="margin:0 0 8px;font-size:13px;color:#64748b;">Stok ve fiyat değişebilir; ödeme adımındaki tutar geçerlidir.</p>' +
    (back
      ? '<p style="margin:0;font-size:12px;color:#94a3b8;">Bu bildirim tek seferliktir; stok talebiniz kapatıldı.</p>'
      : '<p style="margin:0;font-size:12px;color:#94a3b8;"><a href="' +
        escapeHtml(stopUrl) +
        '" style="color:#64748b;">Bu ürün için bildirimleri durdur</a></p>');
  return {
    to: alert.email,
    subject,
    text,
    html: brandedMailHtml({ heading: subject, innerHtml, env: opts.env }),
  };
}

module.exports = { buildReceivedMail, buildNotifyMail, unsubscribeUrl };
