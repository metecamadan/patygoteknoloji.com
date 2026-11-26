"use strict";

const { foldSearchText } = require("./tr-text");
const { TONER_MID_SLUGS } = require("./site-category-schema");

/**
 * Spec filters parsed from product titles (the supplier feed has no structured spec fields).
 * Each extractor returns one display value or "" when the title does not state it.
 */
function cpuFamily(name) {
  const text = String(name || "");
  let m = text.match(/\bcore\s+ultra\s*([579])\b|\bultra\s*([579])[\s-]*\d{3}|\bu([579])[\s-]+\d{3}[a-z]?\b/i);
  if (m) return "Core Ultra " + (m[1] || m[2] || m[3]);
  m = text.match(/\b(?:core\s+)?c?i([3579])[\s-]+\d{4,5}|\bcore\s+i([3579])\b/i);
  if (m) return "Core i" + (m[1] || m[2]);
  m = text.match(/\bcore\s+([357])[\s-]+\d{3}[a-z]?\b/i);
  if (m) return "Core " + m[1];
  m = text.match(/\bryzen\s*([3579])\b/i);
  if (m) return "Ryzen " + m[1];
  m = text.match(/\b(celeron|pentium|athlon|xeon)\b/i);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  if (/\b(apple\s+)?m[1-4](\s+(pro|max))?\s+(çip|chip|cpu)\b/i.test(text)) return "Apple M";
  return "";
}

const DEVICE_RE = /\b(notebook|laptop|ultrabook|bilgisayar|mini\s*pc|all[\s-]*in[\s-]*one|aio|tablet)\b/i;
// "16GB 512GB", "16GB 1TB", "16GB 512SSD": RAM first, storage second.
const RAM_STORAGE_PAIR_RE = /\b(\d{1,2})\s*gb[\s,/+]+(\d{3,4}\s*(?:gb|ssd)|[124]\s*tb)\b/i;
// Tablets: "8-256GB".
const TABLET_PAIR_RE = /\b(\d{1,2})\s*-\s*(\d{2,4})\s*gb\b/i;

function ramSize(name) {
  const text = String(name || "");
  const m =
    text.match(/(\d{1,3})\s*gb\s*(?:ram|ddr\d?|lpddr\d?x?)\b/i) ||
    text.match(RAM_STORAGE_PAIR_RE) ||
    (DEVICE_RE.test(text) ? text.match(TABLET_PAIR_RE) : null) ||
    (DEVICE_RE.test(text) ? text.match(/\b(\d{1,2})\s*gb\b(?!\s*(?:ssd|nvme|hdd|emmc|gddr|vram|ekran))/i) : null);
  if (!m) return "";
  const gb = Number(m[1]);
  return [2, 3, 4, 6, 8, 12, 16, 24, 32, 40, 48, 64, 96, 128].includes(gb) ? gb + " GB" : "";
}

function storageLabel(raw) {
  const text = String(raw || "").toLowerCase().replace(/\s+/g, "");
  const tb = text.match(/^(\d(?:[.,]\d)?)tb$/);
  if (tb) return tb[1].replace(",", ".") + " TB";
  const gb = Number((text.match(/^(\d{1,4})(?:gb|ssd)$/) || [])[1]);
  if (!Number.isFinite(gb) || gb <= 0) return "";
  if (gb >= 1000 && gb % 1000 === 0) return gb / 1000 + " TB";
  // Notebook/SSD bands + USB/SD flash sizes.
  return [8, 16, 32, 64, 120, 128, 240, 250, 256, 480, 500, 512, 960].includes(gb) ? gb + " GB" : "";
}

