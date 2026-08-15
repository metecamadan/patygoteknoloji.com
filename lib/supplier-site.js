"use strict";

const {
  slugifyCategory,
  normalizeTree,
  MAX_PARENTS,
  MAX_CHILDREN,
  dropRetiredParents,
  readXmlNames,
  assignedSiteCategory,
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

function suggestSiteCategory(product, categories) {
  const names = supplierCategoryNames(product);
  const parentName = names.main;
  const childName = browseChildName(names);
  if (!parentName) return null;
  const parent = findCategoryForXml(categories, parentName);
  if (!parent) return null;
  const child = findCategoryForXml(parent.children || [], childName);
  if (!child) return null;
  return { siteParent: parent.slug, siteChild: child.slug };
}

function syncXmlSiteCategories(options) {
  const settings = options || {};
  const manager = settings.manager;
  const categoryStore = settings.categoryStore;
  const slotId = String(settings.slotId || "supplier-1");
  const activate = settings.activate === true;
  if (!manager || !categoryStore) throw new Error("XML kategori senkronu için katalog yöneticisi gerekli.");
  const all = manager.listProducts().filter((item) => item.supplierSlot === slotId);
  if (!all.length) {
    return {
      ok: true,
      slotId,
      assigned: 0,
      skipped: 0,
      categoryParents: categoryStore.list().length,
      empty: true,
    };
  }
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
    if (!activate) {
      if (assignedSiteCategory(item, categories)) continue;
    }
    const patch = {
      supplierSlot: slotId,
      supplierSku: item.supplierSku,
      siteParent: pair.siteParent,
      siteChild: pair.siteChild,
    };
    if (activate) patch.active = true;
    updates.push(patch);
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
  const result = syncXmlSiteCategories(Object.assign({}, settings, { activate: true }));
  if (result.empty) throw new Error("Bu XML kaynağında yayınlanacak ürün yok.");
  if (!result.assigned) throw new Error("XML kategorileri site ağacına eşlenemedi.");
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
};
