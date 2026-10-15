"use strict";

/**
 * Column sets for the admin "Excel'e aktar" downloads under Ürünler. Each column reads one
 * product (or request) and returns a number, text or boolean; lib/xlsx.js writes the sheet.
 */
const { priceInclVat } = require("./product-fields");

const DATE_FORMAT = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function dateText(value) {
  if (!value) return "";
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? DATE_FORMAT.format(at) : "";
}

const HTML_ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

function plainText(value) {
  return text(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => HTML_ENTITIES[m])
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function absoluteUrl(url, siteBaseUrl) {
  const value = text(url);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = text(siteBaseUrl).replace(/\/+$/, "");
  return value.startsWith("/") ? base + value : value;
}

function imagesOf(product) {
  const list = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  if (!list.length && product.image) list.push(product.image);
  return list;
}

function inclVat(net, vat) {
  const n = num(net);
  return n !== null && n > 0 ? priceInclVat(n, vat) : null;
}

const SITE_STATE_LABELS = { live: "Satışta", soldout: "Tükendi (sayfa açık)" };

function siteColumns() {
  return [
    { header: "Site durumu", width: 18, value: (p, ctx) => SITE_STATE_LABELS[ctx.siteState(p).state] || "Sitede yok" },
    {
      header: "Site linki",
      width: 48,
      value: (p, ctx) => {
        const state = ctx.siteState(p);
        return state.path ? absoluteUrl(state.path, ctx.siteBaseUrl) : "";
      },
    },
  ];
}

function imageColumns() {
  return [
    { header: "Görsel sayısı", width: 10, value: (p) => imagesOf(p).length },
    { header: "Ana görsel", width: 48, value: (p, ctx) => absoluteUrl(imagesOf(p)[0], ctx.siteBaseUrl) },
    {
      header: "Tüm görseller",
      width: 60,
      value: (p, ctx) => imagesOf(p).map((url) => absoluteUrl(url, ctx.siteBaseUrl)).join("\n"),
    },
  ];
}

const MARGIN_SOURCE_LABELS = { product: "Ürüne özel", category: "Taban + kategori", global: "Taban" };

function unlistedReason(p) {
  if (p.unlisted === true) return "Listeden çıkarıldı" + (p.unlistedReason ? ": " + p.unlistedReason : "");
  if (p.menuMissing) return "Menüde kategorisi yok";
  if (p.categoryUnmatched) return "Kategori eşleşmedi";
  return "";
}

const SUPPLIER_COLUMNS = [
  { header: "Ürün ID", width: 20, value: (p) => text(p.id) },
  { header: "Stok kodu", width: 16, value: (p) => text(p.supplierSku) },
  { header: "Ürün adı", width: 50, value: (p) => text(p.name) },
  { header: "Marka", width: 16, value: (p) => text(p.brand) },
  { header: "XML kaynağı", width: 20, value: (p) => text(p.supplierName || p.supplierSlot) },
  { header: "Panel durumu", width: 12, value: (p) => (p.active ? "Aktif" : "Pasif") },
  ...siteColumns(),
  { header: "Listelenmeme nedeni", width: 28, value: unlistedReason },
  { header: "Stok", width: 8, value: (p) => num(p.stockQty) },
  { header: "Kritik stok", width: 10, value: (p) => num(p.criticalStockQty) },
  {
    header: "Kritik stok kaynağı",
    width: 26,
    value: (p) =>
      p.criticalStockSource === "category" ? "Kategori: " + text(p.criticalStockCategory) : "Genel ayar",
  },
  { header: "Maliyet (XML)", width: 14, type: "money", value: (p) => num(p.sourceCostPrice) },
  { header: "XML para birimi", width: 10, value: (p) => text(p.sourceCurrency) },
  { header: "Maliyet (TCMB kuruyla)", width: 14, type: "money", value: (p) => (p.fxReady ? num(p.tcmbCostTry) : null) },
  { header: "Kur payı %", width: 9, value: (p) => num(p.fxBufferPercent) },
  { header: "Maliyet (TL)", width: 14, type: "money", value: (p) => (p.fxReady ? num(p.costPrice) : null) },
  { header: "Taban marj %", width: 10, value: (p) => num(p.marginBasePercent) },
  { header: "Kategori ek marj %", width: 12, value: (p) => num(p.categoryMarginPercent) },
  { header: "Marj kategorisi", width: 22, value: (p) => text(p.marginCategory) },
  { header: "Ürüne özel marj %", width: 12, value: (p) => num(p.marginOverride) },
  { header: "Uygulanan marj %", width: 12, value: (p) => num(p.marginPercent) },
  { header: "Marj kaynağı", width: 16, value: (p) => MARGIN_SOURCE_LABELS[p.marginSource] || "" },
  { header: "Elle satış fiyatı (KDV hariç)", width: 16, type: "money", value: (p) => num(p.salePriceOverride) },
  { header: "Satış fiyatı (KDV hariç)", width: 16, type: "money", value: (p) => num(p.salePrice) },
  { header: "KDV %", width: 8, value: (p) => num(p.vatPercent) },
  { header: "Satış fiyatı (KDV dahil)", width: 16, type: "money", value: (p) => inclVat(p.salePrice, p.vatPercent) },
  { header: "Barkod", width: 16, value: (p) => text(p.barcode) },
  { header: "Üretici kodu", width: 18, value: (p) => text(p.manufacturerCode) },
  { header: "GTIP kodu", width: 14, value: (p) => text(p.gtipCode) },
  { header: "Özel kod", width: 12, value: (p) => text(p.specialCode) },
  { header: "Birim", width: 8, value: (p) => text(p.unit) },
  { header: "Site kategorisi", width: 40, value: (p) => (p.siteCategoryAssigned ? text(p.siteCategoryLabel) : "") },
  {
    header: "Site kategori kodu",
    width: 40,
    value: (p) => [p.siteParent, p.siteMid, p.siteChild].map(text).filter(Boolean).join(" / "),
  },
  { header: "Kategori elle seçildi", width: 12, value: (p) => p.siteCategoryManual === true },
  { header: "XML ana kategori", width: 26, value: (p) => text(p.xmlMainCategory || p.mainCategory) },
  { header: "XML ara kategori", width: 26, value: (p) => text(p.xmlMidCategory || p.midCategory) },
  { header: "XML alt kategori", width: 26, value: (p) => text(p.xmlSubCategory || p.subCategory) },
  {
    header: "Akakçe",
    width: 10,
    value: (p) => (p.feedReady === true ? "Hazır" : p.feedReady === false ? "Eksik" : ""),
  },
  {
    header: "Akakçe eksikleri",
    width: 40,
    value: (p) => (Array.isArray(p.feedIssues) ? p.feedIssues.join("; ") : ""),
  },
  ...imageColumns(),
  { header: "Görsel elle yüklendi", width: 12, value: (p) => p.imageOverride === true },
  { header: "Kısa açıklama", width: 60, value: (p) => plainText(p.description) },
  { header: "Detaylı açıklama", width: 80, value: (p) => plainText(p.details) },
  { header: "URL kısa adı", width: 30, value: (p) => text(p.urlSlug) },
  { header: "Son XML okuma", width: 17, value: (p) => dateText(p.lastSuccessfulFetchAt) },
  { header: "Listeden çıkarılma tarihi", width: 17, value: (p) => dateText(p.unlistedAt) },
];

const MANUAL_COLUMNS = [
  { header: "Ürün kodu", width: 24, value: (p) => text(p.id) },
  { header: "Ürün adı", width: 50, value: (p) => text(p.name) },
  { header: "Marka", width: 16, value: (p) => text(p.brand) },
  { header: "Panel durumu", width: 12, value: (p) => (p.active === false ? "Pasif" : "Yayında") },
  ...siteColumns(),
  { header: "Stok", width: 8, value: (p) => num(p.stockQty) },
  { header: "Fiyat (KDV hariç)", width: 16, type: "money", value: (p) => num(p.price) },
  { header: "KDV %", width: 8, value: (p) => num(p.vatPercent) },
  { header: "Fiyat (KDV dahil)", width: 16, type: "money", value: (p) => inclVat(p.price, p.vatPercent) },
  { header: "Para birimi", width: 10, value: (p) => text(p.currency) },
  { header: "Birim", width: 8, value: (p) => text(p.unit) },
  { header: "Barkod", width: 16, value: (p) => text(p.barcode) },
  { header: "Üretici kodu", width: 18, value: (p) => text(p.manufacturerCode) },
  { header: "GTIP kodu", width: 14, value: (p) => text(p.gtipCode) },
  { header: "Özel kod", width: 12, value: (p) => text(p.specialCode) },
  { header: "Site kategorisi", width: 40, value: (p, ctx) => ctx.categoryLabel(p) },
  {
    header: "Site kategori kodu",
    width: 40,
    value: (p) => [p.siteParent || p.category, p.siteMid, p.siteChild].map(text).filter(Boolean).join(" / "),
  },
  { header: "Akakçe ana kategori", width: 26, value: (p) => text(p.mainCategory) },
  { header: "Akakçe ara kategori", width: 26, value: (p) => text(p.midCategory) },
  { header: "Akakçe alt kategori", width: 26, value: (p) => text(p.subCategory) },
  { header: "Ana sayfada", width: 10, value: (p) => p.featured === true },
  ...imageColumns(),
  { header: "Kısa açıklama", width: 60, value: (p) => plainText(p.description) },
  { header: "Detaylı açıklama", width: 80, value: (p) => plainText(p.details) },
  { header: "URL kısa adı", width: 30, value: (p) => text(p.urlSlug) },
  { header: "Stoğa giriş tarihi", width: 17, value: (p) => dateText(p.restockedAt) },
];

const NO_IMAGE_STATE_LABELS = { missing: "XML'de görsel yok", broken: "Görsel açılmıyor" };

const NO_IMAGE_COLUMNS = [
  { header: "XML görsel durumu", width: 20, value: (p) => NO_IMAGE_STATE_LABELS[p.xmlImageState] || text(p.xmlImageState) },
].concat(SUPPLIER_COLUMNS);

const IMAGE_STATUS_LABELS = {
  whitened: "Beyaz zemin kullanılıyor",
  rejected: "Kalite kontrolünden geçemedi",
  reverted: "Orijinale döndürüldü",
  applied: "Resmî görsel kullanılıyor",
  "official-reverted": "Resmî görselden orijinale döndürüldü",
};

/** Rows are { image, product }: one row per product using that image file. */
function imageDecisionColumns(official) {
  const imageCols = [
    { header: "Görsel dosyası", width: 34, value: (row) => text(row.image.file) },
    {
      header: "Görsel durumu",
      width: 30,
      value: (row) =>
        IMAGE_STATUS_LABELS[official && row.image.status === "reverted" ? "official-reverted" : row.image.status] ||
        text(row.image.status),
    },
    { header: "Karar tarihi", width: 17, value: (row) => dateText(row.image.at) },
    { header: "Kararı veren", width: 18, value: (row) => text(row.image.decidedBy) },
  ];
  if (official) {
    imageCols.push(
      { header: "Resmî görsel kaynağı", width: 20, value: (row) => text(row.image.source) },
      { header: "Kaynak sayfa", width: 48, value: (row) => text(row.image.pageUrl) }
    );
  }
  imageCols.push(
    { header: "Orijinal görsel", width: 48, value: (row, ctx) => absoluteUrl(row.image.original, ctx.siteBaseUrl) },
    {
      header: official ? "Resmî görsel" : "Beyaz zeminli görsel",
      width: 48,
      value: (row, ctx) => absoluteUrl(official ? row.image.official : row.image.white, ctx.siteBaseUrl),
    }
  );
  return imageCols.concat(
    SUPPLIER_COLUMNS.map((column) => ({
      header: column.header,
      width: column.width,
      type: column.type,
      value: (row, ctx) => column.value(row.product, ctx),
    }))
  );
}

const ALERT_PRODUCT_STATE_LABELS = { live: "Satışta", soldout: "Tükendi", gone: "Sitede yok" };

/** Rows are { group, request, product }: one row per customer request. */
function alertColumns(kind) {
  const cols = [
    { header: "Talep no", width: 9, value: (row) => num(row.request.id) },
    { header: "E-posta", width: 30, value: (row) => text(row.request.email) },
    { header: "Talep tarihi", width: 17, value: (row) => dateText(row.request.createdAt) },
  ];
  if (kind === "price") {
    cols.push(
      { header: "Talepteki fiyat", width: 14, type: "money", value: (row) => num(row.request.basePrice) },
      {
        header: "Hedef fiyat",
        width: 14,
        type: "money",
        value: (row) => num(row.request.targetPrice) || "%2 düşüş",
      }
    );
  }
  cols.push(
    {
      header: "Talep durumu",
      width: 12,
      value: (row) => (row.request.status === "notified" ? "Bildirildi" : kind === "stock" ? "Bekliyor" : "Takipte"),
    },
    { header: "Bildirim sayısı", width: 10, value: (row) => num(row.request.notifyCount) || 0 },
    { header: "Son bildirim", width: 17, value: (row) => dateText(row.request.lastNotifiedAt) },
    { header: "Ürün ID", width: 20, value: (row) => text(row.group.productId) },
    { header: "Ürün adı", width: 50, value: (row) => text(row.group.name) },
    { header: "Ürün durumu", width: 12, value: (row) => ALERT_PRODUCT_STATE_LABELS[row.group.state] || "" },
    { header: "Güncel fiyat (KDV dahil)", width: 16, type: "money", value: (row) => num(row.group.priceIncl) },
    {
      header: "Ürün linki",
      width: 48,
      value: (row, ctx) => (row.group.urlPath ? absoluteUrl(row.group.urlPath, ctx.siteBaseUrl) : ""),
    }
  );
  const skip = new Set(["Ürün ID", "Ürün adı", "Site durumu", "Site linki"]);
  SUPPLIER_COLUMNS.filter((column) => !skip.has(column.header)).forEach((column) => {
    cols.push({
      header: column.header,
      width: column.width,
      type: column.type,
      value: (row, ctx) => (row.product ? column.value(row.product, ctx) : null),
    });
  });
  return cols;
}

/** A manual product shaped like a listed XML product, so alert rows share one column set. */
function manualAsListed(product) {
  return Object.assign({}, product, {
    supplierName: "Manuel ürün",
    active: product.active !== false,
    salePrice: product.price,
  });
}

const EXPORT_TABS = {
  manual: { title: "Manuel Ürünler", file: "manuel-urunler" },
  xml: { title: "XML Ürünleri", file: "xml-urunleri" },
  unlisted: { title: "Listelenmeyen Ürünler", file: "listelenmeyen-urunler" },
  noimage: { title: "Görselsiz Ürünler", file: "gorselsiz-urunler" },
  whitebg: { title: "Beyaz Zemin Görselleri", file: "beyaz-zemin-gorselleri" },
  "alerts-price": { title: "Fiyat Alarm Talepleri", file: "fiyat-alarm-talepleri" },
  "alerts-stock": { title: "Stoğu Biten Ürün Talepleri", file: "stogu-biten-urun-talepleri" },
};

function columnsForTab(tab, options) {
  const opts = options || {};
  if (tab === "manual") return MANUAL_COLUMNS;
  if (tab === "noimage") return NO_IMAGE_COLUMNS;
  if (tab === "whitebg") return imageDecisionColumns(Boolean(opts.official));
  if (tab === "alerts-price") return alertColumns("price");
  if (tab === "alerts-stock") return alertColumns("stock");
  return SUPPLIER_COLUMNS;
}

/** Async so 17k-row exports yield to the event loop between batches. */
async function buildExportRows(columns, items, ctx) {
  const rows = new Array(items.length);
  for (let i = 0; i < items.length; i += 1) {
    rows[i] = columns.map((column) => {
      const value = column.value(items[i], ctx);
      return value === undefined ? null : value;
    });
    if (i % 500 === 499) await new Promise((resolve) => setImmediate(resolve));
  }
  return rows;
}

function exportFileName(tab, now) {
  const meta = EXPORT_TABS[tab] || { file: "urunler" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now instanceof Date ? now : new Date())
      .map((part) => [part.type, part.value])
  );
  return "patygo-" + meta.file + "-" + parts.year + parts.month + parts.day + "-" + parts.hour + parts.minute + ".xlsx";
}

module.exports = {
  EXPORT_TABS,
  SUPPLIER_COLUMNS,
  MANUAL_COLUMNS,
  columnsForTab,
  buildExportRows,
  exportFileName,
  manualAsListed,
  plainText,
  dateText,
};
