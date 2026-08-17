"use strict";

const {
  slugifyCategory,
  normalizeTree,
  MAX_PARENTS,
  MAX_CHILDREN,
  readXmlNames,
  assignedSiteCategory,
} = require("./categories");
const { canonicalCategoryTree, hasCanonicalParents } = require("./site-category-schema");
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
    if (subSlug === midSlug || subSlug.endsWith("-" + midSlug)) {
      return mid;
    }
    return sub;
  }
  return sub || mid || "Genel";
}

function addXmlAlias(node, alias) {
  const names = [];
  const seen = new Set();
  function add(value) {
    const name = String(value || "")
      .trim()
      .slice(0, 80);
    if (!name) return;
    const key = name.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  }
  readXmlNames(node).forEach(add);
  add(alias);
  if (names.length) node.xmlNames = names.slice(0, 12);
  return node;
}

function categoryMatchesXml(node, xmlName) {
  const wanted = String(xmlName || "").trim();
  if (!node || !wanted) return false;
  const xmlSlug = slugifyCategory(wanted);
  if (node.slug === xmlSlug) return true;
  if (node.name === wanted) return true;
  return readXmlNames(node).some(
    (name) => name === wanted || slugifyCategory(name) === xmlSlug
  );
}

function findCategoryForXml(nodes, xmlName) {
  const list = nodes || [];
  const wanted = String(xmlName || "").trim();
  if (!wanted) return null;
  const xmlSlug = slugifyCategory(wanted);
  return (
    list.find((row) => row.slug === xmlSlug) ||
    list.find((row) => categoryMatchesXml(row, wanted)) ||
    null
  );
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
      return addXmlAlias(
        {
          name: parent.name,
          slug: uniqueSlug(parent.name, parentUsed),
          active: true,
          children: Array.from(parent.children.values()).map((child) =>
            addXmlAlias(
              {
                name: child.name,
                slug: uniqueSlug(child.name, childUsed),
                active: true,
              },
              child.name
            )
          ),
        },
        parent.name
      );
    })
    .filter((parent) => parent.children.length > 0);
}

function mergeCategoryTrees(existing, incoming) {
  const list = (existing || []).map((parent) =>
    addXmlAlias(
      {
        slug: parent.slug,
        name: parent.name,
        active: parent.active !== false,
        xmlNames: parent.xmlNames,
        children: (parent.children || []).map((child) =>
          addXmlAlias(
            {
              slug: child.slug,
              name: child.name,
              active: child.active !== false,
              xmlNames: child.xmlNames,
            },
            null
          )
        ),
      },
      null
    )
  );
  const parentUsed = new Set(list.map((parent) => parent.slug));
  for (const parent of incoming || []) {
    let current = findCategoryForXml(list, parent.name) || list.find((row) => row.slug === parent.slug);
    if (!current) {
      if (list.length >= MAX_PARENTS) continue;
      current = addXmlAlias(
        {
          slug: uniqueSlug(parent.name || parent.slug, parentUsed),
          name: parent.name,
          active: true,
          children: [],
        },
        parent.name
      );
      list.push(current);
    } else {
      addXmlAlias(current, parent.name);
    }
    const childUsed = new Set(current.children.map((child) => child.slug));
    for (const child of parent.children || []) {
      let existingChild =
        findCategoryForXml(current.children, child.name) ||
        current.children.find((row) => row.slug === child.slug);
      if (existingChild) {
        addXmlAlias(existingChild, child.name);
        continue;
      }
      if (current.children.length >= MAX_CHILDREN) break;
      const slug = uniqueSlug(child.name || child.slug, childUsed);
      current.children.push(addXmlAlias({ slug, name: child.name, active: true }, child.name));
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
          ? addXmlAlias(
              {
                slug: "islemciler",
                name: "İşlemciler",
                active: child.active !== false,
                xmlNames: child.xmlNames,
              },
              child.name
            )
          : addXmlAlias(
              {
                slug: child.slug,
                name: child.name,
                active: child.active !== false,
                xmlNames: child.xmlNames,
              },
              null
            );
      if (seen.has(next.slug)) continue;
      seen.add(next.slug);
      children.push(next);
    }
    return addXmlAlias(
      {
        slug: parent.slug,
        name: parent.name,
        active: parent.active !== false,
        xmlNames: parent.xmlNames,
        children,
      },
      null
    );
  });
}

function walkCategoryLeaves(categories) {
  const out = [];
  for (const ana of categories || []) {
    for (const ara of ana.children || []) {
      const leaves = ara.children || [];
      if (!leaves.length) {
        out.push({ ana, ara: null, alt: ara });
        continue;
      }
      for (const alt of leaves) {
        out.push({ ana, ara, alt });
      }
    }
  }
  return out;
}

