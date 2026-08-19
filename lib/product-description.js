"use strict";

const { parseProductSpecChips, parseProductDetailSpecTable } = require("./product-detail-specs");

const CATEGORY_LABELS = {
  notebook: "notebook",
  cpu: "işlemci",
  ram: "bellek modülü",
  storage: "depolama ürünü",
  monitor: "monitör",
  printer: "yazıcı",
  toner: "sarf malzemesi",
  gpu: "ekran kartı",
  motherboard: "anakart",
  psu: "güç kaynağı",
  case: "kasa",
  cooler: "soğutucu",
  network: "ağ ürünü",
  ups: "kesintisiz güç kaynağı",
  peripheral: "çevre birimi",
  generic: "ürün",
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalKey(value) {
  return normalizeText(value).toLocaleLowerCase("tr-TR");
}

function isSameAsName(text, name) {
  const key = canonicalKey(text);
  return Boolean(key) && key === canonicalKey(name);
}

function isUsableCopy(text, name) {
  const value = normalizeText(text);
  if (!value) return false;
  if (isSameAsName(value, name)) return false;
  return true;
}

function needsGeneratedDetails(details, name) {
  const value = normalizeText(details);
  if (!value) return true;
  if (value.startsWith("__SPEC_TABLE__")) return false;
  if (parseProductDetailSpecTable(value).length >= 2) return false;
  const nameKey = canonicalKey(name);
  const detailKey = canonicalKey(value);
  if (
    nameKey &&
    detailKey &&
    (nameKey === detailKey || nameKey.includes(detailKey) || detailKey.includes(nameKey))
  ) {
    return true;
  }
  if (isUsableCopy(value, name) && value.length >= 80) return false;
  return true;
}

function titleBrand(brand) {
  const raw = normalizeText(brand);
  if (!raw) return "";
  if (raw.length <= 4) return raw.toUpperCase();
  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function haystack(product) {
  return [
    product.siteChild,
    product.siteMid,
    product.siteParent,
    product.subCategory,
    product.midCategory,
    product.mainCategory,
    product.category,
    product.name,
  ]
    .map((part) => String(part || "").toLocaleLowerCase("tr-TR"))
    .join(" ");
}

function detectProductKind(product) {
  const text = haystack(product);
  if (/notebook|laptop|macbook|thinkpad|ideapad|vivobook|probook|latitude|inspiron|expertbook|elitebook|pavilion/.test(text)) {
    return "notebook";
  }
  if (/islemci|işlemci|processor|ryzen|threadripper|xeon|celeron|pentium|athlon/.test(text)) {
    return "cpu";
  }
  if (/ddr[345]|ram|bellek|memory|so-dimm|dimm/.test(text)) {
    return "ram";
  }
  if (/ssd|hdd|nvme|m\.2|depolama|hard ?disk|harici disk|usb disk/.test(text)) {
    return "storage";
  }
  if (/monitor|monitör|ekran/.test(text) && !/ekran kart|gpu|graphics|rtx|gtx|radeon/.test(text)) {
    return "monitor";
  }
  if (/toner|kartus|kartuş|drum|muadil|orijinal sarf|ribbon/.test(text)) {
    return "toner";
  }
  if (/yazici|yazıcı|printer|tarayici|tarayıcı|mfp|laser|inkjet/.test(text)) {
    return "printer";
  }
  if (/ekran kart|gpu|geforce|rtx|gtx|radeon|graphics/.test(text)) {
    return "gpu";
  }
  if (/anakart|motherboard|mainboard/.test(text)) {
    return "motherboard";
  }
  if (/guc kayn|güç kayn|psu|power supply/.test(text)) {
    return "psu";
  }
  if (/kasa|tower case|pc case/.test(text)) {
    return "case";
  }
  if (/islemci sog|işlemci soğ|cpu cooler|fan|heatsink|sogutucu|soğutucu/.test(text)) {
    return "cooler";
  }
  if (/switch|router|modem|access point|mesh|network|ag switch|ağ/.test(text)) {
    return "network";
  }
  if (/\bups\b|kesintisiz guc|kesintisiz güç|line-interactive|online ups/.test(text)) {
    return "ups";
  }
  if (/klavye|mouse|kulaklik|kulaklık|webcam|hoparlor|hoparlör|speaker|pad|dock/.test(text)) {
    return "peripheral";
  }
  return "generic";
}

function firstMatch(text, regex) {
  const match = String(text || "").match(regex);
  return match ? normalizeText(match[1] || match[0]) : "";
}

function extractModelCode(name) {
  const text = String(name || "");
  const candidates = [
    firstMatch(text, /\b([A-Z0-9]{2,}[A-Z0-9-]{4,})\b/),
    firstMatch(text, /\b(\d{2,3}[A-Z]\d{4,}[A-Z0-9]{0,6})\b/i),
    firstMatch(text, /\b([A-Z]{1,3}\d{3,}[A-Z0-9-]{2,})\b/i),
  ].filter(Boolean);
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

function pushRow(rows, label, value) {
  const cleanLabel = normalizeText(label);
  const cleanValue = normalizeText(value);
  if (!cleanLabel || !cleanValue) return;
  const exists = rows.some(
    (row) => row.label.toLocaleLowerCase("tr-TR") === cleanLabel.toLocaleLowerCase("tr-TR")
  );
  if (exists) return;
  rows.push({ label: cleanLabel, value: cleanValue });
}

function rowsFromChips(chips) {
  const rows = [];
  chips.forEach((chip) => {
    if (/ekran/i.test(chip) && !/kart/i.test(chip)) pushRow(rows, "Ekran", chip);
    else if (/\bRAM\b/i.test(chip)) pushRow(rows, "Bellek", chip);
    else if (/ssd|depolama|tb/i.test(chip)) pushRow(rows, "Depolama", chip);
    else if (/intel|amd|ryzen|core|xeon/i.test(chip)) pushRow(rows, "İşlemci", chip);
    else if (/windows|freedos|linux/i.test(chip)) pushRow(rows, "İşletim sistemi", chip);
    else if (/ddr/i.test(chip)) pushRow(rows, "Bellek tipi", chip);
    else pushRow(rows, "Özellik", chip);
  });
  return rows;
}

function extractNotebookRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  if (!rows.some((row) => row.label === "Bellek")) {
    const mem = firstMatch(name, /(\d+)\s*gb(?!\s*ssd)/i);
    if (mem) pushRow(rows, "Bellek", mem + " GB RAM");
  }
  const model = extractModelCode(name);
  if (model) pushRow(rows, "Model", model);
  const panel = firstMatch(name, /\b(ips|tn|va|oled)\b/i);
  if (panel) pushRow(rows, "Panel", panel.toUpperCase());
  const refresh = firstMatch(name, /(\d{2,3})\s*hz/i);
  if (refresh) pushRow(rows, "Tazeleme", refresh + " Hz");
  return rows;
}

function extractCpuRows(name) {
  const rows = [];
  const model =
    firstMatch(name, /intel\s+core\s+(i[3579])\s*-?\s*(\d+[a-z]*)/i) ||
    firstMatch(name, /amd\s+ryzen\s*(\d+\s*\w*)/i) ||
    firstMatch(name, /(celeron|pentium|athlon|xeon|threadripper)\s+([\w-]+)/i);
  if (model) pushRow(rows, "İşlemci", model.replace(/\s+/g, " "));
  const socket = firstMatch(name, /(?:soket|socket)\s*(\d+|lga\s*\d+|am[45])/i);
  if (socket) pushRow(rows, "Soket", socket.toUpperCase());
  const cores = firstMatch(name, /(\d+)\s*(?:cekirdek|çekirdek|core)/i);
  if (cores) pushRow(rows, "Çekirdek", cores);
  const ghz = firstMatch(name, /(\d+(?:[.,]\d+)?)\s*ghz/i);
  if (ghz) pushRow(rows, "Saat hızı", ghz.replace(",", ".") + " GHz");
  const cache = firstMatch(name, /(\d+)\s*mb\s*(?:onbellek|önbellek|cache)/i);
  if (cache) pushRow(rows, "Önbellek", cache + " MB");
  const gpu = firstMatch(name, /(uhd\s*\d+|iris xe|radeon vega|vega \d+)/i);
  if (gpu) pushRow(rows, "Grafik", gpu.toUpperCase());
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractRamRows(name) {
  const rows = [];
  const cap = firstMatch(name, /(\d+)\s*gb/i);
  if (cap) pushRow(rows, "Kapasite", cap + " GB");
  const type = firstMatch(name, /(ddr[345])/i);
  if (type) pushRow(rows, "Bellek tipi", type.toUpperCase());
  const speed = firstMatch(name, /(\d{4,5})\s*mhz/i);
  if (speed) pushRow(rows, "Hız", speed + " MHz");
  const form = firstMatch(name, /(so-dimm|sodimm|dimm|udimm)/i);
  if (form) pushRow(rows, "Form faktör", form.toUpperCase());
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractStorageRows(name) {
  const rows = [];
  const cap =
    firstMatch(name, /(\d+)\s*gb\s*(?:ssd|nvme|m\.2|hdd)/i) ||
    firstMatch(name, /(\d+)\s*tb/i);
  if (cap) pushRow(rows, "Kapasite", cap + (/\btb\b/i.test(name) ? " TB" : " GB"));
  if (/\bnvme\b/i.test(name)) pushRow(rows, "Arayüz", "NVMe");
  else if (/\bm\.2\b/i.test(name)) pushRow(rows, "Form faktör", "M.2");
  else if (/\bssd\b/i.test(name)) pushRow(rows, "Tür", "SSD");
  else if (/\bhdd\b/i.test(name)) pushRow(rows, "Tür", "HDD");
  const usb = firstMatch(name, /usb\s*(\d+(?:\.\d+)?)/i);
  if (usb) pushRow(rows, "Bağlantı", "USB " + usb);
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractMonitorRows(name) {
  const rows = [];
  const size = firstMatch(name, /(\d+(?:[.,]\d+)?)\s*"/) || firstMatch(name, /(\d+(?:[.,]\d+)?)\s*(?:inch|inç)/i);
  if (size) pushRow(rows, "Ekran boyutu", size.replace(",", ".") + '"');
  const res = firstMatch(name, /(3840\s*x\s*2160|2560\s*x\s*1440|1920\s*x\s*1080|full\s*hd|qhd|uhd|4k|fhd)/i);
  if (res) pushRow(rows, "Çözünürlük", res.toUpperCase());
  const refresh = firstMatch(name, /(\d{2,3})\s*hz/i);
  if (refresh) pushRow(rows, "Tazeleme", refresh + " Hz");
  const panel = firstMatch(name, /\b(ips|tn|va|oled)\b/i);
  if (panel) pushRow(rows, "Panel", panel.toUpperCase());
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractPrinterRows(name) {
  const rows = [];
  if (/mono|siyah\s*beyaz|laser/i.test(name)) pushRow(rows, "Baskı", "Mono laser");
  else if (/renkli|color/i.test(name)) pushRow(rows, "Baskı", "Renkli");
  else if (/inkjet/i.test(name)) pushRow(rows, "Baskı", "Inkjet");
  if (/cok fonksiyon|çok fonksiyon|mfp|multifunction/i.test(name)) {
    pushRow(rows, "Tip", "Çok fonksiyonlu");
  }
  const ppm = firstMatch(name, /(\d+)\s*ppm/i);
  if (ppm) pushRow(rows, "Hız", ppm + " ppm");
  const compat = firstMatch(name, /(?:uyumlu|for|için)\s+(.{3,80})$/i);
  if (compat) pushRow(rows, "Uyumluluk", compat);
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractTonerRows(name) {
  const rows = [];
  if (/siyah|black/i.test(name)) pushRow(rows, "Renk", "Siyah");
  else if (/magenta|kirmizi|kırmızı/i.test(name)) pushRow(rows, "Renk", "Magenta");
  else if (/cyan|mavi/i.test(name)) pushRow(rows, "Renk", "Cyan");
  else if (/yellow|sari|sarı/i.test(name)) pushRow(rows, "Renk", "Sarı");
  const yieldPages = firstMatch(name, /(\d{3,5})\s*(?:sayfa|page)/i);
  if (yieldPages) pushRow(rows, "Kapasite", yieldPages + " sayfa");
  const compat = firstMatch(name, /(?:for|uyumlu|için)\s+(.{3,80})$/i);
  if (compat) pushRow(rows, "Uyumlu model", compat);
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractGpuRows(name) {
  const rows = [];
  const model =
    firstMatch(name, /(geforce\s*(?:rtx|gtx)\s*\d+\s*\w*)/i) ||
    firstMatch(name, /(radeon\s*(?:rx)?\s*\d+\s*\w*)/i);
  if (model) pushRow(rows, "GPU", model.toUpperCase());
  const vram = firstMatch(name, /(\d+)\s*gb\s*(?:gddr|vram|grafik)/i) || firstMatch(name, /(\d+)\s*gb/i);
  if (vram) pushRow(rows, "Bellek", vram + " GB");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractGenericRows(product) {
  const rows = rowsFromChips(parseProductSpecChips(product.name));
  const model = extractModelCode(product.name);
  if (model) pushRow(rows, "Model", model);
  return rows;
}

function buildSpecRows(product) {
  const kind = detectProductKind(product);
  const name = String(product.name || "");
  let rows = [];
  switch (kind) {
    case "notebook":
      rows = extractNotebookRows(name);
      break;
    case "cpu":
      rows = extractCpuRows(name);
      break;
    case "ram":
      rows = extractRamRows(name);
      break;
    case "storage":
      rows = extractStorageRows(name);
      break;
    case "monitor":
      rows = extractMonitorRows(name);
      break;
    case "printer":
      rows = extractPrinterRows(name);
      break;
    case "toner":
      rows = extractTonerRows(name);
      break;
    case "gpu":
      rows = extractGpuRows(name);
      break;
    default:
      rows = extractGenericRows(product);
      break;
  }
  if (product.manufacturerCode) pushRow(rows, "Üretici kodu", product.manufacturerCode);
  if (product.barcode) pushRow(rows, "Barkod", product.barcode);
  if (product.brand) pushRow(rows, "Marka", titleBrand(product.brand));
  return rows.slice(0, 24);
}

function formatSpecTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return (
    "__SPEC_TABLE__\n" +
    rows
      .map((row) => normalizeText(row.label) + "|" + normalizeText(row.value))
      .join("\n")
  );
}

function buildIntro(product, kind, rows) {
  const brand = titleBrand(product.brand);
  const category = CATEGORY_LABELS[kind] || CATEGORY_LABELS.generic;
  const model = extractModelCode(product.name);
  let intro = brand ? brand + " " + category : category.charAt(0).toUpperCase() + category.slice(1);
  if (model && !intro.toLocaleLowerCase("tr-TR").includes(model.toLocaleLowerCase("tr-TR"))) {
    intro += " (" + model + ")";
  }
  intro += ". Teknik satırlar ürün adı ve katalog bilgisinden derlenmiştir.";
  if (/\(upg\)|yükselt|upgrade/i.test(product.name || "")) {
    intro += " Bellek veya depolama yükseltmesi tedarikçi montajı olabilir.";
  }
  if (!rows.length) {
    intro += " Detaylı özellik tablosu için ürün adını inceleyin.";
  }
  return intro.slice(0, 2000);
}

function buildGeneratedDescription(product) {
  const rows = buildSpecRows(product);
  return buildIntro(product, detectProductKind(product), rows);
}

function buildGeneratedDetails(product) {
  const rows = buildSpecRows(product);
  const table = formatSpecTable(rows);
  if (table) return table.slice(0, 8000);
  const fallback = normalizeText(product.description);
  return fallback.slice(0, 8000);
}

function enrichProductCopy(product, options) {
  const opts = options || {};
  const name = String(product.name || "");
  const out = Object.assign({}, product);
  const skipDescription = Boolean(opts.skipDescription);
  const skipDetails = Boolean(opts.skipDetails);

  if (!skipDescription && !isUsableCopy(out.description, name)) {
    out.description = buildGeneratedDescription(out);
  }
  if (!skipDetails && needsGeneratedDetails(out.details, name)) {
    const generated = buildGeneratedDetails(out);
    if (generated) out.details = generated;
    else if (isUsableCopy(out.description, name)) out.details = out.description;
  }
  return out;
}

function needsGeneratedCopy(product) {
  const name = String(product.name || "");
  return (
    !isUsableCopy(product.description, name) || needsGeneratedDetails(product.details, name)
  );
}

module.exports = {
  detectProductKind,
  buildSpecRows,
  buildGeneratedDescription,
  buildGeneratedDetails,
  enrichProductCopy,
  needsGeneratedCopy,
  needsGeneratedDetails,
  formatSpecTable,
  isUsableCopy,
};
