const { normalizeVatPercent } = require("./product-fields");
const { loadCategories, hasSiteCategory, resolveCategoryQuerySlug } = require("./categories");
const { isSupplierOfferLive } = require("./stock-visibility");
const { REQUIRED_PARENT_SLUGS } = require("./site-category-schema");
const { formatAkakceBrand, formatAkakceProductName } = require("./akakce");
const {
  buildProductRouteIndex,
  attachProductUrlFields,
  productPagePath,
} = require("./product-url");
const { enrichProductCopy } = require("./product-description");
const { filterSupplierGalleryImages, collectRawProductImages, resolveStorefrontProductImages, productHasStorefrontImage, mirrorIndexHasEntries } = require("./product-images");

function withPublicProductUrls(products, routeIndex) {
  if (!Array.isArray(products) || !routeIndex) return products || [];
  return products.map((item) => attachProductUrlFields(item, routeIndex));
}

function enrichCatalogSnapshotProducts(snapshot, routeIndex) {
  if (!snapshot || !Array.isArray(snapshot.products) || !routeIndex) return snapshot;
  if (snapshot.products.length && snapshot.products.every((item) => item && item.urlPath)) {
    return snapshot;
  }
  return Object.assign({}, snapshot, {
    products: withPublicProductUrls(snapshot.products, routeIndex),
  });
}

const FEATURED_PER_CATEGORY = 12;

