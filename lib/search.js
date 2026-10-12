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

// Rows reused across editDistance calls; it runs for every vocabulary word of every search.
let distanceRows = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];

/** Optimal string alignment distance, bailing out once it exceeds `max`. */
function editDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (distanceRows[0].length <= b.length) {
    distanceRows = distanceRows.map(() => new Int32Array(b.length * 2 + 1));
  }
  let [prev2, prev, cur] = distanceRows;
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
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
    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare;
  }
  return prev[b.length];
}

function fuzzyAllowance(term) {
  // Model codes (150A, i5, 12400) must match exactly; a one-digit miss is a different product.
  if (term.length < 4 || /\d/.test(term)) return 0;
  return term.length >= 8 ? 2 : 1;
}

function fuzzyWordMatch(term, token, max) {
  if (token.length < 3) return false;
  if (editDistance(term, token, max) <= max) return true;
  return token.length > term.length && editDistance(term, token.slice(0, term.length), 1) <= 1;
}

function fuzzyTokenMatch(term, tokens) {
  const max = fuzzyAllowance(term);
  if (!max) return false;
  return tokens.some((token) => fuzzyWordMatch(term, token, max));
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

/**
 * Relevance score, or null when a query term is missing from the row. Row-by-row reference for
 * the token index below (tests hold both to the same answers); also scores rows outside an index.
 */
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

const QUERY_MEMO_SIZE = 32;

function addPostings(vocab, tokens, row) {
  new Set(tokens).forEach((token) => {
    const rows = vocab.get(token);
    if (rows) rows.push(row);
    else vocab.set(token, [row]);
  });
}

/**
 * Token index over a fixed row list: each distinct word is compared with a query term once,
 * instead of once per product that contains it (typo matching dominated search time).
 * Rows must not be renamed after indexing; build a new index when the catalog changes.
 */
function createSearchIndex(list) {
  const rows = Array.isArray(list) ? list : [];
  const entries = rows.map(searchEntry);
  const name = new Map();
  const brand = new Map();
  const category = new Map();
  entries.forEach((entry, row) => {
    addPostings(name, entry.nameTokens, row);
    addPostings(brand, entry.brandTokens, row);
    addPostings(category, tokenize(entry.category), row);
  });
  return {
    rows,
    entries,
    position: new Map(rows.map((item, row) => [item, row])),
    vocab: { name, brand, category },
    termMemo: new Map(),
    queryMemo: new Map(),
  };
}

function raise(scores, rows, score) {
  for (const row of rows) if (scores[row] < score) scores[row] = score;
}

/** termScore for every row at once: the same tiers, decided per distinct token. */
function termScores(index, term) {
  const hit = index.termMemo.get(term);
  if (hit) return hit;
  const scores = new Int8Array(index.rows.length);
  const max = fuzzyAllowance(term);
  index.vocab.name.forEach((rows, token) => {
    let score = 0;
    if (token === term) score = 10;
    else if (token.startsWith(term)) score = 7;
    else if (token.includes(term)) score = 5;
    else if (max && fuzzyWordMatch(term, token, max)) score = 3;
    if (score) raise(scores, rows, score);
  });
  index.vocab.brand.forEach((rows, token) => {
    const score = token === term ? 9 : max && fuzzyWordMatch(term, token, max) ? 3 : 0;
    if (score) raise(scores, rows, score);
  });
  index.vocab.category.forEach((rows, token) => {
    if (token.includes(term)) raise(scores, rows, 4);
  });
  if (index.termMemo.size > 256) index.termMemo.clear();
  index.termMemo.set(term, scores);
  return scores;
}

function categoryHits(index, words) {
  const hits = new Uint8Array(index.rows.length);
  index.vocab.category.forEach((rows, token) => {
    if (words.some((word) => token.includes(word))) rows.forEach((row) => (hits[row] = 1));
  });
  return hits;
}

/** scoreSearchEntry for every indexed row; null marks a row that misses a term. */
function scoreIndex(index, parsed) {
  const key = parsed.terms.join(" ") + "\u0000" + parsed.folded;
  const memo = index.queryMemo.get(key);
  if (memo) {
    index.queryMemo.delete(key);
    index.queryMemo.set(key, memo);
    return memo;
  }
  const count = index.rows.length;
  const totals = new Float64Array(count);
  const alive = new Uint8Array(count).fill(1);
  for (const term of parsed.terms) {
    const best = Int8Array.from(termScores(index, term));
    (SEARCH_SYNONYMS[term] || []).forEach((alt) => {
      const altScores = termScores(index, alt);
      for (let row = 0; row < count; row += 1) {
        if (altScores[row] - 1 > best[row]) best[row] = altScores[row] - 1;
      }
    });
    const intent = categoryHits(index, [term].concat(SEARCH_SYNONYMS[term] || []));
    for (let row = 0; row < count; row += 1) {
      if (!alive[row]) continue;
      if (best[row] <= 0) alive[row] = 0;
      else totals[row] += best[row] + (intent[row] ? 5 : 0);
    }
  }
  const asksAccessory = parsed.terms.some((term) => ACCESSORY_TERMS.includes(term));
  const scores = new Array(count).fill(null);
  for (let row = 0; row < count; row += 1) {
    if (!alive[row]) continue;
    const entry = index.entries[row];
    let total = totals[row];
    if (parsed.terms.length > 1 && entry.name.includes(parsed.folded)) total += 6;
    if (entry.name.startsWith(parsed.terms[0]) || entry.brand === parsed.terms[0]) total += 2;
    if (entry.accessory && !asksAccessory) total -= 8;
    scores[row] = total;
  }
  index.queryMemo.set(key, scores);
  if (index.queryMemo.size > QUERY_MEMO_SIZE) index.queryMemo.delete(index.queryMemo.keys().next().value);
  return scores;
}

/**
 * Filter + rank: every query term must match the name, brand or category (Turkish letters folded,
 * synonyms and one/two-letter typos tolerated). Returns rows ordered by relevance.
 * options.index: createSearchIndex() over a superset of `list` (the whole storefront), reused
 * across requests; rows missing from it are scored one by one.
 */
function searchProducts(list, query, options) {
  const rows = Array.isArray(list) ? list : [];
  const parsed = parseSearchTerms(query);
  if (!parsed.terms.length) return rows;
  const tieBreak = options && typeof options.tieBreak === "function" ? options.tieBreak : null;
  const searchIndex = options && options.index ? options.index : createSearchIndex(rows);
  const indexed = scoreIndex(searchIndex, parsed);
  const scored = [];
  rows.forEach((item, index) => {
    const row = searchIndex.position.get(item);
    const score = row === undefined ? scoreSearchEntry(searchEntry(item), parsed) : indexed[row];
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
  createSearchIndex,
  scoreSearchEntry,
  searchEntry,
  parseSearchTerms,
  editDistance,
  SEARCH_SYNONYMS,
};
