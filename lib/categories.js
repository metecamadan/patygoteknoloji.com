"use strict";

const fs = require("fs");
const path = require("path");
const {
  SCHEMA_VERSION,
  MOVED_PARENTS,
  MOVED_MID_ORDER,
  canonicalCategoryTree,
  hasCanonicalParents,
  movedCategoryPath,
  resolveCategoryQuerySlug,
  sortParentsForNav,
} = require("./site-category-schema");

const DEFAULT_PATH = path.join(__dirname, "..", "assets", "data", "categories.json");
const MAX_PARENTS = 24;
const MAX_CHILDREN = 40;
const MAX_DEPTH = 2;
const RETIRED_PARENT_SLUGS = new Set(["cevre-birimleri"]);

let categoryListLoader = null;
let publicCategoryLeafKeysLoader = null;

function leafProductKey(parentSlug, midSlug, childSlug) {
  return (
    String(parentSlug || "").trim() +
    "\0" +
    String(midSlug || "").trim() +
    "\0" +
    String(childSlug || "").trim()
  );
}

function leafHasProducts(leafKeys, parentSlug, midSlug, childSlug) {
  if (!leafKeys) return true;
  return leafKeys.has(leafProductKey(parentSlug, midSlug, childSlug));
}

function terminalAraHasProducts(leafKeys, parentSlug, araSlug) {
  if (!leafKeys) return true;
  return (
    leafHasProducts(leafKeys, parentSlug, araSlug, "") ||
    leafHasProducts(leafKeys, parentSlug, "", araSlug)
  );
}

function resolvePublicLeafKeys(options) {
  if (options && options.leafKeys) return options.leafKeys;
  if (!publicCategoryLeafKeysLoader) return null;
  try {
    return publicCategoryLeafKeysLoader();
  } catch (_) {
    return null;
  }
}

function setPublicCategoryLeafKeysLoader(fn) {
  publicCategoryLeafKeysLoader = typeof fn === "function" ? fn : null;
}

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

let categoryStampLoader = null;

function setCategoryListLoader(fn, stampFn) {
  categoryListLoader = typeof fn === "function" ? fn : null;
  categoryStampLoader = categoryListLoader && typeof stampFn === "function" ? stampFn : null;
}

/** Cheap change marker for the live category tree; memo keys use it to notice menu edits. */
function categoryTreeStamp() {
  if (categoryListLoader) {
    return categoryStampLoader ? String(categoryStampLoader()) : JSON.stringify(categoryListLoader());
  }
  try {
    const stat = fs.statSync(DEFAULT_PATH);
    return stat.mtimeMs + ":" + stat.size;
  } catch (_) {
    return "";
  }
}

function dropRetiredParents(tree) {
  return (Array.isArray(tree) ? tree : []).filter(
    (parent) => parent && !RETIRED_PARENT_SLUGS.has(parent.slug)
  );
}

/** Same-slug nodes meet when a moved branch lands next to a copy: panel values of the moved one win. */
function mergeFoldedChildren(children, movedChildren) {
  const kids = Array.isArray(children) ? children.slice() : [];
  (movedChildren || []).forEach((moved) => {
    const same = kids.find((row) => row && row.slug === moved.slug);
    if (!same) {
      kids.push(moved);
      return;
    }
    const names = readXmlNames({ xmlNames: (same.xmlNames || []).concat(moved.xmlNames || []) });
    if (names.length) same.xmlNames = names;
    ["marginPercent", "criticalStockQty"].forEach((key) => {
      if (presentNumber(moved[key]) !== null) same[key] = moved[key];
    });
    if (moved.active === false) same.active = false;
    const merged = mergeFoldedChildren(same.children, moved.children);
    if (merged.length) same.children = merged;
  });
  return kids;
}

function orderMovedMids(children, order) {
  if (!Array.isArray(order) || !order.length) return children;
  const rank = (row, index) => {
    const at = order.indexOf(row && row.slug);
    return at >= 0 ? at : order.length + index;
  };
  return children
    .map((row, index) => ({ row, at: rank(row, index) }))
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.row);
}

