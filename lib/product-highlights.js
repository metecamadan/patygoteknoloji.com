"use strict";

const { parseProductDetailSpecTable } = require("./product-detail-specs");

const MAX_HIGHLIGHTS = 4;
const MAX_SPEC_HIGHLIGHTS = 2;
const MIN_HIGHLIGHTS = 3;
const DEFAULT_WARRANTY_MONTHS = 24;

/** Kodlar ve dolgu satırları vitrin kutucuğu değildir (tedarikçi stok kodu dahil). */
const SKIP_SPEC_LABELS = new Set(
  ["ürün tipi", "vitrin özeti", "katalog notu", "barkod", "marka", "üretici kodu", "model"].map(
    (label) => label.toLocaleLowerCase("tr-TR")
  )
);
const SKIP_SPEC_PREFIXES = ["ek bilgi", "öne çıkan özellik", "kaynak", "not", "detay", "açıklama", "psref"];

/**
 * Elektronik ürün kategorileri (2 yıl yasal garanti). `true` = orta kategorinin tümü,
 * dizi = yalnızca listelenen alt kategoriler. Listede olmayan kategoride garanti kutucuğu çıkmaz.
 */
const ELECTRONIC_WARRANTY_CATEGORIES = {
  "tasinabilir-bilgisayarlar": true,
  bilgisayarlar: true,
  "monitorler-ve-aks": ["monitorler"],
  "klavye-mouse-urunleri": true,
  "bilgisayar-aksesuarlari": ["notebook-adaptorleri", "notebook-stand-ve-sogutucu"],
  diskler: ["harddiskler", "ssd-diskler", "pc-harddiski-sata", "harici-diskler-external", "harddisk-kutulari"],
  "ag-urunleri": true,
  "modem-ve-switch": true,
  "kvm-switch-ve-printserver": true,
  bellekler: true,
  kasalar: ["atx-kasalar", "power-supply"],
  "ekran-kartlari": true,
  islemciler: true,
  anakartlar: true,
  "sogutucular-overclock": ["islemci-fanlari", "kasa-fanlari"],
  "tv-ve-ses-kartlari": true,
  "pci-kartlar": true,
  "kulaklik-ve-mikrofon-ve-webcam": true,
  "usb-ve-kart-bellek-urunleri": true,
  "usb-urunleri": true,
  "ses-sistemleri": true,
  "saat-ve-uzaktan-kumandalar": ["akilli-saat-ve-bileklik"],
  "barkod-urunleri": ["barkod-okuyucular", "barkod-yazicilar", "etiket-yazicilari", "el-terminalleri", "pos-yazicilar"],
  "yazici-tarayici": true,
  "ups-kesintisiz-guc-kaynagi": true,
  "hirdavat-urunleri": ["olcu-ve-test-aletleri"],
  "elektrik-urunleri": true,
  "pil-sarj-batarya-urunleri": ["powerbank", "aku-ve-aku-sarj-cihazlari", "pil-sarj-cihazlari"],
  "hesap-makineleri-ve-sozluk": [
    "masaustu-makineler",
    "cep-tipi-makineler",
    "fx-bilimsel-makineler",
    "pro-masaustu-makineler",
    "grafik-ciz-bilimsel-makineler",
    "seritli-makineler",
  ],
  "telefon-telsiz-cesitleri": true,
  "personel-devam-kontrol-sistemleri": true,
  "kagit-urunleri": ["kagit-imha-makineleri"],
  "para-sayma-ve-kontrol-cihazi": true,
  "projeksiyon-urunleri": ["projeksiyonlar", "sunum-kumandasi"],
  kameralar: true,
  "kayit-cihazlari": true,
  "guvenlik-urunu-aksesuarlari": ["guvenlik-adaptorleri"],
};

function labelKey(label) {
  return String(label || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function isHubSpecRow(row) {
  const key = labelKey(row && row.label);
  if (!key || !String((row && row.value) || "").trim()) return false;
  if (SKIP_SPEC_LABELS.has(key)) return false;
  return !SKIP_SPEC_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix + " "));
}

function specHighlights(details) {
  return parseProductDetailSpecTable(details)
    .filter(isHubSpecRow)
    .slice(0, MAX_SPEC_HIGHLIGHTS)
    .map((row) => ({ label: row.label.trim(), value: row.value.trim() }));
}

/** Ürün adında açıkça yazan süre (ör. "3 Yıl Resmi Dist Garantili", "24 Ay Garanti"). */
function warrantyMonthsFromName(name) {
  const text = String(name || "");
  const years = text.match(/(\d{1,2})\s*y[ıi]l[^()]{0,30}?garant/i);
  if (years) return Number(years[1]) * 12;
  const months = text.match(/(\d{1,3})\s*ay[^()]{0,20}?garant/i);
  if (months) return Number(months[1]);
  return 0;
}

function isElectronicCategory(mid, child) {
  const rule = ELECTRONIC_WARRANTY_CATEGORIES[String(mid || "")];
  if (rule === true) return true;
  return Array.isArray(rule) && rule.includes(String(child || ""));
}

function warrantyMonths(product) {
  const name = String(product.name || "");
  const fromName = warrantyMonthsFromName(name);
  if (fromName > 0) return fromName;
  if (/garantisiz|\bdemo\b/i.test(name)) return 0;
  return isElectronicCategory(product.siteMid || product.mid, product.siteChild || product.alt)
    ? DEFAULT_WARRANTY_MONTHS
    : 0;
}

const STOCK_EXACT_BELOW = 10;
const STOCK_LABEL_CAP = 100;

/** 10'un altı kesin adet; üstü yalnızca alt sınır (onluğa aşağı, 100+ tavan): rakip kesin stoğu görmez. */
function stockLevelLabel(stockQty) {
  if (stockQty === null || stockQty === undefined || stockQty === "") return "";
  const qty = Math.floor(Number(stockQty));
  if (!Number.isFinite(qty) || qty <= 0) return "";
  if (qty < STOCK_EXACT_BELOW) return qty + " adet";
  return Math.min(Math.floor(qty / 10) * 10, STOCK_LABEL_CAP) + "+ adet";
}

/**
 * Ürün detayındaki "Ürün Bilgileri" kutucukları. Yalnızca gerçek veriden üretilir;
 * veri yoksa kutucuk eklenmez.
 * @param {object} product zenginleştirilmiş (details içeren) iç ürün
 * @param {{ brand?: string }} [options]
 */
function buildProductHighlights(product, options) {
  if (!product || typeof product !== "object") return [];
  const opts = options || {};
  const out = specHighlights(product.details);
  const months = warrantyMonths(product);
  if (months > 0) out.push({ label: "Garanti Süresi", value: months + " Ay" });
  const stock = stockLevelLabel(product.stockQty);
  if (stock) out.push({ label: "Stok Durumu", value: stock });
  const brand = String(opts.brand || "").trim();
  if (out.length < MIN_HIGHLIGHTS && brand) out.push({ label: "Marka", value: brand });
  return out.slice(0, MAX_HIGHLIGHTS);
}

module.exports = {
  buildProductHighlights,
  stockLevelLabel,
  warrantyMonthsFromName,
  isElectronicCategory,
  ELECTRONIC_WARRANTY_CATEGORIES,
};
