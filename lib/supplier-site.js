"use strict";

const {
  slugifyCategory,
  normalizeTree,
  MAX_PARENTS,
  MAX_CHILDREN,
  dropRetiredParents,
} = require("./categories");
const { ensureRates } = require("./fx");

function cleanCategoryName(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function supplierCategoryNames(product) {
  return {
    main: cleanCategoryName(product && (product.xmlMainCategory || product.mainCategory)),
    mid: cleanCategoryName(product && (product.xmlMidCategory || product.midCategory)),
    sub: cleanCategoryName(product && (product.xmlSubCategory || product.subCategory)),
  };
}

function browseChildName(names) {
  const mid = names && names.mid;
  const sub = names && names.sub;
  if (sub && mid) {
    const subSlug = slugifyCategory(sub);
    const midSlug = slugifyCategory(mid);
    if (subSlug === midSlug || subSlug.endsWith("-" + midSlug) || subSlug.includes(midSlug)) {
      return mid;
    }
    return sub;
  }
  return sub || mid || "Genel";
}

function uniqueSlug(name, used) {
  let slug = slugifyCategory(name) || "kategori";
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let i = 2;
  while (used.has(slug + "-" + i)) i += 1;
  slug = slug + "-" + i;
  used.add(slug);
  return slug;
}

function buildTreeFromSupplierProducts(products) {
  const parents = new Map();
  for (const item of products || []) {
    const names = supplierCategoryNames(item);
    const parentName = names.main;
    const childName = browseChildName(names);
    if (!parentName) continue;
    if (!parents.has(parentName)) {
      parents.set(parentName, { name: parentName, children: new Map() });
    }
    const parent = parents.get(parentName);
    if (!parent.children.has(childName) && parent.children.size < MAX_CHILDREN) {
      parent.children.set(childName, { name: childName });
    }
  }
  const parentUsed = new Set();
  return Array.from(parents.values())
    .slice(0, MAX_PARENTS)
    .map((parent) => {
      const childUsed = new Set();
      return {
        name: parent.name,
        slug: uniqueSlug(parent.name, parentUsed),
        active: true,
        children: Array.from(parent.children.values()).map((child) => ({
          name: child.name,
          slug: uniqueSlug(child.name, childUsed),
          active: true,
        })),
      };
    })
    .filter((parent) => parent.children.length > 0);
}

function mergeCategoryTrees(existing, incoming) {
  const list = (existing || []).map((parent) => ({
    slug: parent.slug,
    name: parent.name,
    active: parent.active !== false,
    children: (parent.children || []).map((child) => ({
      slug: child.slug,
      name: child.name,
      active: child.active !== false,
    })),
  }));
  const bySlug = new Map(list.map((parent) => [parent.slug, parent]));
  const parentUsed = new Set(bySlug.keys());
  for (const parent of incoming || []) {
    if (list.length >= MAX_PARENTS && !bySlug.has(parent.slug)) continue;
    let current = bySlug.get(parent.slug);
    if (!current) {
      current = {
        slug: uniqueSlug(parent.name || parent.slug, parentUsed),
        name: parent.name,
        active: true,
        children: [],
      };
      list.push(current);
      bySlug.set(current.slug, current);
    }
    const childUsed = new Set(current.children.map((child) => child.slug));
    for (const child of parent.children || []) {
      if (childUsed.has(child.slug)) continue;
      if (current.children.length >= MAX_CHILDREN) break;
      const slug = uniqueSlug(child.name || child.slug, childUsed);
      current.children.push({
        slug,
        name: child.name,
        active: true,
      });
    }
  }
  return normalizeTree(list);
}

function renameProcessorLeaves(tree) {
  return (tree || []).map((parent) => {
    const seen = new Set();
    const children = [];
    for (const child of parent.children || []) {
      const next =
        child.slug === "islemci"
          ? { slug: "islemciler", name: "İşlemciler", active: child.active !== false }
          : {
              slug: child.slug,
              name: child.name,
              active: child.active !== false,
            };
      if (seen.has(next.slug)) continue;
      seen.add(next.slug);
      children.push(next);
    }
    return {
      slug: parent.slug,
      name: parent.name,
      active: parent.active !== false,
      children,
    };
  });
}

function suggestSiteCategory(product, categories) {
  const names = supplierCategoryNames(product);
  const parentName = names.main;
  const childName = browseChildName(names);
  if (!parentName) return null;
  const parentSlug = slugifyCategory(parentName);
  const childSlug = slugifyCategory(childName);
  const parent =
    (categories || []).find((row) => row.slug === parentSlug) ||
    (categories || []).find(
      (row) => slugifyCategory(row.name) === parentSlug || row.name === parentName
    );
  if (!parent) return null;
  const child =
    (parent.children || []).find((row) => row.slug === childSlug) ||
    (parent.children || []).find(
      (row) => slugifyCategory(row.name) === childSlug || row.name === childName
    );
  if (!child) return null;
  return { siteParent: parent.slug, siteChild: child.slug };
}

async function publishSupplierSlot(options) {
  const settings = options || {};
  const manager = settings.manager;
  const categoryStore = settings.categoryStore;
  const slotId = String(settings.slotId || "supplier-1");
  if (!manager || !categoryStore) throw new Error("Yayın için katalog yöneticisi gerekli.");
  await ensureRates(settings.root || process.cwd(), {
    fetchImpl: settings.fetchImpl,
    allowStale: settings.allowStale !== false,
  });
  const all = manager.listProducts().filter((item) => item.supplierSlot === slotId);
  if (!all.length) throw new Error("Bu XML kaynağında yayınlanacak ürün yok.");
  const incoming = buildTreeFromSupplierProducts(all);
  const merged = dropRetiredParents(
    renameProcessorLeaves(mergeCategoryTrees(categoryStore.list(), incoming))
  );
  categoryStore.save(merged);
  const categories = categoryStore.list();
  const updates = [];
  let skipped = 0;
  for (const item of all) {
    const pair = suggestSiteCategory(item, categories);
    if (!pair) {
      skipped += 1;
      continue;
    }
    updates.push({
      supplierSlot: slotId,
      supplierSku: item.supplierSku,
      siteParent: pair.siteParent,
      siteChild: pair.siteChild,
      active: true,
    });
  }
  if (!updates.length) {
    throw new Error("XML kategorileri site ağacına eşlenemedi.");
  }
  manager.updateProducts(updates);
  return {
    ok: true,
    slotId,
    assigned: updates.length,
    skipped,
    categoryParents: categories.length,
  };
}

module.exports = {
  cleanCategoryName,
  buildTreeFromSupplierProducts,
  mergeCategoryTrees,
  suggestSiteCategory,
  browseChildName,
  renameProcessorLeaves,
  publishSupplierSlot,
};