/**
 * A moved parent (KARTUŞ TONER) folds into its target with margins, critical stock and XML aliases;
 * the target's mids are put in the agreed order once, later panel reordering stays.
 */
function foldMovedParents(tree) {
  let list = Array.isArray(tree) ? tree : [];
  Object.keys(MOVED_PARENTS).forEach((fromSlug) => {
    const from = list.find((row) => row && row.slug === fromSlug);
    const into = list.find((row) => row && row.slug === MOVED_PARENTS[fromSlug].into);
    if (!from || !into) return;
    into.xmlNames = readXmlNames({
      xmlNames: (into.xmlNames || []).concat(from.xmlNames || [], [from.name]),
    });
    into.children = orderMovedMids(
      mergeFoldedChildren(into.children, from.children),
      MOVED_MID_ORDER[into.slug]
    );
    list = list.filter((row) => row !== from);
  });
  return list;
}

function readXmlNames(node) {
  const raw = node && Array.isArray(node.xmlNames) ? node.xmlNames : [];
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    const name = String(item || "")
      .trim()
      .slice(0, 80);
    if (!name) return;
    const key = name.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  });
  return out.slice(0, 12);
}

const MAX_CATEGORY_MARGIN = 500;
const MAX_CATEGORY_CRITICAL_STOCK = 9999;

function presentNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Category margin is added on top of the slot's base margin; critical stock replaces the slot's. */
function readCategoryPricing(node) {
  const out = {};
  const margin = presentNumber(node && node.marginPercent);
  if (margin !== null) {
    out.marginPercent = Math.round(Math.min(MAX_CATEGORY_MARGIN, Math.max(0, margin)) * 100) / 100;
  }
  const critical = presentNumber(node && node.criticalStockQty);
  if (critical !== null) {
    out.criticalStockQty = Math.min(MAX_CATEGORY_CRITICAL_STOCK, Math.max(0, Math.floor(critical)));
  }
  return out;
}

function validateCategoryPricing(list, trail) {
  (Array.isArray(list) ? list : []).forEach((node) => {
    const name = [trail, String((node && node.name) || "").trim()].filter(Boolean).join(" › ");
    const margin = presentNumber(node && node.marginPercent);
    if (node && node.marginPercent !== undefined && node.marginPercent !== null && node.marginPercent !== "" && margin === null) {
      throw new Error(name + ": kategori marjı sayı olmalı.");
    }
    if (margin !== null && (margin < 0 || margin > MAX_CATEGORY_MARGIN)) {
      throw new Error(name + ": kategori marjı 0 ile " + MAX_CATEGORY_MARGIN + " arasında olmalı.");
    }
    const critical = presentNumber(node && node.criticalStockQty);
    if (node && node.criticalStockQty !== undefined && node.criticalStockQty !== null && node.criticalStockQty !== "" && critical === null) {
      throw new Error(name + ": kritik stok sayı olmalı.");
    }
    if (critical !== null && (critical < 0 || critical > MAX_CATEGORY_CRITICAL_STOCK || Math.floor(critical) !== critical)) {
      throw new Error(name + ": kritik stok 0 ile " + MAX_CATEGORY_CRITICAL_STOCK + " arasında tam sayı olmalı.");
    }
    validateCategoryPricing(node && node.children, name);
  });
}

function withXmlNames(target, node) {
  const xmlNames = readXmlNames(node);
  if (xmlNames.length) target.xmlNames = xmlNames;
  return Object.assign(target, readCategoryPricing(node));
}

/** Nearest own value from leaf up to the main category; null when no level sets one. */
function resolveCategoryPricing(assigned) {
  const chain = assigned ? [assigned.child, assigned.mid, assigned.parent].filter(Boolean) : [];
  const marginNode = chain.find((node) => Number.isFinite(node.marginPercent)) || null;
  const criticalNode = chain.find((node) => Number.isFinite(node.criticalStockQty)) || null;
  return {
    marginPercent: marginNode ? marginNode.marginPercent : null,
    marginCategory: marginNode ? marginNode.name : "",
    criticalStockQty: criticalNode ? criticalNode.criticalStockQty : null,
    criticalCategory: criticalNode ? criticalNode.name : "",
  };
}

