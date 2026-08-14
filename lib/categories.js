"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_PATH = path.join(__dirname, "..", "assets", "data", "categories.json");
const MAX_PARENTS = 24;
const MAX_CHILDREN = 40;

let categoryListLoader = null;

function slugifyCategory(input) {
  return String(input || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function setCategoryListLoader(fn) {
  categoryListLoader = typeof fn === "function" ? fn : null;
}

function mapLoadedTree(list) {
  return (Array.isArray(list) ? list : [])
    .filter((cat) => cat && cat.slug && cat.name)
    .map((cat) => ({
      slug: String(cat.slug),
      name: String(cat.name),
      active: cat.active !== false,
      children: Array.isArray(cat.children)
        ? cat.children
            .filter((child) => child && child.slug && child.name)
            .map((child) => ({
              slug: String(child.slug),
              name: String(child.name),
              active: child.active !== false,
            }))
        : [],
    }));
}

function loadCategories(filePath) {
  if (!filePath && typeof categoryListLoader === "function") {
    return mapLoadedTree(categoryListLoader());
  }
  const raw = fs.readFileSync(filePath || DEFAULT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return mapLoadedTree(parsed && parsed.categories);
}

function normalizeNode(node, fallbackName) {
  const name = String((node && node.name) || fallbackName || "")
    .trim()
    .slice(0, 80);
  if (!name) throw new Error("Kategori adı gerekli.");
  let slug = String((node && node.slug) || "").trim().toLowerCase();
  if (!slug) slug = slugifyCategory(name);
  slug = slug.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Kategori kodu geçersiz. Yalnızca küçük harf, rakam ve tire kullanın.");
  }
  return {
    slug,
    name,
    active: !(node && node.active === false),
  };
}

function normalizeTree(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_PARENTS) {
    throw new Error("En fazla " + MAX_PARENTS + " ana kategori eklenebilir.");
  }
  const parentSlugs = new Set();
  return list.map((cat, index) => {
    const parent = normalizeNode(cat, "Kategori " + (index + 1));
    if (parentSlugs.has(parent.slug)) {
      throw new Error("Ana kategori kodu tekrar ediyor: " + parent.slug);
    }
    parentSlugs.add(parent.slug);
    const children = Array.isArray(cat && cat.children) ? cat.children : [];
    if (children.length > MAX_CHILDREN) {
      throw new Error(parent.name + ": en fazla " + MAX_CHILDREN + " alt kategori.");
    }
    const childSlugs = new Set();
    parent.children = children.map((child, childIndex) => {
      const row = normalizeNode(child, "Alt " + (childIndex + 1));
      if (childSlugs.has(row.slug)) {
        throw new Error(parent.name + " içinde alt kategori kodu tekrar ediyor: " + row.slug);
      }
      childSlugs.add(row.slug);
      return row;
    });
    return parent;
  });
}

function publicCategories(list) {
  return mapLoadedTree(list)
    .filter((cat) => cat.active)
    .map((cat) => ({
      slug: cat.slug,
      name: cat.name,
      children: cat.children
        .filter((child) => child.active)
        .map((child) => ({ slug: child.slug, name: child.name })),
    }))
    .filter((cat) => cat.children.length > 0);
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

function assignedSiteCategory(product, categories) {
  const parentSlug = String(
    (product && (product.siteParent || product.siteParentSlug)) || ""
  ).trim();
  const childSlug = String(
    (product && (product.siteChild || product.siteChildSlug)) || ""
  ).trim();
  if (!parentSlug || !childSlug) return null;
  const { parent, child } = findCategory(categories, parentSlug, childSlug);
  if (!parent || !child) return null;
  return {
    parent,
    child,
    parentSlug,
    childSlug,
    label: parent.name + " › " + child.name,
  };
}

function hasSiteCategory(product, categories) {
  return Boolean(assignedSiteCategory(product, categories));
}

function writeCategoriesFile(file, value) {
  const { atomicWriteJson } = require("./supplier");
  atomicWriteJson(file, value);
}

function createCategoryStore(root, options) {
  const settings = options || {};
  const file = path.join(root, ".runtime", "categories.json");
  const seedPath = settings.seedPath || DEFAULT_PATH;

  function seed() {
    const seeded = normalizeTree(loadCategories(seedPath));
    writeCategoriesFile(file, { version: 1, categories: seeded });
    return seeded;
  }

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return normalizeTree(parsed && parsed.categories);
    } catch (_) {
      return seed();
    }
  }

  function list() {
    return read();
  }

  function publicList() {
    return publicCategories(read());
  }

  function save(categories) {
    const next = normalizeTree(categories);
    writeCategoriesFile(file, { version: 1, categories: next });
    return next;
  }

  return { list, publicList, save, file };
}

module.exports = {
  DEFAULT_PATH,
  MAX_PARENTS,
  MAX_CHILDREN,
  slugifyCategory,
  loadCategories,
  setCategoryListLoader,
  normalizeTree,
  publicCategories,
  findCategory,
  categoryHref,
  isValidCategoryPair,
  assignedSiteCategory,
  hasSiteCategory,
  createCategoryStore,
};
