"use strict";

const {
  parseProductSpecChips,
  parseProductDetailSpecTable,
  normalizeResolutionFromTitle,
  extractMonitorPorts,
} = require("./product-detail-specs");
const { trLowerCase } = require("./tr-text");
const { formatBrandName } = require("./brand-name");

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
  return trLowerCase(normalizeText(value));
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

const TECH_SPEC_LABELS = new Set(
  [
    "ekran",
    "ekran boyutu",
    "çözünürlük",
    "tazeleme",
    "panel",
    "yanıt süresi",
    "bağlantılar",
    "bağlantı",
    "işlemci",
    "bellek",
    "depolama",
    "kapasite",
    "bellek tipi",
    "soket",
    "gpu",
    "baskı",
    "tip",
    "hız",
    "renk",
    "uyumluluk",
    "uyumlu model",
    "form faktör",
    "arayüz",
    "tür",
    "çekirdek",
    "saat hızı",
    "önbellek",
    "grafik",
    "işletim sistemi",
    "güç",
    "verimlilik",
    "chipset",
    "ağ",
    "kablosuz",
    "dpi",
    "düzen",
    "soğutma",
    "fan",
    "tdp",
    "va",
    "çıkış gücü",
    "kasa",
    "gecikme",
    "okuma hızı",
    "yazma hızı",
    "m.2 yuva",
    "aydınlatma",
    "port",
    "poe",
    "dpi",
    "kağıt",
    "ürün tipi",
    "öne çıkan özellik",
  ].map((label) => label.toLocaleLowerCase("tr-TR"))
);

const MIN_CONTENT_ROWS = 4;
const META_SPEC_LABELS = new Set(
  ["barkod", "marka", "üretici kodu", "model"].map((label) => label.toLocaleLowerCase("tr-TR"))
);

function rowLabelKey(label) {
  return canonicalKey(label);
}

const MANUAL_DETAIL_LABEL_PREFIXES = ["kaynak", "not", "detay", "açıklama", "psref"];

function hasManualDetailRows(rows) {
  return rows.some((row) => {
    const key = rowLabelKey(row.label);
    return MANUAL_DETAIL_LABEL_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix + " "));
  });
}

function countContentRows(rows) {
  return rows.filter((row) => !META_SPEC_LABELS.has(rowLabelKey(row.label))).length;
}

function isThinSpecTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return true;
  if (hasManualDetailRows(rows)) return false;
  return countContentRows(rows) < MIN_CONTENT_ROWS;
}

function countTechnicalRows(rows) {
  return rows.filter((row) => TECH_SPEC_LABELS.has(rowLabelKey(row.label))).length;
}

function shouldRegenerateSpecTable(product, detailsText) {
  const existing = parseProductDetailSpecTable(detailsText);
  if (!existing.length) return true;
  if (hasManualDetailRows(existing)) return false;
  if (hasLegacyFillerRows(existing)) return true;
  if (isThinSpecTable(existing)) return true;
  const fresh = buildSpecRows(product);
  const existingKeys = new Set(existing.map((row) => rowLabelKey(row.label)));
  if (fresh.some((row) => !existingKeys.has(rowLabelKey(row.label)))) return true;
  if (countTechnicalRows(fresh) > countTechnicalRows(existing)) return true;
  if (countContentRows(fresh) > countContentRows(existing)) return true;
  return false;
}

function needsGeneratedDetails(details, name, product) {
  const raw = String(details || "").trim();
  const value = normalizeText(details);
  if (!raw) return true;
  if (isSameAsName(value, name)) return true;
  if (raw.startsWith("__SPEC_TABLE__")) {
    if (product && shouldRegenerateSpecTable(product, raw)) return true;
    return false;
  }
  if (parseProductDetailSpecTable(raw).length >= 2) return false;
  return true;
}

function titleBrand(brand) {
  return formatBrandName(normalizeText(brand));
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
    .map((part) => trLowerCase(part || ""))
    .join(" ");
}

function explicitKindFromName(name) {
  const text = String(name || "");
  if (/\b(monitör|monitor)\b/i.test(text) && !/ekran kart|gpu|geforce|radeon|rtx|gtx/i.test(text)) {
    return "monitor";
  }
  if (/\b(notebook|laptop|macbook)\b/i.test(text)) return "notebook";
  if (/\b(yazici|yazıcı|printer|mfp|inkjet|laserjet)\b/i.test(text)) return "printer";
  if (/\b(toner|kartus|kartuş|drum|ribbon)\b/i.test(text)) return "toner";
  if (/\b(ssd|nvme|hard ?disk|hdd|m\.2)\b/i.test(text) && !/anakart|motherboard/i.test(text)) {
    return "storage";
  }
  if (/\b(geforce|gtx|rtx|radeon\s*rx)\b/i.test(text)) return "gpu";
  if (/\b(anakart|motherboard|mainboard)\b/i.test(text)) return "motherboard";
  if (/\b(güç kayna|guc kayn|power supply|psu)\b/i.test(text)) return "psu";
  if (/\b(ups|kesintisiz güç|kesintisiz guc)\b/i.test(text)) return "ups";
  if (/\b(switch|router|modem|access point|mesh wifi|mesh wi-fi)\b/i.test(text)) return "network";
  if (/\b(klavye|mouse|kulaklik|kulaklık|webcam|hoparlör|hoparlor|speaker|gamepad)\b/i.test(text)) {
    return "peripheral";
  }
  if (/\b(cpu cooler|islemci sog|işlemci soğ|soğutucu|sogutucu|heatsink)\b/i.test(text)) return "cooler";
  if (/\b(pc kasa|bilgisayar kasa|tower case|mid tower|full tower)\b/i.test(text)) return "case";
  if (/\b(ddr[345]|so-dimm|sodimm|dimm|udimm)\b/i.test(text) && /\bbellek\b|\bram\b|\bmemory\b/i.test(text)) {
    return "ram";
  }
  return "";
}