function tokenList(value) {
  return slugifyCategory(value)
    .split("-")
    .filter((part) => part.length >= 3);
}

function textBlob(names, product) {
  return slugifyCategory(
    [
      names && names.sub,
      names && names.mid,
      names && names.main,
      product && product.name,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function notebookIntent(blob) {
  return /notebook|laptop|dizustu/.test(String(blob || ""));
}

function leafLooksNotebook(leaf) {
  const blob = slugifyCategory(
    String((leaf && leaf.alt && (leaf.alt.slug + " " + leaf.alt.name)) || "")
  );
  return /notebook|laptop|dizustu/.test(blob);
}

function tokenOverlapScore(leaf, names, product) {
  const hay = new Set(
    tokenList((leaf.alt && leaf.alt.name) || "").concat(tokenList((leaf.alt && leaf.alt.slug) || ""))
  );
  const needles = tokenList(names.sub || "").concat(tokenList(names.mid || ""));
  let score = 0;
  needles.forEach((token) => {
    if (hay.has(token)) score += token === "ddr5" || token === "ddr4" || token === "ddr3" ? 4 : 1;
  });
  const blob = textBlob(names, product);
  const leafNote = leafLooksNotebook(leaf);
  const wantNote = notebookIntent(blob);
  if (leafNote && wantNote) score += 5;
  if (!leafNote && blob && /ddr[345]/.test(blob) && !wantNote) score += 2;
  return score;
}

function pickBestLeaf(scored, names, product) {
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((row) => row.score === scored[0].score).map((row) => row.leaf);
  if (top.length === 1) return top[0];
  const blob = textBlob(names, product);
  const wantNote = notebookIntent(blob);
  const notebookLeaves = top.filter(leafLooksNotebook);
  const desktopLeaves = top.filter((leaf) => !leafLooksNotebook(leaf));
  if (wantNote && notebookLeaves.length === 1) return notebookLeaves[0];
  if (!wantNote && desktopLeaves.length === 1) return desktopLeaves[0];
  return null;
}

function suggestSiteCategory(product, categories, precomputedLeaves) {
  const names = supplierCategoryNames(product);
  const leaves = Array.isArray(precomputedLeaves) ? precomputedLeaves : walkCategoryLeaves(categories);
  const scored = [];
  for (const leaf of leaves) {
    let score = 0;
    if (categoryMatchesXml(leaf.alt, names.sub)) score += 20;
    if (categoryMatchesXml(leaf.alt, names.mid)) score += 8;
    if (leaf.ara && categoryMatchesXml(leaf.ara, names.mid)) score += 12;
    if (leaf.ara && categoryMatchesXml(leaf.ara, names.sub)) score += 4;
    if (categoryMatchesXml(leaf.ana, names.main)) score += 5;
    score += tokenOverlapScore(leaf, names, product);
    if (score < 10) continue;
    scored.push({ score, leaf });
  }
  const best = pickBestLeaf(scored, names, product);
  if (!best) return null;
  if (best.ara) {
    return {
      siteParent: best.ana.slug,
      siteMid: best.ara.slug,
      siteChild: best.alt.slug,
    };
  }
  return { siteParent: best.ana.slug, siteMid: "", siteChild: best.alt.slug };
}

function mergeCanonicalStructure(current, canonical) {
  const clone = JSON.parse(JSON.stringify(current || []));
  const canonNorm = normalizeTree(canonical || []);
  const bySlug = (list) => {
    const map = new Map();
    (list || []).forEach((node) => {
      if (node && node.slug) map.set(node.slug, node);
    });
    return map;
  };
  function mergeNode(live, canon) {
    if (!live || !canon) return live;
    (canon.xmlNames || []).forEach((name) => addXmlAlias(live, name));
    addXmlAlias(live, canon.name);
    if (!Array.isArray(live.children)) live.children = [];
    const liveMap = bySlug(live.children);
    (canon.children || []).forEach((childCanon) => {
      const existing = liveMap.get(childCanon.slug);
      if (existing) {
        mergeNode(existing, childCanon);
        return;
      }
      live.children.push(JSON.parse(JSON.stringify(childCanon)));
    });
    return live;
  }
  const liveMap = bySlug(clone);
  canonNorm.forEach((parentCanon) => {
    const existing = liveMap.get(parentCanon.slug);
    if (existing) mergeNode(existing, parentCanon);
  });
  return clone;
}

function ensureCanonicalSiteTree(categoryStore) {
  const current = categoryStore.list();
  if (!hasCanonicalParents(current)) {
    return categoryStore.save(canonicalCategoryTree());
  }
  const merged = mergeCanonicalStructure(current, canonicalCategoryTree());
  try {
    if (JSON.stringify(current) === JSON.stringify(merged)) return current;
  } catch (_) {}
  return categoryStore.save(merged);
}

function emptyXmlSyncResult(slotId, categories) {
  return {
    ok: true,
    slotId,
    assigned: 0,
    skipped: 0,
    categoryParents: (categories || []).length,
    empty: true,
  };
}

function xmlCategoryPatch(item, pair, slotId, activate) {
  const same =
    String(item.siteParent || "") === pair.siteParent &&
    String(item.siteMid || "") === String(pair.siteMid || "") &&
    String(item.siteChild || "") === String(pair.siteChild || "");
  if (same) return null;
  const patch = {
    supplierSlot: slotId,
    supplierSku: item.supplierSku,
    siteParent: pair.siteParent,
    siteMid: pair.siteMid || "",
    siteChild: pair.siteChild,
  };
  if (activate) patch.active = true;
  return patch;
}

function syncXmlSiteCategories(options) {
  const settings = options || {};
  const manager = settings.manager;
  const categoryStore = settings.categoryStore;
  const slotId = String(settings.slotId || "supplier-1");
  const activate = settings.activate === true;
  if (!manager || !categoryStore) throw new Error("XML kategori senkronu için katalog yöneticisi gerekli.");
  const categories = ensureCanonicalSiteTree(categoryStore);
  const all = manager.listProducts().filter((item) => item.supplierSlot === slotId);
  if (!all.length) return emptyXmlSyncResult(slotId, categories);
  const leaves = walkCategoryLeaves(categories);
  const updates = [];
  let skipped = 0;
  for (const item of all) {
    const pair = suggestSiteCategory(item, categories, leaves);
    if (!pair) {
      skipped += 1;
      continue;
    }
    const patch = xmlCategoryPatch(item, pair, slotId, activate);
    if (patch) updates.push(patch);
  }
  if (updates.length) manager.updateProducts(updates);
  return {
    ok: true,
    slotId,
    assigned: updates.length,
    skipped,
    categoryParents: categories.length,
    empty: false,
  };
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function syncXmlSiteCategoriesAsync(options) {
  const settings = options || {};
  const manager = settings.manager;
  const categoryStore = settings.categoryStore;
  const slotId = String(settings.slotId || "supplier-1");
  const activate = settings.activate === true;
  const yieldEvery = Math.max(8, Number(settings.yieldEvery) || 24);
  if (!manager || !categoryStore) throw new Error("XML kategori senkronu için katalog yöneticisi gerekli.");
  const categories = ensureCanonicalSiteTree(categoryStore);
  const all = manager.listProducts().filter((item) => item.supplierSlot === slotId);
  if (!all.length) return emptyXmlSyncResult(slotId, categories);
  const leaves = walkCategoryLeaves(categories);
  const updates = [];
  let skipped = 0;
  for (let i = 0; i < all.length; i += 1) {
    if (i > 0 && i % yieldEvery === 0) await yieldEventLoop();
    const item = all[i];
    const pair = suggestSiteCategory(item, categories, leaves);
    if (!pair) {
      skipped += 1;
      continue;
    }
    const patch = xmlCategoryPatch(item, pair, slotId, activate);
    if (patch) updates.push(patch);
  }
  if (updates.length) manager.updateProducts(updates);
  return {
    ok: true,
    slotId,
    assigned: updates.length,
    skipped,
    categoryParents: categories.length,
    empty: false,
  };
}

async function publishSupplierSlot(options) {
  const settings = options || {};
  if (!settings.manager || !settings.categoryStore) {
    throw new Error("Yayın için katalog yöneticisi gerekli.");
  }
  await ensureRates(settings.root || process.cwd(), {
    fetchImpl: settings.fetchImpl,
    allowStale: settings.allowStale !== false,
  });
  const result = syncXmlSiteCategories(Object.assign({}, settings, { activate: false }));
  if (result.empty) throw new Error("Bu XML kaynağında yayınlanacak ürün yok.");
  return result;
}

module.exports = {
  cleanCategoryName,
  buildTreeFromSupplierProducts,
  mergeCategoryTrees,
  suggestSiteCategory,
  browseChildName,
  renameProcessorLeaves,
  categoryMatchesXml,
  findCategoryForXml,
  publishSupplierSlot,
  syncXmlSiteCategories,
  syncXmlSiteCategoriesAsync,
  ensureCanonicalSiteTree,
  walkCategoryLeaves,
};