function mapNode(node) {
  if (!node || !node.slug || !node.name) return null;
  return withXmlNames(
    {
      slug: String(node.slug),
      name: String(node.name),
      active: node.active !== false,
      children: Array.isArray(node.children)
        ? node.children.map(mapNode).filter(Boolean)
        : [],
    },
    node
  );
}

function cloneCategoryTree(tree) {
  return (Array.isArray(tree) ? tree : []).map(mapNode).filter(Boolean);
}

function moveArrayItem(list, fromIndex, toIndex) {
  const next = (list || []).slice();
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= next.length ||
    toIndex >= next.length
  ) {
    return null;
  }
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function applyCategoryDrag(tree, from, to) {
  if (!from || !to || from.kind !== to.kind) return null;
  if (from.kind === "parent") {
    return moveArrayItem(cloneCategoryTree(tree), from.index, to.index);
  }
  const next = cloneCategoryTree(tree);
  if (from.kind === "child" && from.parentIndex === to.parentIndex) {
    const parent = next[from.parentIndex];
    if (!parent) return null;
    const children = moveArrayItem(parent.children, from.childIndex, to.childIndex);
    if (!children) return null;
    parent.children = children;
    return next;
  }
  if (
    from.kind === "grandchild" &&
    from.parentIndex === to.parentIndex &&
    from.childIndex === to.childIndex
  ) {
    const parent = next[from.parentIndex];
    const mid = parent && parent.children[from.childIndex];
    if (!mid) return null;
    const children = moveArrayItem(mid.children, from.grandIndex, to.grandIndex);
    if (!children) return null;
    mid.children = children;
    return next;
  }
  return null;
}

function mapLoadedTree(list) {
  return cloneCategoryTree(list);
}

