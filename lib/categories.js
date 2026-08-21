"use strict";

const fs = require("fs");
const path = require("path");
const {
  SCHEMA_VERSION,
  canonicalCategoryTree,
  hasCanonicalParents,
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

function setCategoryListLoader(fn) {
  categoryListLoader = typeof fn === "function" ? fn : null;
}

function dropRetiredParents(tree) {
  return (Array.isArray(tree) ? tree : []).filter(
    (parent) => parent && !RETIRED_PARENT_SLUGS.has(parent.slug)
  );
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

function withXmlNames(target, node) {
  const xmlNames = readXmlNames(node);
  if (xmlNames.length) target.xmlNames = xmlNames;
  return target;
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
  if (ara && alt) return "/urunler/" + parent + "/" + ara + "/" + alt;
  if (ara) return "/urunler/" + parent + "/" + ara;
  if (alt) return "/urunler/" + parent + "/" + alt;
  return "/urunler/" + parent;
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
      const list = dropRetiredParents(normalizeTree(parsed && parsed.categories));
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

  function save(categories) {
    const next = dropRetiredParents(normalizeTree(categories));
    writeCategoriesFile(file, { version: SCHEMA_VERSION, categories: next });
    return next;
  }

  return { list, publicList, save, file };
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
  dropRetiredParents,
  applyCategoryDrag,
  RETIRED_PARENT_SLUGS,
  createCategoryStore,
  resolveCategoryQuerySlug,
  terminalAraHasProducts,
};