function mergeCatalogProducts(manualProducts, supplierProducts, options) {
  const settings = options || {};
  const normalize = settings.normalizeProduct || ((product) => Object.assign({}, product));
  const defaults = settings.categoryDefaults || {};
  const categories = settings.categories || loadCategories();
  const manual = (manualProducts || [])
    .map((item) => Object.assign({}, normalize(item), { source: "manual" }))
    .filter((item) => settings.includeInactiveManual || item.active !== false);
  const manualIds = new Set(manual.map((item) => item.id));
  const supplier = (supplierProducts || [])
    .filter((item) => item && item.active === true && hasSiteCategory(item, categories))
    .filter((item) => Number(item.salePrice) > 0 && String(item.currency || "TRY").toUpperCase() === "TRY")
    .filter((item) => isSupplierOfferLive(item, settings.now))
    .map((item) => {
      const tree = defaults[item.category] || defaults.bilgisayar || {};
      const assignedParent = String(item.siteParent || "").trim();
      const assignedMid = String(item.siteMid || "").trim();
      const assignedChild = String(item.siteChild || "").trim();
      const normalized = normalize({
        id: item.id,
        brand: item.brand,
        name: item.name,
        price: item.salePrice,
        category: assignedParent || item.category,
        description: item.description,
        details: item.details || item.description,
        image: String((Array.isArray(item.images) && item.images[0]) || item.image || "").replace(
          /^http:\/\//i,
          "https://"
        ),
        images: (Array.isArray(item.images) && item.images.length
          ? item.images
          : item.image
            ? [item.image]
            : []
        )
          .map((url) => String(url || "").replace(/^http:\/\//i, "https://"))
          .filter(Boolean)
          .slice(0, 10),
        featured: false,
        active: true,
        manufacturerCode: item.manufacturerCode || item.supplierSku,
        barcode: item.barcode || "",
        gtipCode: item.gtipCode || "",
        specialCode: item.specialCode || "",
        mainCategory: item.mainCategory || tree.mainCategory || "",
        midCategory: item.midCategory || tree.midCategory || "",
        subCategory: item.subCategory || tree.subCategory || "",
        stockQty: item.stockQty,
        vatPercent: item.vatPercent,
        currency: item.currency,
        unit: item.unit,
        siteMid: assignedMid,
        siteChild: assignedChild,
        urlSlug: item.urlSlug || "",
        urlCategorySegment: item.urlCategorySegment || "",
      });
      return Object.assign({}, normalized, {
        source: "supplier",
        supplierSku: item.supplierSku,
        barcode: item.barcode || normalized.barcode || "",
        stockQty: item.stockQty,
        costPrice: item.costPrice,
        criticalStockQty: item.criticalStockQty,
        catalogStale: item.catalogStale === true,
        lastSuccessfulFetchAt: item.lastSuccessfulFetchAt || null,
        siteParent: assignedParent,
        siteMid: assignedMid,
        siteChild: assignedChild,
      });
    })
    .filter((item) => !manualIds.has(item.id));
  const imageOpts = {
    mirrorIndex: settings.mirrorIndex,
    siteBaseUrl: settings.siteBaseUrl,
    dataRoot: settings.dataRoot,
  };
  return manual.concat(supplier).filter((item) => productHasStorefrontImage(item, imageOpts));
}

const LIST_DESCRIPTION_MAX = 160;

function compactText(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

function publicImages(product, limit, options) {
  const cap = Math.max(1, Number(limit) || 10);
  const opts = options || {};
  if (mirrorIndexHasEntries(opts.mirrorIndex) && opts.siteBaseUrl) {
    return resolveStorefrontProductImages(product, {
      limit: cap,
      mirrorIndex: opts.mirrorIndex,
      siteBaseUrl: opts.siteBaseUrl,
    });
  }
  return collectRawProductImages(product, cap);
}

function catalogImageOptions(options) {
  const opts = options || {};
  if (!mirrorIndexHasEntries(opts.mirrorIndex) || !opts.siteBaseUrl) return null;
  return {
    mirrorIndex: opts.mirrorIndex,
    siteBaseUrl: opts.siteBaseUrl,
    dataRoot: opts.dataRoot,
  };
}

/** Public storefront/API: hide supplier/XML internals and cost. */
function toPublicProduct(product, options) {
  const compact = Boolean(options && options.compact);
  const enriched = enrichProductCopy(product || {});
  const imageOpts = catalogImageOptions(options);
  const images = publicImages(enriched, compact ? 2 : 10, imageOpts || undefined);
  const out = {
    id: enriched.id,
    brand: formatAkakceBrand(enriched.brand),
    name: formatAkakceProductName(enriched),
    price: enriched.price,
    vatPercent: normalizeVatPercent(enriched.vatPercent),
    category: enriched.category,
    mid: enriched.siteMid || enriched.mid || "",
    alt: enriched.siteChild || enriched.alt || "",
    image: String(images[0] || enriched.image || "").replace(/^http:\/\//i, "https://"),
    images,
    featured: Boolean(enriched.featured),
    active: enriched.active !== false,
  };
  if (compact) {
    out.description = compactText(enriched.description || enriched.details, LIST_DESCRIPTION_MAX);
    return out;
  }
  out.description = enriched.description || "";
  out.details = enriched.details || "";
  return out;
}

const POPULAR_BRANDS = new Set([
  "apple",
  "lenovo",
  "hp",
  "dell",
  "asus",
  "samsung",
  "logitech",
  "intel",
  "amd",
  "kingston",
  "corsair",
  "msi",
  "acer",
  "xiaomi",
  "brother",
  "canon",
  "epson",
  "xerox",
]);

function popularityFallbackScore(product) {
  let score = 0;
  if (product && product.featured) score += 40;
  const images = Array.isArray(product && product.images)
    ? product.images.filter(Boolean).length
    : product && product.image
      ? 1
      : 0;
  score += Math.min(images, 5) * 2;
  const brand = String((product && product.brand) || "").trim().toLowerCase();
  if (POPULAR_BRANDS.has(brand)) score += 16;
  if ((Number(product && product.price) || 0) >= 100) score += 4;
  return score;
}

function sortPublicProducts(list, query) {
  const sort = String((query && query.sort) || "").toLowerCase();
  if (sort !== "popular") return list;
  const scores = query && query.popularity && typeof query.popularity === "object" ? query.popularity : {};
  return (Array.isArray(list) ? list : []).slice().sort((left, right) => {
    const leftScore = Number(scores[left && left.id]) || 0;
    const rightScore = Number(scores[right && right.id]) || 0;
    if (rightScore !== leftScore) return rightScore - leftScore;
    const leftFallback = popularityFallbackScore(left);
    const rightFallback = popularityFallbackScore(right);
    if (rightFallback !== leftFallback) return rightFallback - leftFallback;
    return String((left && left.name) || "").localeCompare(String((right && right.name) || ""), "tr");
  });
}

function siteParentOf(item) {
  return String((item && (item.category || item.siteParent)) || "");
}

function siteMidOf(item) {
  return String((item && (item.siteMid || item.mid)) || "");
}

function siteChildOf(item) {
  return String((item && (item.siteChild || item.alt)) || "");
}

const PRICE_PRESETS = [
  { min: 0, max: 1000, label: "1.000 ₺ altı" },
  { min: 1000, max: 5000, label: "1.000 – 5.000 ₺" },
  { min: 5000, max: 15000, label: "5.000 – 15.000 ₺" },
  { min: 15000, max: null, label: "15.000 ₺ üzeri" },
];

function priceInclVatAmount(product) {
  const net = Number(product && product.price) || 0;
  const vat = normalizeVatPercent(product && product.vatPercent);
  return Math.round(net * (1 + vat / 100) * 100) / 100;
}

function parseBrandFilter(query) {
  const raw = query && (query.marka != null ? query.marka : query.brand);
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const seen = new Set();
  const brands = [];
  parts.forEach((item) => {
    const name = String(item || "").trim();
    if (!name) return;
    const key = name.toLocaleUpperCase("tr-TR");
    if (seen.has(key)) return;
    seen.add(key);
    brands.push(name);
  });
  return brands;
}

function parsePriceBound(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function overlappingPricePresets(priceRange) {
  const lo = Number(priceRange && priceRange.min) || 0;
  const hi = Number(priceRange && priceRange.max) || 0;
  if (!hi) return [];
  return PRICE_PRESETS.filter((row) => {
    const rowMax = row.max == null ? Number.POSITIVE_INFINITY : row.max;
    return rowMax > lo && row.min < hi;
  }).map((row) => ({ min: row.min, max: row.max, label: row.label }));
}

function buildCatalogFacets(list) {
  const brands = new Map();
  let min = Infinity;
  let max = 0;
  (list || []).forEach((item) => {
    const brand = String((item && item.brand) || "").trim();
    if (brand) brands.set(brand, (brands.get(brand) || 0) + 1);
    const price = priceInclVatAmount(item);
    if (price > 0) {
      if (price < min) min = price;
      if (price > max) max = price;
    }
  });
  const price = {
    min: min === Infinity ? 0 : Math.floor(min),
    max: max > 0 ? Math.ceil(max) : 0,
  };
  return {
    brands: Array.from(brands.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "tr"))
      .slice(0, 40),
    price,
    pricePresets: overlappingPricePresets(price),
  };
}

function applyFacetFilters(list, query) {
  const brands = parseBrandFilter(query);
  const brandKeys = new Set(brands.map((name) => name.toLocaleUpperCase("tr-TR")));
  const minFiyat = parsePriceBound(query && query.minFiyat);
  const maxFiyat = parsePriceBound(query && query.maxFiyat);
  return (list || []).filter((item) => {
    if (brandKeys.size) {
      const key = String((item && item.brand) || "").trim().toLocaleUpperCase("tr-TR");
      if (!brandKeys.has(key)) return false;
    }
    if (minFiyat || maxFiyat) {
      const price = priceInclVatAmount(item);
      if (minFiyat && price < minFiyat) return false;
      if (maxFiyat && price > maxFiyat) return false;
    }
    return true;
  });
}

function finishCatalogQuery(list, query, options) {
  const opts = options || {};
  const page = Math.max(1, Number(query.page) || 1);
  const facets = opts.omitFacets ? null : buildCatalogFacets(list);
  let filtered = applyFacetFilters(list, query);
  filtered = sortPublicProducts(filtered, query);
  const limit = Math.min(48, Math.max(1, Number(query.limit) || 48));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const slice = filtered.slice(start, start + limit);
  const pubOpts = {
    compact: true,
    mirrorIndex: opts.mirrorIndex,
    siteBaseUrl: opts.siteBaseUrl,
    dataRoot: opts.dataRoot,
  };
  let products = opts.alreadyCompact
    ? slice
    : slice.map((item) => toPublicProduct(item, pubOpts));
  if (opts.routeIndex) {
    products = withPublicProductUrls(products, opts.routeIndex);
  }
  return {
    products,
    total,
    page: safePage,
    limit,
    totalPages: total ? totalPages : 0,
    facets,
  };
}

function applyTextSearch(list, q) {
  const raw = String(q || "").trim().toLocaleLowerCase("tr-TR");
  if (!raw) return list;
  const terms = raw.split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return list;
  return list.filter((item) => {
    const haystack = (
      String((item && item.brand) || "") +
      " " +
      String((item && item.name) || "")
    ).toLocaleLowerCase("tr-TR");
    return terms.every((term) => haystack.includes(term));
  });
}

function filterCatalogByQuery(list, query) {
  const id = String(query.id || "").trim();
  if (id) {
    const one = list.find((item) => item && item.id === id) || null;
    return { mode: "single", item: one };
  }
  const ids = String(query.ids || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (ids.length) {
    const want = new Set(ids);
    return { mode: "multi", list: list.filter((item) => item && want.has(item.id)) };
  }
  let filtered = list.slice();
  filtered = applyTextSearch(filtered, query.q);
  const featured = query.featured === "1" || query.featured === "true";
  if (featured) filtered = filtered.filter((item) => Boolean(item && item.featured));
  const parent = resolveCategoryQuerySlug(query.kategori);
  const mid = String(query.ara || "").trim();
  const child = String(query.alt || "").trim();
  if (parent) filtered = filtered.filter((item) => siteParentOf(item) === parent);
  if (mid) filtered = filtered.filter((item) => siteMidOf(item) === mid);
  if (child) {
    filtered = filtered.filter((item) => {
      if (siteChildOf(item) === child) return true;
      if (!mid && siteMidOf(item) === child) return true;
      return false;
    });
  }
  return { mode: "browse", list: filtered };
}

function buildStorefrontIndex(products, options) {
  const opts = options || {};
  const imageOpts = catalogImageOptions(opts);
  const visible = (products || []).filter((item) =>
    productHasStorefrontImage(item, imageOpts || {})
  );
  const routeIndex = buildProductRouteIndex(visible);
  const pubOpts = {
    compact: true,
    mirrorIndex: opts.mirrorIndex,
    siteBaseUrl: opts.siteBaseUrl,
    dataRoot: opts.dataRoot,
  };
  const compactAll = visible.map((item) =>
    attachProductUrlFields(toPublicProduct(item, pubOpts), routeIndex)
  );
  const byParent = Object.create(null);
  compactAll.forEach((compact) => {
    const parent = siteParentOf(compact);
    if (!byParent[parent]) byParent[parent] = [];
    byParent[parent].push(compact);
  });
  return { compactAll, byParent, routeIndex };
}

function queryPublicCatalogIndexed(index, params) {
  const query = params || {};
  const source = index && Array.isArray(index.compactAll) ? index.compactAll : [];
  const parent = resolveCategoryQuerySlug(query.kategori);
  let list = source;
  if (parent && index && index.byParent && index.byParent[parent]) {
    list = index.byParent[parent].slice();
    const mid = String(query.ara || "").trim();
    const child = String(query.alt || "").trim();
    if (mid) list = list.filter((item) => siteMidOf(item) === mid);
    if (child) {
      list = list.filter((item) => {
        if (siteChildOf(item) === child) return true;
        if (!mid && siteMidOf(item) === child) return true;
        return false;
      });
    }
    list = applyTextSearch(list, query.q);
    const featured = query.featured === "1" || query.featured === "true";
    if (featured) list = list.filter((item) => Boolean(item && item.featured));
  } else {
    const filtered = filterCatalogByQuery(source, query);
    if (filtered.mode === "single") {
      return {
        products: filtered.item ? [filtered.item] : [],
        total: filtered.item ? 1 : 0,
        page: 1,
        limit: 1,
        totalPages: filtered.item ? 1 : 0,
      };
    }
    if (filtered.mode === "multi") {
      const found = filtered.list || [];
      return {
        products: found,
        total: found.length,
        page: 1,
        limit: found.length || 1,
        totalPages: 1,
      };
    }
    list = filtered.list || [];
  }
  const page = Math.max(1, Number(query.page) || 1);
  return finishCatalogQuery(list, query, { alreadyCompact: true, omitFacets: page > 1 });
}

function queryPublicCatalog(products, params, options) {
  const query = params || {};
  const list = products || [];
  const routeIndex =
    (options && options.routeIndex) || buildProductRouteIndex(list);
  const pubOpts = {
    mirrorIndex: options && options.mirrorIndex,
    siteBaseUrl: options && options.siteBaseUrl,
    dataRoot: options && options.dataRoot,
  };
  const filtered = filterCatalogByQuery(list, query);
  if (filtered.mode === "single") {
    const pub =
      filtered.item && productHasStorefrontImage(filtered.item, pubOpts)
        ? attachProductUrlFields(toPublicProduct(filtered.item, pubOpts), routeIndex)
        : null;
    return {
      products: pub ? [pub] : [],
      total: pub ? 1 : 0,
      page: 1,
      limit: 1,
      totalPages: pub ? 1 : 0,
    };
  }
  if (filtered.mode === "multi") {
    const found = withPublicProductUrls(
      (filtered.list || [])
        .filter((item) => productHasStorefrontImage(item, pubOpts))
        .map((item) => toPublicProduct(item, pubOpts)),
      routeIndex
    );
    return {
      products: found,
      total: found.length,
      page: 1,
      limit: found.length || 1,
      totalPages: 1,
    };
  }
  return finishCatalogQuery(filtered.list || [], query, {
    alreadyCompact: false,
    routeIndex,
    mirrorIndex: pubOpts.mirrorIndex,
    siteBaseUrl: pubOpts.siteBaseUrl,
    dataRoot: pubOpts.dataRoot,
  });
}

function diversityKey(product) {
  const alt = siteChildOf(product);
  if (alt) return "alt:" + alt;
  const mid = siteMidOf(product);
  if (mid) return "mid:" + mid;
  return "other";
}

function pickDiverseFeatured(list, limit, popularity) {
  const cap = Math.max(1, Number(limit) || FEATURED_PER_CATEGORY);
  const sorted = sortPublicProducts(list, { sort: "popular", popularity: popularity || {} });
  const buckets = new Map();
  sorted.forEach((item) => {
    const key = diversityKey(item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });
  const queues = Array.from(buckets.values());
  const seen = new Set();
  const mixed = [];
  let added = true;
  while (added && mixed.length < cap) {
    added = false;
    queues.forEach((queue) => {
      if (mixed.length >= cap) return;
      while (queue.length) {
        const item = queue.shift();
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        mixed.push(item);
        added = true;
        break;
      }
    });
  }
  return mixed;
}

function mixFeaturedProducts(byParent, limit) {
  const cap = Math.max(1, Number(limit) || FEATURED_PER_CATEGORY);
  const queues = REQUIRED_PARENT_SLUGS.map((slug) => ((byParent && byParent[slug]) || []).slice());
  const seen = new Set();
  const mixed = [];
  let added = true;
  while (added && mixed.length < cap) {
    added = false;
    queues.forEach((queue) => {
      if (mixed.length >= cap) return;
      while (queue.length) {
        const item = queue.shift();
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        mixed.push(item);
        added = true;
        break;
      }
    });
  }
  return mixed;
}

function homeFeaturedCatalog(products, query, options) {
  const per = Math.min(
    FEATURED_PER_CATEGORY,
    Math.max(1, Number(query && query.limit) || FEATURED_PER_CATEGORY)
  );
  const popularity = (query && query.popularity && typeof query.popularity === "object"
    ? query.popularity
    : {}) || {};
  const active = (products || []).filter((item) => item && item.active !== false);
  const routeIndex =
    (options && options.routeIndex) || buildProductRouteIndex(active);
  const pubOpts = {
    compact: true,
    mirrorIndex: options && options.mirrorIndex,
    siteBaseUrl: options && options.siteBaseUrl,
    dataRoot: options && options.dataRoot,
  };
  const byParent = {};
  REQUIRED_PARENT_SLUGS.forEach((slug) => {
    const filtered = active.filter((item) => siteParentOf(item) === slug);
    byParent[slug] = withPublicProductUrls(
      pickDiverseFeatured(filtered, per, popularity).map((item) =>
        toPublicProduct(item, pubOpts)
      ),
      routeIndex
    );
  });
  return {
    byParent,
    products: mixFeaturedProducts(byParent, per),
    perCategory: per,
    parents: REQUIRED_PARENT_SLUGS.slice(),
  };
}

function listingSnapshotFileName(query) {
  const parent = resolveCategoryQuerySlug(query && query.kategori);
  const mid = String((query && query.ara) || "").trim();
  const child = String((query && query.alt) || "").trim();
  const safe = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 80);
  if (!parent && !mid && !child) return "all.json";
  if (!mid && !child) return safe(parent) + ".json";
  if (!child) return (safe(parent) || "all") + "__" + (safe(mid) || "_") + ".json";
  return (safe(parent) || "all") + "__" + (safe(mid) || "_") + "__" + safe(child) + ".json";
}

function listingKeysFromTree(categories) {
  const keys = [];
  (categories || []).forEach((ana) => {
    if (!ana || !ana.slug) return;
    keys.push({ kategori: ana.slug });
    (ana.children || []).forEach((ara) => {
      if (!ara || !ara.slug) return;
      const leaves = (ara.children || []).filter((leaf) => leaf && leaf.slug);
      if (!leaves.length) {
        keys.push({ kategori: ana.slug, ara: ara.slug });
        keys.push({ kategori: ana.slug, alt: ara.slug });
        return;
      }
      keys.push({ kategori: ana.slug, ara: ara.slug });
      leaves.forEach((alt) => {
        keys.push({ kategori: ana.slug, ara: ara.slug, alt: alt.slug });
      });
    });
  });
  return keys;
}

function buildStorefrontLeafKeys(index) {
  const { leafProductKey } = require("./categories");
  const keys = new Set();
  const list = (index && index.compactAll) || [];
  list.forEach((item) => {
    const parent = siteParentOf(item).trim();
    if (!parent) return;
    const mid = siteMidOf(item).trim();
    const child = siteChildOf(item).trim();
    if (mid && child) keys.add(leafProductKey(parent, mid, child));
    else if (mid) keys.add(leafProductKey(parent, mid, ""));
    else if (child) keys.add(leafProductKey(parent, "", child));
  });
  return keys;
}

function listingSnapshotJobs(index, categories) {
  const jobs = [{ file: "all.json", params: {} }];
  const seen = new Set(["all.json"]);
  const add = (params) => {
    const file = listingSnapshotFileName(params);
    if (seen.has(file)) return;
    seen.add(file);
    jobs.push({ file, params });
  };
  listingKeysFromTree(categories).forEach(add);
  const byParent = (index && index.byParent) || {};
  Object.keys(byParent).forEach((parent) => {
    if (!parent) return;
    add({ kategori: parent });
    (byParent[parent] || []).forEach((item) => {
      const mid = siteMidOf(item).trim();
      const child = siteChildOf(item).trim();
      if (mid) add({ kategori: parent, ara: mid });
      if (mid && child) add({ kategori: parent, ara: mid, alt: child });
      if (!mid && child) add({ kategori: parent, alt: child });
    });
  });
  return jobs;
}

module.exports = {
  mergeCatalogProducts,
  toPublicProduct,
  productHasStorefrontImage,
  resolveStorefrontProductImages,
  collectRawProductImages,
  withPublicProductUrls,
  enrichCatalogSnapshotProducts,
  applyTextSearch,
  queryPublicCatalog,
  buildStorefrontIndex,
  queryPublicCatalogIndexed,
  homeFeaturedCatalog,
  productPagePath,
  mixFeaturedProducts,
  pickDiverseFeatured,
  FEATURED_PER_CATEGORY,
  PRICE_PRESETS,
  priceInclVatAmount,
  listingSnapshotFileName,
  listingSnapshotJobs,
  listingKeysFromTree,
  buildStorefrontLeafKeys,
};
