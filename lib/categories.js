"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_PATH = path.join(__dirname, "..", "assets", "data", "categories.json");

function loadCategories(filePath) {
  const raw = fs.readFileSync(filePath || DEFAULT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed && parsed.categories) ? parsed.categories : [];
  return list
    .filter((cat) => cat && cat.slug && cat.name)
    .map((cat) => ({
      slug: String(cat.slug),
      name: String(cat.name),
      children: Array.isArray(cat.children)
        ? cat.children
            .filter((child) => child && child.slug && child.name)
            .map((child) => ({
              slug: String(child.slug),
              name: String(child.name),
            }))
        : [],
    }));
}

function findCategory(categories, parentSlug, childSlug) {
  const parents = Array.isArray(categories) ? categories : [];
  const parent = parents.find((cat) => cat.slug === parentSlug) || null;
  if (!parentSlug) return { parent: null, child: null };
  if (!parent) return { parent: null, child: null };
  if (!childSlug) return { parent, child: null };
  const child = parent.children.find((row) => row.slug === childSlug) || null;
  return { parent, child };
}

function categoryHref(parentSlug, childSlug) {
  const params = new URLSearchParams();
  if (parentSlug) params.set("kategori", parentSlug);
  if (childSlug) params.set("alt", childSlug);
  const q = params.toString();
  return q ? "/urunler?" + q : "/urunler";
}

function isValidCategoryPair(categories, parentSlug, childSlug) {
  const { parent, child } = findCategory(categories, parentSlug, childSlug);
  if (!parentSlug) return true;
  if (!parent) return false;
  if (!childSlug) return true;
  return Boolean(child);
}

module.exports = {
  loadCategories,
  findCategory,
  categoryHref,
  isValidCategoryPair,
};
