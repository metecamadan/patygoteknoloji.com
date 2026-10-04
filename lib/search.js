"use strict";

const { foldSearchText } = require("./tr-text");

const MAX_TERMS = 8;

/** Folded query term → alternatives shoppers use for the same product type. */
const SEARCH_SYNONYMS = {
  laptop: ["notebook"],
  dizustu: ["notebook"],
  notebook: ["laptop"],
  fare: ["mouse"],
  mouse: ["fare"],
  klavye: ["keyboard"],
  keyboard: ["klavye"],
  yazici: ["printer"],
  printer: ["yazici"],
  hdd: ["harddisk"],
  harddisk: ["hdd"],
  bellek: ["ram"],
  ram: ["bellek"],
  kulaklik: ["headset"],
  headset: ["kulaklik"],
  hoparlor: ["speaker"],
  speaker: ["hoparlor"],
  sarj: ["charger"],
  modem: ["router"],
  router: ["modem"],
};

/** Words that mark an accessory; such rows sink unless the query asks for the accessory itself. */
const ACCESSORY_TERMS = [
  "stand",
  "standi",
  "canta",
  "cantasi",
  "adaptor",
  "adaptoru",
  "sogutucu",
  "kilif",
  "etiket",
  "etiketi",
  "pad",
  "kablo",
  "kablosu",
  "aparat",
  "aparati",
  "koruyucu",
  "sticker",
  "yedek",
];

const entryMemo = new WeakMap();

function tokenize(folded) {
  return folded.split(/[^a-z0-9.]+/).filter(Boolean);
}

function searchEntry(item) {
  const hit = entryMemo.get(item);
  if (hit) return hit;
  const name = foldSearchText(item && item.name);
  const brand = foldSearchText(item && item.brand);
  const category = foldSearchText(
    [item && item.category, item && (item.siteMid || item.mid), item && (item.siteChild || item.alt)]
      .filter(Boolean)
      .join(" ")
  ).replace(/-/g, " ");
  const entry = {
    name,
    brand,
    category,
    nameTokens: tokenize(name),
    brandTokens: tokenize(brand),
    accessory: ACCESSORY_TERMS.some((word) => tokenize(name + " " + category).includes(word)),
  };
  if (item && typeof item === "object") entryMemo.set(item, entry);
  return entry;
}

/** Optimal string alignment distance, bailing out once it exceeds `max`. */
function editDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + 1);
      }
      cur[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

function fuzzyAllowance(term) {
  // Model codes (150A, i5, 12400) must match exactly; a one-digit miss is a different product.
  if (term.length < 4 || /\d/.test(term)) return 0;
  return term.length >= 8 ? 2 : 1;
}

function fuzzyTokenMatch(term, tokens) {
  const max = fuzzyAllowance(term);
  if (!max) return false;
  return tokens.some((token) => {
    if (token.length < 3) return false;
    if (editDistance(term, token, max) <= max) return true;
    return token.length > term.length && editDistance(term, token.slice(0, term.length), 1) <= 1;
  });
}

function termScore(term, entry) {
  if (entry.nameTokens.includes(term)) return 10;
  if (entry.brand === term || entry.brandTokens.includes(term)) return 9;
  if (entry.nameTokens.some((token) => token.startsWith(term))) return 7;
  if (entry.name.includes(term)) return 5;
  if (entry.category.includes(term)) return 4;
  if (fuzzyTokenMatch(term, entry.nameTokens) || fuzzyTokenMatch(term, entry.brandTokens)) return 3;
  return 0;
}

function bestTermScore(term, entry) {
  let best = termScore(term, entry);
  (SEARCH_SYNONYMS[term] || []).forEach((alt) => {
    const score = termScore(alt, entry) - 1;
    if (score > best) best = score;
  });
  return best;
}

function parseSearchTerms(query) {
  const folded = foldSearchText(query).trim();
  if (!folded) return { folded: "", terms: [] };
  const terms = tokenize(folded).slice(0, MAX_TERMS);
  return { folded, terms };
}

/** Relevance score, or null when a query term is missing from the row. */
function scoreSearchEntry(entry, parsed) {
  let total = 0;
  for (const term of parsed.terms) {
    const score = bestTermScore(term, entry);
    if (score <= 0) return null;
    total += score;
    const intent = [term].concat(SEARCH_SYNONYMS[term] || []);
    if (intent.some((word) => entry.category.includes(word))) total += 5;
  }
  if (parsed.terms.length > 1 && entry.name.includes(parsed.folded)) total += 6;
  if (entry.name.startsWith(parsed.terms[0]) || entry.brand === parsed.terms[0]) total += 2;
  if (entry.accessory && !parsed.terms.some((term) => ACCESSORY_TERMS.includes(term))) total -= 8;
  return total;
}

/**
 * Filter + rank: every query term must match the name, brand or category (Turkish letters folded,
 * synonyms and one/two-letter typos tolerated). Returns rows ordered by relevance.
 */
function searchProducts(list, query, options) {
  const rows = Array.isArray(list) ? list : [];
  const parsed = parseSearchTerms(query);
  if (!parsed.terms.length) return rows;
  const tieBreak = options && typeof options.tieBreak === "function" ? options.tieBreak : null;
  const scored = [];
  rows.forEach((item, index) => {
    const entry = searchEntry(item);
    const score = scoreSearchEntry(entry, parsed);
    if (score === null) return;
    const price = Number(item && item.price) || 0;
    scored.push({
      item,
      index,
      score: score + Math.min(Math.log10(price + 1), 5),
      tie: tieBreak ? tieBreak(item) : 0,
    });
  });
  scored.sort((a, b) => b.score - a.score || b.tie - a.tie || a.index - b.index);
  return scored.map((row) => row.item);
}

module.exports = {
  searchProducts,
  parseSearchTerms,
  editDistance,
  SEARCH_SYNONYMS,
};