function storageSize(name) {
  const text = String(name || "");
  const pair = text.match(RAM_STORAGE_PAIR_RE);
  if (pair) return storageLabel(pair[2]);
  const tablet = DEVICE_RE.test(text) ? text.match(TABLET_PAIR_RE) : null;
  if (tablet) return storageLabel(tablet[2] + "gb");
  // USB flash / SD: "128GB USB", "64 GB Micro SD" (skip USB 2.0/3.2 version numbers).
  if (/\b(usb|flash\s*bellek|microsd|micro\s*sd|sd\s*kart|haf[iı]za\s*kart)\b/i.test(text)) {
    let flash = text.match(/\b(8|16|32|64|128|256|512|1024)\s*gb\b/i);
    if (flash) return storageLabel(flash[1] + "gb");
    flash = text.match(/\b([124])\s*tb\b/i);
    if (flash) return storageLabel(flash[1] + "tb");
  }
  let m = text.match(/\b(\d(?:[.,]\d)?)\s*tb\b/i);
  if (m && /\b(ssd|nvme|hdd|m\.2|disk|harddisk)\b/i.test(text)) return storageLabel(m[1] + "tb");
  m = text.match(/\b(\d{3,4})\s*(?:gb\s*(?:ssd|nvme|m\.2|emmc|hdd)\b|ssd\b)/i);
  if (m) return storageLabel(m[1] + "gb");
  m = /\b(ssd|nvme|harddisk|harici disk|hdd)\b/i.test(text) || DEVICE_RE.test(text)
    ? text.match(/\b(\d{3,4})\s*gb\b/i)
    : null;
  return m ? storageLabel(m[1] + "gb") : "";
}

function ddrGen(name) {
  const text = String(name || "");
  if (/\bgddr\d?\b/i.test(text) && !/\bddr\s*[345]\b/i.test(text)) return "";
  const m = text.match(/\bddr\s*([345])\b/i);
  return m ? "DDR" + m[1] : "";
}

function vramSize(name) {
  const text = String(name || "");
  if (!/\b(geforce|radeon|rtx|gtx|gt\s*\d{3}|ekran\s*kart|gddr)\b/i.test(text)) return "";
  const m =
    text.match(/\b(\d{1,2})\s*gb\s*gddr\d?\b/i) ||
    text.match(/\b(\d{1,2})\s*gb\b(?!\s*ram)/i);
  const gb = m ? Number(m[1]) : 0;
  return [2, 4, 6, 8, 10, 12, 16, 24].includes(gb) ? gb + " GB" : "";
}

function gpuSeries(name) {
  const text = String(name || "");
  let m = text.match(/\brtx\s*(50|40|30|20)\d{2}/i);
  if (m) return "RTX " + m[1] + "xx";
  m = text.match(/\bgtx\s*(16|10)\d{2}/i);
  if (m) return "GTX " + m[1] + "xx";
  if (/\bgt\s*\d{3}\b/i.test(text)) return "GT";
  m = text.match(/\brx\s*(\d)\d{3}/i);
  if (m) return "Radeon RX " + m[1] + "xxx";
  return "";
}

function cpuSocket(name) {
  const text = String(name || "");
  let m = text.match(/\b(?:soket|socket)\s*(am[45]|lga\s*\d{3,4})\b/i);
  if (m) {
    const raw = m[1].replace(/\s+/g, "").toUpperCase();
    return raw.startsWith("LGA") ? "LGA " + raw.slice(3) : raw;
  }
  if (/\b(anakart|motherboard|islemci|işlemci)\b/i.test(text)) {
    if (/\bam5\b/i.test(text)) return "AM5";
    if (/\bam4\b/i.test(text)) return "AM4";
    if (/\blga\s*1700\b/i.test(text)) return "LGA 1700";
  }
  return "";
}

function connectionType(name) {
  const folded = foldSearchText(name);
  if (/\bkablosuz|wireless|bluetooth\b/.test(folded)) return "Kablosuz";
  if (/\bkablolu|wired\b/.test(folded)) return "Kablolu";
  if (/\busb\b/.test(folded) && !/\bkablosuz|wireless|bluetooth\b/.test(folded)) return "Kablolu";
  return "";
}

function printerColorMode(name) {
  const folded = foldSearchText(name);
  if (/\bmono\b/.test(folded) || /\bsiyah\s*beyaz\b/.test(folded)) return "Mono";
  if (/\brenkli|color|colour\b/.test(folded)) return "Renkli";
  return "";
}

function printerTech(name) {
  const folded = foldSearchText(name);
  if (/\btankli|ecotank|supertank|ink\s*tank\b/.test(folded)) return "Tanklı";
  if (/\blazer|laser\b/.test(folded)) return "Lazer";
  if (/\bmurekkep|inkjet|pixma|kartuslu\b/.test(folded)) return "Mürekkep";
  return "";
}

