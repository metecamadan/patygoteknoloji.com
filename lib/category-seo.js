"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE = path.join(__dirname, "..", "assets", "data", "category-seo.json");

let cached = null;

function loadCategorySeoData() {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) || { entries: {} };
  } catch (_) {
    cached = { entries: {} };
  }
  return cached;
}

/** Test helper: drop memo so fixture edits are visible. */
function resetCategorySeoCache() {
  cached = null;
}

function categorySeoPathKey(pathCats) {
  if (!pathCats || !pathCats.parent) return "";
  return [pathCats.parent, pathCats.mid, pathCats.child]
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("/");
}

function plain(text, max) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!max || value.length <= max) return value;
  return value.slice(0, max - 1).trim() + "…";
}

function fallbackCopy(names) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  const leaf = list[list.length - 1] || "Ürünler";
  const trail = list.length ? list.join(" › ") : leaf;
  return {
    h1: leaf,
    lead:
      leaf +
      " kategorisinde stoktaki ürünleri KDV dahil fiyatlarla inceleyin. " +
      trail +
      " altında güvenli ödeme ve hızlı kargo ile Patygo Teknoloji’den sipariş verebilirsiniz.",
    description: plain(
      leaf +
        " ürünleri KDV dahil fiyatlarla Patygo Teknoloji’de: " +
        trail +
        " kategorisinde stoktaki modeller, güvenli ödeme ve hızlı kargo.",
      160
    ),
  };
}

/**
 * SEO copy for a category path. Prefers curated assets/data/category-seo.json; otherwise
 * builds a unique fallback from the display-name trail (never empty lead).
 */
function resolveCategorySeo(pathCats, names) {
  const key = categorySeoPathKey(pathCats);
  const entry = key && loadCategorySeoData().entries && loadCategorySeoData().entries[key];
  const fallback = fallbackCopy(names);
  if (!entry || typeof entry !== "object") return Object.assign({ key, curated: false }, fallback);
  return {
    key,
    curated: true,
    h1: String(entry.h1 || fallback.h1).trim() || fallback.h1,
    lead: String(entry.lead || fallback.lead).trim() || fallback.lead,
    description: plain(entry.description || fallback.description, 160) || fallback.description,
  };
}

function categorySeoTitle(seo) {
  const h1 = (seo && seo.h1) || "Ürünler";
  return h1 + " Fiyatları ve Modelleri | Patygo Teknoloji";
}

module.exports = {
  categorySeoPathKey,
  resolveCategorySeo,
  categorySeoTitle,
  fallbackCopy,
  loadCategorySeoData,
  resetCategorySeoCache,
  DATA_FILE,
};
