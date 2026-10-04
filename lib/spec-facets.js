"use strict";

const { foldSearchText } = require("./tr-text");

/**
 * Spec filters parsed from product titles (the supplier feed has no structured spec fields).
 * Each extractor returns one display value or "" when the title does not state it.
 */
function cpuFamily(name) {
  const text = String(name || "");
  let m = text.match(/\bcore\s+ultra\s+([579])\b|\bultra\s+([579])\s+\d{3}/i);
  if (m) return "Core Ultra " + (m[1] || m[2]);
  m = text.match(/\b(?:core\s+)?i([3579])[\s-]+\d{4,5}|\bcore\s+i([3579])\b/i);
  if (m) return "Core i" + (m[1] || m[2]);
  m = text.match(/\bryzen\s*([3579])\b/i);
  if (m) return "Ryzen " + m[1];
  m = text.match(/\b(celeron|pentium|athlon|xeon)\b/i);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  if (/\b(apple\s+)?m[1-4](\s+(pro|max))?\s+(çip|chip|cpu)\b/i.test(text)) return "Apple M";
  return "";
}

function ramSize(name) {
  const text = String(name || "");
  const m =
    text.match(/(\d{1,3})\s*gb\s*(?:ram|ddr\d?|lpddr\d?x?)\b/i) ||
    (/\b(ssd|nvme|hdd)\b/i.test(text) ? text.match(/\b(\d{1,3})\s*gb\b(?!\s*(?:ssd|nvme|hdd|emmc|gddr|vram))/i) : null);
  if (!m) return "";
  const gb = Number(m[1]);
  return [4, 8, 12, 16, 24, 32, 40, 48, 64, 96, 128].includes(gb) ? gb + " GB" : "";
}

function storageSize(name) {
  const text = String(name || "");
  let m = text.match(/(\d(?:[.,]\d)?)\s*tb\s*(?:ssd|nvme|hdd|m\.2)?/i);
  if (m && /\b(ssd|nvme|hdd|m\.2|tb)\b/i.test(text)) return m[1].replace(",", ".") + " TB";
  m = text.match(/(128|240|256|480|500|512)\s*gb\s*(?:ssd|nvme|m\.2|emmc|hdd)/i);
  return m ? m[1] + " GB" : "";
}

function screenBand(name) {
  const m = String(name || "").match(/(\d{2}(?:[.,]\d)?)\s*(?:"|''|inç|inch|”)/i);
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

const SPEC_FACETS = [
  { key: "islemci", label: "İşlemci", parents: ["bilgisayar-tablet", "bilgisayar-bilesenleri"], extract: cpuFamily },
  { key: "ram", label: "Bellek (RAM)", parents: ["bilgisayar-tablet"], extract: ramSize },
  { key: "depolama", label: "Depolama", parents: ["bilgisayar-tablet"], extract: storageSize },
  { key: "ekran", label: "Ekran boyutu", parents: ["bilgisayar-tablet", "bilgisayar-bilesenleri"], extract: screenBand },
  { key: "tazeleme", label: "Tazeleme hızı", parents: ["bilgisayar-bilesenleri", "bilgisayar-tablet"], extract: refreshRate },
  { key: "renk", label: "Renk", parents: ["kartus-toner"], extract: tonerColor },
  { key: "tur", label: "Orijinal / muadil", parents: ["kartus-toner"], extract: originality },
];

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
function buildSpecFacets(list, parentSlug) {
  const rows = Array.isArray(list) ? list : [];
  if (rows.length < 4) return [];
  const groups = [];
  SPEC_FACETS.forEach((facet) => {
    if (parentSlug && !facet.parents.includes(parentSlug)) return;
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