function loadCategories(filePath) {
  if (!filePath && typeof categoryListLoader === "function") {
    return mapLoadedTree(categoryListLoader());
  }
  try {
    const raw = fs.readFileSync(filePath || DEFAULT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const list = mapLoadedTree(parsed && parsed.categories);
    if (list.length) return list;
  } catch (_) {
    /* fall through to canonical schema */
  }
  return normalizeTree(canonicalCategoryTree());
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
  return withXmlNames(
    {
      slug,
      name,
      active: !(node && node.active === false),
    },
    node
  );
}

function normalizeLevel(list, depth, parentName) {
  const rows = Array.isArray(list) ? list : [];
  const max = depth === 0 ? MAX_PARENTS : MAX_CHILDREN;
  if (rows.length > max) {
    throw new Error(
      (parentName ? parentName + ": " : "") +
        "en fazla " +
        max +
        (depth === 0 ? " ana kategori eklenebilir." : " alt kategori.")
    );
  }
  const slugs = new Set();
  return rows.map((node, index) => {
    const fallback =
      depth === 0 ? "Kategori " + (index + 1) : depth === 1 ? "Ara " + (index + 1) : "Alt " + (index + 1);
    const row = normalizeNode(node, fallback);
    if (slugs.has(row.slug)) {
      throw new Error(
        (parentName ? parentName + " içinde " : "") + "kategori kodu tekrar ediyor: " + row.slug
      );
    }
    slugs.add(row.slug);
    if (depth < MAX_DEPTH) {
      row.children = normalizeLevel(node && node.children, depth + 1, row.name);
    } else {
      row.children = [];
    }
    return row;
  });
}

function normalizeTree(input) {
  return normalizeLevel(Array.isArray(input) ? input : [], 0, "");
}

function mapPublicAraNode(parentSlug, child, leafKeys) {
  const leaves = (child.children || []).filter((leaf) => leaf.active);
  if (leaves.length) {
    const visibleLeaves = leaves
      .filter((leaf) => leafHasProducts(leafKeys, parentSlug, child.slug, leaf.slug))
      .map((leaf) => ({ slug: leaf.slug, name: leaf.name }));
    if (!visibleLeaves.length) return null;
    return {
      slug: child.slug,
      name: child.name,
      children: visibleLeaves,
    };
  }
  if (!terminalAraHasProducts(leafKeys, parentSlug, child.slug)) return null;
  return { slug: child.slug, name: child.name };
}

function publicCategories(list, options) {
  const leafKeys = resolvePublicLeafKeys(options);
  return sortParentsForNav(
    mapLoadedTree(list)
      .filter((cat) => cat.active)
      .map((cat) => ({
        slug: cat.slug,
        name: cat.name,
        children: (cat.children || [])
          .filter((child) => child.active)
          .map((child) => mapPublicAraNode(cat.slug, child, leafKeys))
          .filter(Boolean),
      }))
      .filter((cat) => cat.children.length > 0)
  );
}

function findCategory(categories, parentSlug, midOrChildSlug, childSlug) {
  const parents = Array.isArray(categories) ? categories : [];
  const parent = parents.find((cat) => cat.slug === parentSlug) || null;
  if (!parentSlug) return { parent: null, mid: null, child: null };
  if (!parent) return { parent: null, mid: null, child: null };
  if (childSlug !== undefined) {
    const midSlug = String(midOrChildSlug || "").trim();
    const leafSlug = String(childSlug || "").trim();
    if (!midSlug && !leafSlug) return { parent, mid: null, child: null };
    if (midSlug) {
      const mid = (parent.children || []).find((row) => row.slug === midSlug) || null;
      if (!mid || !leafSlug) return { parent, mid, child: null };
      const child = (mid.children || []).find((row) => row.slug === leafSlug) || null;
      return { parent, mid, child };
    }
    const child = (parent.children || []).find((row) => row.slug === leafSlug) || null;
    return { parent, mid: null, child };
  }
  const childKey = String(midOrChildSlug || "").trim();
  if (!childKey) return { parent, mid: null, child: null };
  const direct = (parent.children || []).find((row) => row.slug === childKey) || null;
  return { parent, mid: null, child: direct };
}

function categoryHref(parentSlug, midSlug, childSlug) {
  const parent = String(parentSlug || "").trim();
  if (!parent) return "/urunler";
  const parts = ["/urunler", parent];
  if (arguments.length < 3) {
    const second = String(midSlug || "").trim();
    if (second) parts.push(second);
    return parts.join("/");
  }
  const mid = String(midSlug || "").trim();
  const child = String(childSlug || "").trim();
  if (mid) parts.push(mid);
  if (child) parts.push(child);
  return parts.join("/");
}

function categoryHrefPath(parentSlug, midSlug, childSlug) {
  return categoryHref(parentSlug, midSlug, childSlug);
}

function parseUrunlerPathname(pathname) {
  const raw = String(pathname || "").split("?")[0];
  const match = raw.match(/^\/urunler(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?\/?$/i);
  if (!match) return null;
  return {
    parent: String(match[1] || "").trim(),
    mid: String(match[2] || "").trim(),
    child: String(match[3] || "").trim(),
  };
}

function categoryQueryToPath(searchParams) {
  const params = searchParams || new URLSearchParams();
  const parent = String(params.get("kategori") || "").trim();
  if (!parent) return null;
  const ara = String(params.get("ara") || "").trim();
  const alt = String(params.get("alt") || "").trim();
  let target = "/urunler/" + parent;
  if (ara && alt) target += "/" + ara + "/" + alt;
  else if (ara || alt) target += "/" + (ara || alt);
  return movedCategoryPath(target) || target;
}

function isValidCategoryPair(categories, parentSlug, midOrChildSlug, childSlug) {
  const found = findCategory(categories, parentSlug, midOrChildSlug, childSlug);
  if (!parentSlug) return true;
  if (!found.parent) return false;
  if (childSlug !== undefined) {
    if (!midOrChildSlug && !childSlug) return true;
    if (midOrChildSlug && childSlug) return Boolean(found.mid && found.child);
    if (midOrChildSlug && !childSlug) return Boolean(found.mid);
    return Boolean(found.child);
  }
  if (!midOrChildSlug) return true;
  return Boolean(found.child);
}

function nodeIsLeaf(node) {
  return !node || !Array.isArray(node.children) || node.children.length === 0;
}

function assignedSiteCategory(product, categories) {
  const parentSlug = String(
    (product && (product.siteParent || product.siteParentSlug)) || ""
  ).trim();
  const midSlug = String((product && (product.siteMid || product.siteMidSlug)) || "").trim();
  const childSlug = String(
    (product && (product.siteChild || product.siteChildSlug)) || ""
  ).trim();
  if (!parentSlug || !childSlug) return null;
  if (midSlug) {
    const found = findCategory(categories, parentSlug, midSlug, childSlug);
    if (!found.parent || !found.mid || !found.child) return null;
    return {
      parent: found.parent,
      mid: found.mid,
      child: found.child,
      parentSlug,
      midSlug,
      childSlug,
      label: found.parent.name + " › " + found.mid.name + " › " + found.child.name,
    };
  }
  const found = findCategory(categories, parentSlug, childSlug);
  if (!found.parent || !found.child) return null;
  if (!nodeIsLeaf(found.child)) return null;
  return {
    parent: found.parent,
    mid: null,
    child: found.child,
    parentSlug,
    midSlug: "",
    childSlug,
    label: found.parent.name + " › " + found.child.name,
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
    const seeded = normalizeTree(canonicalCategoryTree());
    writeCategoriesFile(file, { version: SCHEMA_VERSION, categories: seeded });
    return seeded;
  }

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const fileVersion = Number(parsed && parsed.version) || 1;
      if (fileVersion < SCHEMA_VERSION) return seed();
      const list = foldMovedParents(dropRetiredParents(normalizeTree(parsed && parsed.categories)));
      const rawLen = Array.isArray(parsed && parsed.categories) ? parsed.categories.length : 0;
      if (list.length !== rawLen) {
        writeCategoriesFile(file, { version: SCHEMA_VERSION, categories: list });
      }
      return list;
    } catch (_) {
      return seed();
    }
  }

  function list() {
    return read();
  }

  function publicList(options) {
    return publicCategories(read(), options);
  }

  let saves = 0;

  function save(categories) {
    validateCategoryPricing(categories, "");
    const next = foldMovedParents(dropRetiredParents(normalizeTree(categories)));
    writeCategoriesFile(file, { version: SCHEMA_VERSION, categories: next });
    saves += 1;
    return next;
  }

  function stamp() {
    try {
      const stat = fs.statSync(file);
      return stat.mtimeMs + ":" + stat.size + ":" + saves;
    } catch (_) {
      return "missing:" + saves;
    }
  }

  return { list, publicList, save, stamp, file };
}

module.exports = {
  DEFAULT_PATH,
  MAX_PARENTS,
  MAX_CHILDREN,
  SCHEMA_VERSION,
  slugifyCategory,
  readXmlNames,
  loadCategories,
  setCategoryListLoader,
  categoryTreeStamp,
  setPublicCategoryLeafKeysLoader,
  leafProductKey,
  leafHasProducts,
  normalizeTree,
  publicCategories,
  findCategory,
  categoryHref,
  categoryHrefPath,
  parseUrunlerPathname,
  categoryQueryToPath,
  isValidCategoryPair,
  assignedSiteCategory,
  hasSiteCategory,
  resolveCategoryPricing,
  validateCategoryPricing,
  dropRetiredParents,
  foldMovedParents,
  applyCategoryDrag,
  RETIRED_PARENT_SLUGS,
  createCategoryStore,
  resolveCategoryQuerySlug,
  terminalAraHasProducts,
};