/** Mid slugs that make a title-parsed facet useful (coverage is still checked at query time). */
const PC_DEVICE_MIDS = ["tasinabilir-bilgisayarlar", "bilgisayarlar"];
const DISK_MIDS = ["diskler"];
const MONITOR_MIDS = ["monitorler-ve-aks"];
const MEMORY_MIDS = ["bellekler"];
const FLASH_MIDS = ["usb-ve-kart-bellek-urunleri"];
const GPU_MIDS = ["ekran-kartlari"];
const MB_MIDS = ["anakartlar"];
const CPU_MIDS = ["islemciler"];
const INPUT_MIDS = ["klavye-mouse-urunleri"];
const PRINTER_DEVICE_MIDS = ["yazici-tarayici"];

function screenBand(name) {
  const m = String(name || "").match(/(?<![\d.,])(\d{2}(?:[.,]\d{1,2})?)\s*(?:"|''|inç|inch|”)/i);
  if (!m) return "";
  const size = Number(m[1].replace(",", "."));
  if (!Number.isFinite(size) || size < 10 || size > 100) return "";
  if (size < 14) return "13\" ve altı";
  if (size < 15) return "14\"";
  if (size < 17) return "15–16\"";
  if (size < 22) return "17–21\"";
  if (size < 25) return "22–24\"";
  if (size < 30) return "27\"";
  return "32\" ve üzeri";
}

function refreshRate(name) {
  const m = String(name || "").match(/\b(\d{2,3})\s*hz\b/i);
  if (!m) return "";
  const hz = Number(m[1]);
  if (hz < 60 || hz > 540) return "";
  if (hz <= 75) return "60–75 Hz";
  if (hz <= 120) return "100–120 Hz";
  if (hz <= 180) return "144–180 Hz";
  return "200 Hz+";
}

function tonerColor(name) {
  const folded = foldSearchText(name);
  if (/\b(siyah|black|bk)\b/.test(folded)) return "Siyah";
  if (/\b(cyan|mavi)\b/.test(folded)) return "Mavi (Cyan)";
  if (/\b(magenta|kirmizi)\b/.test(folded)) return "Kırmızı (Magenta)";
  if (/\b(yellow|sari)\b/.test(folded)) return "Sarı (Yellow)";
  if (/\b(renkli|color|colour|cmy)\b/.test(folded)) return "Renkli";
  return "";
}

function originality(name) {
  const folded = foldSearchText(name);
  if (/\bmuadil\b/.test(folded)) return "Muadil";
  if (/\b(orijinal|orjinal|original|orjınal)\b/.test(folded)) return "Orijinal";
  return "";
}

/**
 * Spec filter groups by category. Values are parsed from titles on each listing request,
 * so newly imported products appear in filters as soon as they are in the catalog and
 * coverage thresholds pass (no separate rebuild job).
 */
const SPEC_FACETS = [
  {
    key: "islemci",
    label: "İşlemci",
    parents: ["bilgisayar-tablet", "bilgisayar-bilesenleri"],
    mids: PC_DEVICE_MIDS.concat(CPU_MIDS),
    extract: cpuFamily,
  },
  {
    key: "ram",
    label: "Bellek (RAM)",
    parents: ["bilgisayar-tablet", "bilgisayar-bilesenleri"],
    mids: PC_DEVICE_MIDS.concat(MEMORY_MIDS),
    extract: ramSize,
  },
  {
    key: "ddr",
    label: "DDR tipi",
    parents: ["bilgisayar-bilesenleri"],
    mids: MEMORY_MIDS,
    extract: ddrGen,
  },
  {
    key: "depolama",
    label: "Depolama",
    parents: ["bilgisayar-tablet", "bilgisayar-bilesenleri"],
    mids: PC_DEVICE_MIDS.concat(DISK_MIDS, FLASH_MIDS),
    extract: storageSize,
  },
  {
    key: "ekran",
    label: "Ekran boyutu",
    parents: ["bilgisayar-tablet"],
    mids: PC_DEVICE_MIDS.concat(MONITOR_MIDS),
    extract: screenBand,
  },
  {
    key: "tazeleme",
    label: "Tazeleme hızı",
    parents: ["bilgisayar-tablet"],
    mids: PC_DEVICE_MIDS.concat(MONITOR_MIDS),
    extract: refreshRate,
  },
  {
    key: "gpu",
    label: "Ekran kartı serisi",
    parents: ["bilgisayar-bilesenleri"],
    mids: GPU_MIDS,
    extract: gpuSeries,
  },
  {
    key: "vram",
    label: "Ekran kartı belleği",
    parents: ["bilgisayar-bilesenleri"],
    mids: GPU_MIDS,
    extract: vramSize,
  },
  {
    key: "soket",
    label: "Soket",
    parents: ["bilgisayar-bilesenleri"],
    mids: MB_MIDS.concat(CPU_MIDS),
    extract: cpuSocket,
  },
  {
    key: "baglanti",
    label: "Bağlantı",
    parents: ["bilgisayar-tablet"],
    mids: INPUT_MIDS,
    extract: connectionType,
  },
  {
    key: "baski",
    label: "Baskı tipi",
    parents: ["baski-cozumleri"],
    mids: PRINTER_DEVICE_MIDS,
    extract: printerColorMode,
  },
  {
    key: "teknoloji",
    label: "Yazıcı teknolojisi",
    parents: ["baski-cozumleri"],
    mids: PRINTER_DEVICE_MIDS,
    extract: printerTech,
  },
  { key: "renk", label: "Renk", parents: ["baski-cozumleri"], mids: TONER_MID_SLUGS, extract: tonerColor },
  {
    key: "tur",
    label: "Orijinal / muadil",
    parents: ["baski-cozumleri"],
    mids: TONER_MID_SLUGS,
    extract: originality,
  },
];

function facetFitsScope(facet, parentSlug, midSlug) {
  if (!parentSlug) return true;
  if (!facet.parents.includes(parentSlug)) return false;
  return !midSlug || !facet.mids || facet.mids.includes(midSlug);
}

const FACET_BY_KEY = new Map(SPEC_FACETS.map((facet) => [facet.key, facet]));
const specMemo = new WeakMap();

function specValues(item) {
  if (!item || typeof item !== "object") return {};
  const hit = specMemo.get(item);
  if (hit) return hit;
  const values = {};
  SPEC_FACETS.forEach((facet) => {
    const value = facet.extract(item.name);
    if (value) values[facet.key] = value;
  });
  specMemo.set(item, values);
  return values;
}

/** `ozellik=ram:16 GB|32 GB,islemci:Core i5` → { ram: Set, islemci: Set } (unknown keys dropped). */
function parseSpecFilter(raw) {
  const out = {};
  String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12)
    .forEach((part) => {
      const idx = part.indexOf(":");
      if (idx <= 0) return;
      const key = part.slice(0, idx).trim();
      if (!FACET_BY_KEY.has(key)) return;
      const values = part
        .slice(idx + 1)
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!values.length) return;
      out[key] = new Set(values);
    });
  return out;
}

function matchesSpecFilter(item, filter) {
  const keys = Object.keys(filter);
  if (!keys.length) return true;
  const values = specValues(item);
  return keys.every((key) => values[key] && filter[key].has(values[key]));
}

/**
 * Facet groups for the current list: a group appears only when the category is relevant,
 * at least two values exist and the parsed values cover enough rows to be useful.
 */
function buildSpecFacets(list, parentSlug, midSlug) {
  const rows = Array.isArray(list) ? list : [];
  if (rows.length < 4) return [];
  const groups = [];
  SPEC_FACETS.forEach((facet) => {
    if (!facetFitsScope(facet, parentSlug, midSlug)) return;
    const counts = new Map();
    let covered = 0;
    rows.forEach((item) => {
      const value = specValues(item)[facet.key];
      if (!value) return;
      covered += 1;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    if (counts.size < 2 || covered < Math.max(3, rows.length * 0.25)) return;
    groups.push({
      key: facet.key,
      label: facet.label,
      values: Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "tr"))
        .slice(0, 12),
    });
  });
  return groups;
}

module.exports = {
  SPEC_FACETS,
  specValues,
  parseSpecFilter,
  matchesSpecFilter,
  buildSpecFacets,
};