/** Vitrin kategorisi ad kelimesinden güçlüdür: "2 Toner Hediyeli" yazıcı, sarf malzemesi değildir. */
function kindFromSiteCategory(product) {
  if (!product) return "";
  if (product.siteMid === "yazici-tarayici") return "printer";
  if (product.siteParent === "kartus-toner") return "toner";
  return "";
}

function detectProductKind(product) {
  const fromCategory = kindFromSiteCategory(product);
  if (fromCategory) return fromCategory;
  const fromName = explicitKindFromName(product && product.name);
  if (fromName) return fromName;

  const text = haystack(product);
  if (/notebook|laptop|macbook|thinkpad|ideapad|vivobook|probook|latitude|inspiron|expertbook|elitebook|pavilion/.test(text)) {
    return "notebook";
  }
  if (/islemci|işlemci|processor|ryzen|threadripper|xeon|celeron|pentium|athlon/.test(text)) {
    return "cpu";
  }
  if (/monitor|monitör/.test(text) && !/ekran kart|gpu|graphics|rtx|gtx|radeon/.test(text)) {
    return "monitor";
  }
  if (/\bddr[345]\b|\bram\b|\bbellek\b|\bmemory\b|\bso-dimm\b|\bsodimm\b|\bdimm\b|\budimm\b/i.test(text)) {
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

/** Title tokens that look like model codes but are spec values (UHD630, DDR5, LGA1700, 1920x1080, 16GB…). */
const SPEC_TOKEN_RE =
  /^(?:UHD|DDR|GDDR|LPDDR|LGA|AM[45]|RTX|GTX|RX|PCIE|GEN|USB|HDMI|DP|VGA|FHD|QHD|WQHD|UHD|IPS|NVME|WIFI|CL|M\.?2)[-\d]*$|^\d+(?:[.,]\d+)?(?:GB|TB|MB|MHZ|GHZ|HZ|W|VA|MS|DPI|PPM|MT|MM)$|^\d{3,4}X\d{3,4}$/i;

function modelCodeCandidates(text, regex) {
  const out = [];
  const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let match;
  while ((match = global.exec(text))) {
    const value = normalizeText(match[1] || match[0]);
    if (value && !SPEC_TOKEN_RE.test(value)) out.push(value);
  }
  return out;
}

function extractModelCode(name) {
  const text = String(name || "");
  const candidates = [
    ...modelCodeCandidates(text, /\b([A-Z0-9]{2,}[A-Z0-9-]{4,})\b/),
    ...modelCodeCandidates(text, /\b(\d{2,3}[A-Z]\d{4,}[A-Z0-9]{0,6})\b/i),
    ...modelCodeCandidates(text, /\b([A-Z]{1,3}\d{3,}[A-Z0-9-]{2,})\b/i),
  ].filter((value) => /\d/.test(value) && /[A-Z]/i.test(value));
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

function capitalizeWord(word) {
  const text = String(word || "");
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** "Intel Core i3-10100 …" → "Core i3-10100"; "AMD Ryzen 5 5600X" → "Ryzen 5 5600X". */
function extractCpuModel(name) {
  const text = String(name || "");
  let m = text.match(/\bcore\s+ultra\s+([579])\s*-?\s*(\d{3}[a-z]{0,2})\b/i);
  if (m) return "Core Ultra " + m[1] + " " + m[2].toUpperCase();
  m = text.match(/\bcore\s+(i[3579])\s*-?\s*(\d{3,5}[a-z]{0,3})\b/i);
  if (m) return "Core " + m[1].toLowerCase() + "-" + m[2].toUpperCase();
  m = text.match(/\bryzen\s*(?:threadripper\s*)?([3579])\s*(?:pro\s*)?(\d{4}[a-z0-9]{0,3})\b/i);
  if (m) return "Ryzen " + m[1] + " " + m[2].toUpperCase();
  m = text.match(/\b(celeron|pentium(?:\s+gold)?|athlon|xeon|threadripper)\s+([a-z]*-?\d[\w-]*)/i);
  if (m) return m[1].split(/\s+/).map(capitalizeWord).join(" ") + " " + m[2].toUpperCase();
  m = text.match(/\bcore\s+(i[3579])\b/i);
  if (m) return "Core " + m[1].toLowerCase();
  return "";
}

/** Spec rows are only appended via pushRow, so a per-array label set stays in sync. */
const rowLabelKeys = new WeakMap();

function pushRow(rows, label, value) {
  const cleanLabel = normalizeText(label);
  const cleanValue = normalizeText(value);
  if (!cleanLabel || !cleanValue) return;
  let keys = rowLabelKeys.get(rows);
  if (!keys) {
    keys = new Set(rows.map((row) => trLowerCase(row.label)));
    rowLabelKeys.set(rows, keys);
  }
  const key = trLowerCase(cleanLabel);
  if (keys.has(key)) return;
  keys.add(key);
  rows.push({ label: cleanLabel, value: cleanValue });
}

function rowsFromChips(chips) {
  const rows = [];
  chips.forEach((chip) => {
    if (/ekran/i.test(chip) && !/kart/i.test(chip)) pushRow(rows, "Ekran boyutu", chip.replace(/\s*ekran$/i, ""));
    else if (/^\d{3,4}x\d{3,4}$/i.test(chip)) pushRow(rows, "Çözünürlük", chip);
    else if (/\bhz\b/i.test(chip)) pushRow(rows, "Tazeleme", chip);
    else if (/\bms\b/i.test(chip)) pushRow(rows, "Yanıt süresi", chip);
    else if (/panel/i.test(chip)) pushRow(rows, "Panel", chip.replace(/\s*panel$/i, ""));
    else if (/\bRAM\b/i.test(chip)) pushRow(rows, "Bellek", chip);
    else if (/ssd|nvme|depolama|tb/i.test(chip)) pushRow(rows, "Depolama", chip);
    else if (/intel|amd|ryzen|core|xeon/i.test(chip)) pushRow(rows, "İşlemci", chip);
    else if (/geforce|radeon|rtx|gtx|rx/i.test(chip)) pushRow(rows, "GPU", chip.toUpperCase());
    else if (/windows|freedos|linux/i.test(chip)) pushRow(rows, "İşletim sistemi", chip);
    else if (/^ddr/i.test(chip)) pushRow(rows, "Bellek tipi", chip);
    else if (/mhz/i.test(chip)) pushRow(rows, "Hız", chip);
    else if (/^cl\d/i.test(chip)) pushRow(rows, "Gecikme", chip);
    else if (/\bw\b/i.test(chip)) pushRow(rows, "Güç", chip);
    else if (/soket/i.test(chip)) pushRow(rows, "Soket", chip.replace(/^soket\s*/i, ""));
    else if (/chipset/i.test(chip)) pushRow(rows, "Chipset", chip.replace(/\s*chipset$/i, ""));
    else if (/wifi|wi-fi|bluetooth/i.test(chip)) pushRow(rows, "Kablosuz", chip);
    else if (/80\+/i.test(chip)) pushRow(rows, "Verimlilik", chip);
    else if (/\bva\b/i.test(chip)) pushRow(rows, "VA", chip);
    else if (/ppm/i.test(chip)) pushRow(rows, "Hız", chip);
    else if (/dpi/i.test(chip)) pushRow(rows, "Çözünürlük", chip);
    else pushRow(rows, "Özellik", chip);
  });
  return rows;
}

function extractNotebookRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  if (!rows.some((row) => row.label === "Bellek")) {
    const mem =
      firstMatch(name, /(\d+)\s*gb\s*ram\b/i) ||
      (/\b(?:ssd|nvme|hdd|\d+\s*gb\s*ssd)\b/i.test(name)
        ? firstMatch(name, /(\d+)\s*gb(?!\s*(?:ssd|nvme|hdd|tb|gddr|vram))/i)
        : firstMatch(name, /(\d+)\s*gb(?!\s*(?:ssd|nvme|hdd|tb|gddr|vram))/i));
    if (mem) pushRow(rows, "Bellek", mem + " GB RAM");
  }
  if (!rows.some((row) => row.label === "Depolama")) {
    const storage =
      firstMatch(name, /(\d+)\s*gb\s*(?:ssd|nvme)/i) || firstMatch(name, /(\d+)\s*tb/i);
    if (storage) {
      pushRow(
        rows,
        "Depolama",
        storage + (/\btb\b/i.test(name) ? " TB" : " GB") + (/\bnvme\b/i.test(name) ? " NVMe" : /\bssd\b/i.test(name) ? " SSD" : "")
      );
    }
  }
  const size =
    firstMatch(name, /(\d+(?:[.,]\d+)?)\s*"/) ||
    firstMatch(name, /(\d+(?:[.,]\d+)?)\s*(?:inch|inç)/i);
  if (size && !rows.some((row) => row.label === "Ekran boyutu")) {
    pushRow(rows, "Ekran boyutu", size.replace(",", ".") + '"');
  }
  const res = normalizeResolutionFromTitle(name);
  if (res && !rows.some((row) => row.label === "Çözünürlük")) pushRow(rows, "Çözünürlük", res);
  const model = extractModelCode(name);
  if (model) pushRow(rows, "Model", model);
  const panel = firstMatch(name, /\b(ips|tn|va|oled)\b/i);
  if (panel && !rows.some((row) => row.label === "Panel")) pushRow(rows, "Panel", panel.toUpperCase());
  const refresh = firstMatch(name, /(\d{2,3})\s*hz/i);
  if (refresh && !rows.some((row) => row.label === "Tazeleme")) pushRow(rows, "Tazeleme", refresh + " Hz");
  const gpu =
    firstMatch(name, /(geforce\s*(?:rtx|gtx)\s*\d+\s*\w*)/i) ||
    firstMatch(name, /(radeon\s*(?:rx)?\s*\d+\s*\w*)/i) ||
    firstMatch(name, /(iris xe|uhd\s*\d+|radeon\s*graphics)/i);
  if (gpu && !rows.some((row) => row.label === "GPU")) pushRow(rows, "GPU", gpu.toUpperCase());
  return rows;
}

function extractCpuRows(name) {
  const rows = [];
  const model = extractCpuModel(name);
  if (model) pushRow(rows, "İşlemci", model);
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
  const rows = rowsFromChips(parseProductSpecChips(name));
  const cap = firstMatch(name, /(\d+)\s*gb/i);
  if (cap && !rows.some((row) => row.label === "Kapasite")) pushRow(rows, "Kapasite", cap + " GB");
  const type = firstMatch(name, /(ddr[345])/i);
  if (type && !rows.some((row) => row.label === "Bellek tipi")) pushRow(rows, "Bellek tipi", type.toUpperCase());
  const speed = firstMatch(name, /(\d{4,5})\s*mhz/i);
  if (speed && !rows.some((row) => row.label === "Hız")) pushRow(rows, "Hız", speed + " MHz");
  const latency = firstMatch(name, /\bcl\s*(\d{1,2})\b/i);
  if (latency) pushRow(rows, "Gecikme", "CL" + latency);
  const form = firstMatch(name, /(so-dimm|sodimm|dimm|udimm)/i);
  if (form && !rows.some((row) => row.label === "Form faktör")) {
    pushRow(rows, "Form faktör", form.toUpperCase().replace("SO-DIMM", "SO-DIMM"));
  }
  if (/\bnon[-\s]?ecc\b/i.test(name)) pushRow(rows, "Tip", "Non-ECC");
  else if (/\becc\b/i.test(name)) pushRow(rows, "Tip", "ECC");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractStorageRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const depoRow = rows.find((row) => row.label === "Depolama");
  if (depoRow && !rows.some((row) => row.label === "Kapasite")) {
    pushRow(rows, "Kapasite", depoRow.value.replace(/\s*depolama$/i, ""));
  }
  const cap =
    firstMatch(name, /(\d+)\s*gb\s*(?:ssd|nvme|m\.2|hdd)/i) ||
    firstMatch(name, /(\d+)\s*tb\b/i);
  if (cap && !rows.some((row) => row.label === "Kapasite")) {
    pushRow(rows, "Kapasite", cap + (/\d+\s*tb\b/i.test(name) ? " TB" : " GB"));
  }
  if (/\bnvme\b/i.test(name) && !rows.some((row) => row.label === "Arayüz")) pushRow(rows, "Arayüz", "NVMe");
  else if (/\bm\.2\b/i.test(name) && !rows.some((row) => row.label === "Form faktör")) pushRow(rows, "Form faktör", "M.2");
  else if (/\bssd\b/i.test(name) && !rows.some((row) => row.label === "Tür")) pushRow(rows, "Tür", "SSD");
  else if (/\bhdd\b/i.test(name) && !rows.some((row) => row.label === "Tür")) pushRow(rows, "Tür", "HDD");
  const pcie = firstMatch(name, /pcie\s*(gen\s*)?([345]\.?\d?)/i);
  if (pcie) pushRow(rows, "Arayüz", "PCIe Gen " + pcie.replace(/gen\s*/i, ""));
  const read = firstMatch(name, /(\d{3,5})\s*mb\/s\s*(?:okuma|read)/i);
  const write = firstMatch(name, /(\d{3,5})\s*mb\/s\s*(?:yazma|write)/i);
  if (read) pushRow(rows, "Okuma hızı", read + " MB/s");
  if (write) pushRow(rows, "Yazma hızı", write + " MB/s");
  const usb = firstMatch(name, /usb\s*(\d+(?:\.\d+)?)/i);
  if (usb && !rows.some((row) => row.label === "Bağlantı")) pushRow(rows, "Bağlantı", "USB " + usb);
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractMonitorRows(name) {
  const rows = [];
  const size =
    firstMatch(name, /(\d+(?:[.,]\d+)?)\s*"/) ||
    firstMatch(name, /(\d+(?:[.,]\d+)?)\s*(?:inch|inç)/i);
  if (size) pushRow(rows, "Ekran boyutu", size.replace(",", ".") + '"');
  const res = normalizeResolutionFromTitle(name);
  if (res) pushRow(rows, "Çözünürlük", res);
  const refresh = firstMatch(name, /(\d{2,3})\s*hz/i);
  if (refresh) pushRow(rows, "Tazeleme", refresh + " Hz");
  const panel = firstMatch(name, /\b(ips|tn|va|oled)\s*(?:panel)?\b/i);
  if (panel) pushRow(rows, "Panel", panel.toUpperCase());
  const response = firstMatch(name, /(\d+(?:[.,]\d+)?)\s*ms\b/i);
  if (response) pushRow(rows, "Yanıt süresi", response.replace(",", ".") + " ms");
  const ports = extractMonitorPorts(name);
  if (ports) pushRow(rows, "Bağlantılar", ports);
  if (/\bslim\s*(?:frame|bezel|çerçeve)\b/i.test(name)) {
    pushRow(rows, "Kasa", "İnce çerçeve");
  }
  const model = extractModelCode(name);
  if (model) pushRow(rows, "Model", model);
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractPrinterRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  if (/mono|siyah\s*beyaz|laser/i.test(name) && !rows.some((row) => row.label === "Baskı")) {
    pushRow(rows, "Baskı", "Mono laser");
  } else if (/renkli|color/i.test(name) && !rows.some((row) => row.label === "Baskı")) {
    pushRow(rows, "Baskı", "Renkli");
  } else if (/inkjet/i.test(name) && !rows.some((row) => row.label === "Baskı")) {
    pushRow(rows, "Baskı", "Inkjet");
  }
  if (/cok fonksiyon|çok fonksiyon|mfp|multifunction/i.test(name)) {
    pushRow(rows, "Tip", "Çok fonksiyonlu");
  }
  const ppm = firstMatch(name, /(\d+)\s*ppm/i);
  if (ppm && !rows.some((row) => row.label === "Hız")) pushRow(rows, "Hız", ppm + " ppm");
  const dpi = firstMatch(name, /(\d{3,5})\s*x\s*(\d{3,5})\s*dpi/i) || firstMatch(name, /(\d{3,5})\s*dpi/i);
  if (dpi) pushRow(rows, "Çözünürlük", dpi.includes("x") ? dpi + " dpi" : dpi + " dpi");
  if (/\ba3\b/i.test(name)) pushRow(rows, "Kağıt", "A3");
  else if (/\ba4\b/i.test(name)) pushRow(rows, "Kağıt", "A4");
  const compat = firstMatch(name, /(?:uyumlu|for|için)\s+(.{3,80})$/i);
  if (compat) pushRow(rows, "Uyumluluk", compat);
  const wifi = /\bwifi\b/i.test(name) || /\bwi-fi\b/i.test(name);
  if (wifi) pushRow(rows, "Kablosuz", "Wi-Fi");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractTonerRows(name) {
  const rows = [];
  if (/siyah|black/i.test(name)) pushRow(rows, "Renk", "Siyah");
  else if (/magenta|kirmizi|kırmızı/i.test(name)) pushRow(rows, "Renk", "Magenta");
  else if (/cyan|mavi/i.test(name)) pushRow(rows, "Renk", "Cyan");
  else if (/yellow|sari|sarı/i.test(name)) pushRow(rows, "Renk", "Sarı");
  pushRow(rows, "Tip", /muadil|compatible/i.test(name) ? "Muadil toner" : "Orijinal toner");
  const code = firstMatch(name, /\b(CRG|CF|CE|W\d+|TN\d+|TK\d+)[-\s]?[\w-]*/i);
  if (code) pushRow(rows, "Model", code.toUpperCase());
  // "1.500 Sayfa" / "2,600 page": binlik ayırıcı sayının parçasıdır.
  const yieldRaw = firstMatch(name, /(\d{1,3}(?:[.,]\d{3})+|\d{3,6})\s*(?:sayfa|page)/i);
  if (yieldRaw) {
    const pages = yieldRaw.replace(/[.,]/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    pushRow(rows, "Kapasite", pages + " sayfa");
  }
  const compat = firstMatch(name, /(?:for|uyumlu|için)\s+(.{3,80})$/i);
  if (compat) pushRow(rows, "Uyumlu model", compat);
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractGpuRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const model =
    firstMatch(name, /(geforce\s*(?:rtx|gtx)\s*\d+\s*\w*)/i) ||
    firstMatch(name, /(radeon\s*(?:rx)?\s*\d+\s*\w*)/i);
  if (model && !rows.some((row) => row.label === "GPU")) pushRow(rows, "GPU", model.toUpperCase());
  const vram =
    firstMatch(name, /(\d+)\s*gb\s*(?:gddr\d|vram|grafik)/i) ||
    (/\bgddr|vram|ekran kart/i.test(name) ? firstMatch(name, /(\d+)\s*gb/i) : "");
  if (vram && !rows.some((row) => row.label === "Bellek")) pushRow(rows, "Bellek", vram + " GB");
  const memType = firstMatch(name, /(gddr[567])/i);
  if (memType) pushRow(rows, "Bellek tipi", memType.toUpperCase());
  const pcie = firstMatch(name, /pcie\s*(gen\s*)?([345]\.?\d?)/i);
  if (pcie) pushRow(rows, "Arayüz", "PCIe Gen " + pcie.replace(/gen\s*/i, ""));
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractMotherboardRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const socket =
    firstMatch(name, /(?:soket|socket)\s*(lga\s*\d+|am[45]|s\d+)/i) ||
    firstMatch(name, /\b(lga\s*\d+|am[45])\b/i);
  if (socket && !rows.some((row) => row.label === "Soket")) {
    pushRow(rows, "Soket", socket.replace(/\s+/g, " ").toUpperCase());
  }
  const chipset =
    firstMatch(name, /\b([bzxqhm]\d{3,4}[a-z]?|x\d{3,4}[a-z]?|a\d{3,4}[a-z]?)\b/i);
  if (chipset && !rows.some((row) => row.label === "Chipset")) pushRow(rows, "Chipset", chipset.toUpperCase());
  const mem = firstMatch(name, /(ddr[345])/i);
  if (mem && !rows.some((row) => row.label === "Bellek tipi")) pushRow(rows, "Bellek tipi", mem.toUpperCase());
  const form =
    firstMatch(name, /\b(atx|micro\s*-?\s*atx|matx|mini\s*-?\s*itx|itx|e-atx)\b/i);
  if (form) pushRow(rows, "Form faktör", form.replace(/\s+/g, " ").toUpperCase());
  if (/\bwifi\s*6e\b/i.test(name)) pushRow(rows, "Kablosuz", "Wi-Fi 6E");
  else if (/\bwifi\s*6\b/i.test(name)) pushRow(rows, "Kablosuz", "Wi-Fi 6");
  else if (/\bwi-?fi\b/i.test(name)) pushRow(rows, "Kablosuz", "Wi-Fi");
  const m2 = firstMatch(name, /(\d+)\s*x\s*m\.?\s*2/i);
  if (m2) pushRow(rows, "M.2 yuva", m2);
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractPsuRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const watt = firstMatch(name, /(\d{3,4})\s*w\b/i);
  if (watt && !rows.some((row) => row.label === "Güç")) pushRow(rows, "Güç", watt + " W");
  if (/\b80\s*\+\s*platinum\b/i.test(name)) pushRow(rows, "Verimlilik", "80+ Platinum");
  else if (/\b80\s*\+\s*titanium\b/i.test(name)) pushRow(rows, "Verimlilik", "80+ Titanium");
  else if (/\b80\s*\+\s*gold\b/i.test(name)) pushRow(rows, "Verimlilik", "80+ Gold");
  else if (/\b80\s*\+\s*silver\b/i.test(name)) pushRow(rows, "Verimlilik", "80+ Silver");
  else if (/\b80\s*\+\s*bronze\b/i.test(name)) pushRow(rows, "Verimlilik", "80+ Bronze");
  if (/moduler|modüler|fully modular|tam moduler|tam modüler/i.test(name)) {
    pushRow(rows, "Tip", "Modüler");
  }
  if (/\batx\b/i.test(name)) pushRow(rows, "Form faktör", "ATX");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractCaseRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const form = firstMatch(name, /\b(mid\s*tower|full\s*tower|mini\s*tower|micro\s*atx|atx|itx)\b/i);
  if (form) pushRow(rows, "Form faktör", form.replace(/\s+/g, " ").toUpperCase());
  if (/tempered\s*glass|temperli\s*cam/i.test(name)) pushRow(rows, "Panel", "Temperli cam");
  if (/\brgb\b/i.test(name)) pushRow(rows, "Aydınlatma", "RGB");
  const fans = firstMatch(name, /(\d+)\s*x\s*(\d{2,3})\s*mm\s*fan/i);
  if (fans) pushRow(rows, "Fan", fans);
  const color = firstMatch(name, /\b(siyah|beyaz|gri|black|white|gray|grey)\b/i);
  if (color) pushRow(rows, "Renk", color.charAt(0).toUpperCase() + color.slice(1).toLowerCase());
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractCoolerRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const socket = firstMatch(name, /(?:soket|socket|uyumlu)\s*[:+]?\s*(lga\s*\d+|am[45](?:\s*,\s*(?:lga\s*\d+|am[45]))*)/i);
  if (socket) pushRow(rows, "Soket", socket.toUpperCase());
  const fan = firstMatch(name, /(\d{2,3})\s*mm\s*fan/i) || firstMatch(name, /(\d{2,3})\s*mm/i);
  if (fan) pushRow(rows, "Fan", fan + " mm");
  const tdp = firstMatch(name, /(\d{2,3})\s*w\s*tdp/i) || firstMatch(name, /tdp\s*(\d{2,3})\s*w/i);
  if (tdp) pushRow(rows, "TDP", tdp + " W");
  if (/sivi|sıvı|liquid|aio/i.test(name)) pushRow(rows, "Tip", "Sıvı soğutma");
  else if (/hava|air/i.test(name)) pushRow(rows, "Tip", "Hava soğutma");
  if (/\brgb\b/i.test(name)) pushRow(rows, "Aydınlatma", "RGB");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractNetworkRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const ports = firstMatch(name, /(\d+)\s*(?:port|portlu|kanal)/i);
  if (ports) pushRow(rows, "Port", ports);
  if (/\b10\s*g(?:b)?(?:ps|bit)?\b/i.test(name)) pushRow(rows, "Hız", "10 Gbps");
  else if (/\bgigabit\b|\b1000\s*mbps\b|\b1\s*gbps\b/i.test(name)) pushRow(rows, "Hız", "Gigabit");
  if (/\bwifi\s*6e\b/i.test(name)) pushRow(rows, "Kablosuz", "Wi-Fi 6E");
  else if (/\bwifi\s*6\b/i.test(name)) pushRow(rows, "Kablosuz", "Wi-Fi 6");
  else if (/\bwifi\s*5\b/i.test(name)) pushRow(rows, "Kablosuz", "Wi-Fi 5");
  if (/\bpoe\+?\b/i.test(name)) pushRow(rows, "PoE", "Destekler");
  if (/\brouter\b/i.test(name)) pushRow(rows, "Tip", "Router");
  else if (/\bswitch\b/i.test(name)) pushRow(rows, "Tip", "Switch");
  else if (/\bmodem\b/i.test(name)) pushRow(rows, "Tip", "Modem");
  else if (/access point|ap\b/i.test(name)) pushRow(rows, "Tip", "Access Point");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractUpsRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  const va = firstMatch(name, /(\d{3,5})\s*va\b/i) || firstMatch(name, /(\d+(?:[.,]\d+)?)\s*kva\b/i);
  if (va && !rows.some((row) => row.label === "VA")) {
    pushRow(rows, "VA", /\bkva\b/i.test(name) ? va.replace(",", ".") + " kVA" : va + " VA");
  }
  const watt = firstMatch(name, /(\d{3,4})\s*w\b/i);
  if (watt && !rows.some((row) => row.label === "Çıkış gücü")) pushRow(rows, "Çıkış gücü", watt + " W");
  if (/online\b/i.test(name)) pushRow(rows, "Tip", "Online UPS");
  else if (/line-interactive|line interactive/i.test(name)) pushRow(rows, "Tip", "Line-interactive");
  const outlets = firstMatch(name, /(\d+)\s*(?:priz|çıkış|outlet)/i);
  if (outlets) pushRow(rows, "Çıkış", outlets + " priz");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractPeripheralRows(name) {
  const rows = rowsFromChips(parseProductSpecChips(name));
  if (/\bklavye\b|\bkeyboard\b/i.test(name)) pushRow(rows, "Tip", "Klavye");
  else if (/\bmouse\b|\bfare\b/i.test(name)) pushRow(rows, "Tip", "Mouse");
  else if (/\bkulaklik|kulaklık|headset\b/i.test(name)) pushRow(rows, "Tip", "Kulaklık");
  else if (/\bwebcam\b/i.test(name)) pushRow(rows, "Tip", "Webcam");
  else if (/\bhoparlör|hoparlor|speaker\b/i.test(name)) pushRow(rows, "Tip", "Hoparlör");
  const dpi = firstMatch(name, /(\d{3,5})\s*dpi/i);
  if (dpi) pushRow(rows, "DPI", dpi);
  const layout = firstMatch(name, /\b(tr|turkish|türk|ingilizce|english|qwerty)\b/i);
  if (layout && /\bklavye\b/i.test(name)) pushRow(rows, "Düzen", layout.toUpperCase());
  if (/\bkablosuz\b|\bwireless\b/i.test(name)) pushRow(rows, "Bağlantı", "Kablosuz");
  else if (/\busb\b/i.test(name)) pushRow(rows, "Bağlantı", "USB");
  if (/\bbluetooth\b/i.test(name)) pushRow(rows, "Kablosuz", "Bluetooth");
  return rows.length ? rows : rowsFromChips(parseProductSpecChips(name));
}

function extractGenericRows(product) {
  const rows = rowsFromChips(parseProductSpecChips(product.name));
  const model = extractModelCode(product.name);
  if (model) pushRow(rows, "Model", model);
  return rows;
}

function stripBrandPrefix(name, brand) {
  let text = normalizeText(name);
  const brandText = normalizeText(brand);
  if (!brandText) return text;
  const lower = trLowerCase(text);
  const brandLower = trLowerCase(brandText);
  if (lower.startsWith(brandLower)) return text.slice(brandText.length).trim();
  return text;
}

function segmentAlreadyCovered(segment, rows) {
  const key = canonicalKey(segment);
  if (!key || key.length < 3) return true;
  return rows.some((row) => {
    const val = canonicalKey(row.value);
    const label = canonicalKey(row.label);
    return val.includes(key) || key.includes(val) || label.includes(key);
  });
}

function extractTitleFeatureSegments(name, brand, rows) {
  const text = stripBrandPrefix(name, brand);
  const parts = text
    .split(/\s*[|,;/]\s*|\s+-\s+|\s+\+\s+/)
    .flatMap((part) => part.split(/\s{2,}/))
    .map((part) => normalizeText(part))
    .filter((part) => part.length >= 4 && part.length <= 120);
  const features = [];
  parts.forEach((part) => {
    if (segmentAlreadyCovered(part, rows)) return;
    if (/^(ve|ile|için|and|the|new|orijinal|muadil)$/i.test(part)) return;
    features.push(part);
  });
  if (!features.length && text.length >= 8 && !segmentAlreadyCovered(text, rows)) {
    features.push(text.slice(0, 160));
  }
  return features;
}

function categoryDisplayLabel(kind) {
  const raw = CATEGORY_LABELS[kind] || CATEGORY_LABELS.generic;
  return raw.charAt(0).toLocaleUpperCase("tr-TR") + raw.slice(1);
}

function padSpecRows(product, kind, rows) {
  if (!rows.some((row) => row.label === "Ürün tipi")) {
    pushRow(rows, "Ürün tipi", categoryDisplayLabel(kind));
  }
  const features = extractTitleFeatureSegments(product.name, product.brand, rows);
  let featureIndex = 1;
  features.forEach((feat) => {
    if (countContentRows(rows) >= MIN_CONTENT_ROWS + 2) return;
    const label = featureIndex === 1 ? "Öne çıkan özellik" : "Öne çıkan özellik " + featureIndex;
    pushRow(rows, label, feat);
    featureIndex += 1;
  });
  // A short table beats invented rows: no "Vitrin özeti / Katalog notu / Ek bilgi" filler.
  return rows;
}

/** Filler rows older builds wrote into stored spec tables; their presence forces regeneration. */
const LEGACY_FILLER_LABEL_RE = /^(?:vitrin özeti|katalog notu|ek bilgi(?: \d+)?)$/;

function hasLegacyFillerRows(rows) {
  return rows.some((row) => LEGACY_FILLER_LABEL_RE.test(rowLabelKey(row.label)));
}

const LEGACY_SOURCING_NOTE_RE = /\s*Teknik satırlar ürün adı ve katalog bilgisinden derlenmiştir\./g;

function stripLegacySourcingNote(text) {
  return String(text || "").replace(LEGACY_SOURCING_NOTE_RE, "").trim();
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
    case "motherboard":
      rows = extractMotherboardRows(name);
      break;
    case "psu":
      rows = extractPsuRows(name);
      break;
    case "case":
      rows = extractCaseRows(name);
      break;
    case "cooler":
      rows = extractCoolerRows(name);
      break;
    case "network":
      rows = extractNetworkRows(name);
      break;
    case "ups":
      rows = extractUpsRows(name);
      break;
    case "peripheral":
      rows = extractPeripheralRows(name);
      break;
    default:
      rows = extractGenericRows(product);
      break;
  }
  rows = padSpecRows(product, kind, rows);
  // XML'de üretici kodu boşsa alan tedarikçi stok koduyla dolar; o kod vitrinde gösterilmez.
  if (product.manufacturerCode && product.manufacturerCode !== product.supplierSku) {
    pushRow(rows, "Üretici kodu", product.manufacturerCode);
  }
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
  const model = (kind === "cpu" && extractCpuModel(product.name)) || extractModelCode(product.name);
  let intro = brand ? brand + " " + category : category.charAt(0).toUpperCase() + category.slice(1);
  if (model && !trLowerCase(intro).includes(trLowerCase(model))) {
    intro += " (" + model + ")";
  }
  const highlights = rows
    .filter((row) => {
      const key = rowLabelKey(row.label);
      if (META_SPEC_LABELS.has(key)) return false;
      if (key === "ürün tipi" || key.startsWith("öne çıkan özellik")) return false;
      if (kind === "cpu" && key === "işlemci") return false;
      return Boolean(normalizeText(row.value));
    })
    .slice(0, 5)
    .map((row) => row.value);
  if (highlights.length) {
    intro += " Öne çıkan: " + highlights.join(", ") + ".";
  }
  if (/\(upg\)|yükselt|upgrade/i.test(product.name || "")) {
    intro += " Bellek veya depolama yükseltmesi tedarikçi montajı olabilir.";
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

/** Descriptions stored by older builds end with the internal sourcing note; rebuild them. */
function staleGeneratedDescription(product) {
  const desc = normalizeText(product.description);
  return Boolean(desc) && /katalog bilgisinden derlenmiştir/i.test(desc);
}

function enrichProductCopy(product, options) {
  const opts = options || {};
  const name = String(product.name || "");
  const out = Object.assign({}, product);
  const skipDescription = Boolean(opts.skipDescription);
  const skipDetails = Boolean(opts.skipDetails);

  if (
    !skipDescription &&
    (!isUsableCopy(out.description, name) || staleGeneratedDescription(out))
  ) {
    out.description = buildGeneratedDescription(out);
  }
  if (!skipDetails && needsGeneratedDetails(out.details, name, out)) {
    const generated = buildGeneratedDetails(out);
    if (generated) out.details = generated;
    else if (isUsableCopy(out.description, name)) out.details = out.description;
  }
  if (out.description) out.description = stripLegacySourcingNote(out.description);
  out.details = stripLegacyFillerTableRows(out.details);
  return out;
}

function stripLegacyFillerTableRows(details) {
  const raw = String(details || "");
  if (!raw.startsWith("__SPEC_TABLE__")) return details;
  const rows = parseProductDetailSpecTable(raw);
  if (!hasLegacyFillerRows(rows)) return details;
  return formatSpecTable(rows.filter((row) => !LEGACY_FILLER_LABEL_RE.test(rowLabelKey(row.label))));
}

/**
 * Supplier rows are hydrated with `copyEnriched: false` (17k rows, ~9% reach the storefront).
 * Copy is generated only where it is shown and memoized per hydrated row object.
 */
const listedCopyMemo = new WeakMap();

function ensureListedProductCopy(product) {
  if (!product || typeof product !== "object" || product.copyEnriched !== false) return product;
  const hit = listedCopyMemo.get(product);
  if (hit) return hit;
  const enriched = enrichProductCopy(product, {
    skipDescription: product.descriptionOverridden === true,
    skipDetails: product.detailsOverridden === true,
  });
  enriched.copyEnriched = true;
  listedCopyMemo.set(product, enriched);
  return enriched;
}

function needsGeneratedCopy(product) {
  const name = String(product.name || "");
  return (
    !isUsableCopy(product.description, name) ||
    needsGeneratedDetails(product.details, name, product)
  );
}

module.exports = {
  detectProductKind,
  buildSpecRows,
  buildGeneratedDescription,
  buildGeneratedDetails,
  enrichProductCopy,
  ensureListedProductCopy,
  needsGeneratedCopy,
  needsGeneratedDetails,
  shouldRegenerateSpecTable,
  formatSpecTable,
  isUsableCopy,
  staleGeneratedDescription,
};
