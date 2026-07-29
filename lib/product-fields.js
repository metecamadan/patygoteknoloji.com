const CATEGORY_FEED_DEFAULTS = {
  bilgisayar: {
    mainCategory: "KİŞİSEL BİLGİSAYARLAR",
    midCategory: "Taşınabilir Bilgisayarlar",
    subCategory: "Notebooklar",
  },
  yazici: {
    mainCategory: "YAZICILAR VE ÇEVRE BİRİMLERİ",
    midCategory: "Yazıcılar",
    subCategory: "Ofis Yazıcıları",
  },
  "kucuk-ev": {
    mainCategory: "EV ALETLERİ",
    midCategory: "Küçük Ev Aletleri",
    subCategory: "Genel",
  },
  "beyaz-esya": {
    mainCategory: "BEYAZ EŞYA",
    midCategory: "Soğutma",
    subCategory: "Buzdolabı",
  },
};

function trimText(value, max) {
  return String(value || "").trim().slice(0, max);
}

/** Allowed storefront/admin VAT rates (percent). */
const ALLOWED_VAT_RATES = [1, 8, 10, 20];

function normalizeVatPercent(value, fallback) {
  const n = Number(value);
  if (ALLOWED_VAT_RATES.includes(n)) return n;
  const fb = Number(fallback);
  if (ALLOWED_VAT_RATES.includes(fb)) return fb;
  return 20;
}

function isAllowedVatPercent(value) {
  return ALLOWED_VAT_RATES.includes(Number(value));
}

/** Net (excl. VAT) → gross (incl. VAT). */
function priceInclVat(netPrice, vatPercent) {
  const net = Math.max(0, Number(netPrice) || 0);
  const rate = normalizeVatPercent(vatPercent);
  return Math.round(net * (1 + rate / 100) * 100) / 100;
}

function vatAmountFromNet(netPrice, vatPercent) {
  const net = Math.max(0, Number(netPrice) || 0);
  const rate = normalizeVatPercent(vatPercent);
  return Math.round(net * (rate / 100) * 100) / 100;
}

function validateManualFeedFields(product) {
  const missing = [];
  if (!trimText(product && product.id, 80)) missing.push("Ürün kodu");
  if (!trimText(product && product.name, 120)) missing.push("Ürün adı");
  if (!trimText(product && product.brand, 40)) missing.push("Marka");
  if (!Number.isFinite(Number(product && product.price)) || Number(product.price) <= 0) {
    missing.push("Fiyat");
  }
  if (!trimText(product && product.manufacturerCode, 80)) missing.push("Üretici kodu");
  if (!trimText(product && product.barcode, 40)) missing.push("Barkod");
  if (!trimText(product && product.gtipCode, 40)) missing.push("GTIP kodu");
  if (!trimText(product && product.mainCategory, 80)) missing.push("Ana kategori");
  if (!trimText(product && product.midCategory, 80)) missing.push("Ara kategori");
  if (!trimText(product && product.subCategory, 80)) missing.push("Alt kategori");
  if (!Number.isFinite(Number(product && product.stockQty))) missing.push("Stok");
  if (!isAllowedVatPercent(product && product.vatPercent)) missing.push("KDV");
  if (!trimText(product && product.currency, 8)) missing.push("Döviz türü");
  if (!trimText(product && product.unit, 20)) missing.push("Birim");
  if (!trimText(product && product.description, 280)) missing.push("Kısa açıklama");
  return missing;
}

module.exports = {
  CATEGORY_FEED_DEFAULTS,
  ALLOWED_VAT_RATES,
  normalizeVatPercent,
  isAllowedVatPercent,
  priceInclVat,
  vatAmountFromNet,
  validateManualFeedFields,
  trimText,
};
