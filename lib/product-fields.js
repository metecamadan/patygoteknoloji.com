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
  if (!Number.isFinite(Number(product && product.vatPercent))) missing.push("KDV");
  if (!trimText(product && product.currency, 8)) missing.push("Döviz türü");
  if (!trimText(product && product.unit, 20)) missing.push("Birim");
  if (!trimText(product && product.description, 280)) missing.push("Kısa açıklama");
  return missing;
}

module.exports = {
  CATEGORY_FEED_DEFAULTS,
  validateManualFeedFields,
  trimText,
};
