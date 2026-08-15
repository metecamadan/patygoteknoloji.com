"use strict";

const {
  slugifyCategory,
  normalizeTree,
  MAX_PARENTS,
  MAX_CHILDREN,
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

const PREFERRED_PARENTS = ["bilgisayar-tablet", "cevre-birimleri"];

const SITE_CHILD_ALIASES = {
  islemci: ["islemci", "islemciler"],
  notebook: ["notebook", "notebooklar", "laptop", "tasinabilir-bilgisayarlar"],
  masaustu: ["masaustu", "masaustu-bilgisayarlar"],
  tablet: ["tablet"],
  klavye: ["klavye"],
  mouse: ["mouse"],
  "klavye-mouse-set": ["klavye-mouse-set", "klavye-mouse"],
  monitor: ["monitor", "monitorler", "led-monitorler"],
  ram: ["ram", "bellek", "bellekler"],
  "ekran-karti": ["ekran-karti", "ekran-kartlari"],
  kasa: ["kasa", "kasalar"],
  modem: ["modem"],
  router: ["router"],
  "usb-bellek": ["usb-bellek", "usb-bellekler", "usb-flash"],
  "laser-yazici": ["laser-yazici", "laser-yazicilar"],
  "inkjet-yazici": ["inkjet-yazici", "inkjet-yazicilar"],
  tarayici: ["tarayici", "tarayicilar"],
  "notebook-canta": ["notebook-canta", "notebook-cantalari"],
};

function stripPluralSlug(slug) {
  return String(slug || "").replace(/(ler|lar|leri|lari)$/g, "");
}

function supplierCategoryNames(product) {
  return {
    main: cleanCategoryName(product && (product.xmlMainCategory || product.mainCategory)),
    mid: cleanCategoryName(product && (product.xmlMidCategory || product.midCategory)),
    sub: cleanCategoryName(product && (product.xmlSubCategory || product.subCategory)),
  };
}

function matchPreferredSiteCategory(product, categories) {
  const names = supplierCategoryNames(product);
  const texts = [names.sub, names.mid, names.main].filter(Boolean);
  const slugs = texts.map((text) => slugifyCategory(text));
  const stripped = slugs.map(stripPluralSlug);
  let best = null;
  for (const parent of categories || []) {
    const preferred = PREFERRED_PARENTS.includes(parent.slug) ? 25 : 0;
    for (const child of parent.children || []) {
      const aliases = SITE_CHILD_ALIASES[child.slug] || [child.slug, stripPluralSlug(child.slug)];
      let score = 0;
      for (const alias of aliases) {
        if (!alias) continue;
        if (slugs.includes(alias) || stripped.includes(alias) || stripped.includes(stripPluralSlug(alias))) {
          score = Math.max(score, 100);
        } else if (slugs.some((slug) => slug === alias || slug.endsWith("-" + alias) || slug.includes(alias))) {
          score = Math.max(score, 85);
        }
      }
      if (!score) continue;
      score += preferred;
      if (!best || score > best.score) {
        best = { siteParent: parent.slug, siteChild: child.slug, score };
      }
    }
  }
  return best && best.score >= 85 ? { siteParent: best.siteParent, siteChild: best.siteChild } : null;
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
    const childName = names.mid || names.sub || "Genel";
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

function suggestSiteCategory(product, categories) {
  const preferred = matchPreferredSiteCategory(product, categories);
  if (preferred) return preferred;
  const names = supplierCategoryNames(product);
  const parentName = names.main;
  const childName = names.mid || names.sub || "Genel";
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
  const merged = mergeCategoryTrees(categoryStore.list(), incoming);
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
  matchPreferredSiteCategory,
  publishSupplierSlot,
};
