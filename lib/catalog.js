const { normalizeVatPercent } = require("./product-fields");
const { loadCategories, hasSiteCategory, resolveCategoryQuerySlug } = require("./categories");
const { isSupplierOfferLive } = require("./stock-visibility");
const { REQUIRED_PARENT_SLUGS } = require("./site-category-schema");

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
  return manual.concat(supplier);
}

/** Public storefront/API: hide supplier/XML internals and cost. */
function toPublicProduct(product) {
  const images = Array.isArray(product.images)
    ? product.images.filter(Boolean).slice(0, 10)
    : product.image
      ? [product.image]
      : [];
  return {
    id: product.id,
    brand: product.brand,
    name: product.name,
    price: product.price,
    vatPercent: normalizeVatPercent(product.vatPercent),
    category: product.category,
    mid: product.siteMid || product.mid || "",
    alt: product.siteChild || product.alt || "",
    description: product.description || "",
    details: product.details || "",
    image: String(images[0] || product.image || "").replace(/^http:\/\//i, "https://"),
    images: images.map((src) => String(src).replace(/^http:\/\//i, "https://")),
    featured: Boolean(product.featured),
    active: product.active !== false,
  };
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

function queryPublicCatalog(products, params) {
  const query = params || {};
  let list = (products || []).map(toPublicProduct);
  const id = String(query.id || "").trim();
  if (id) {
    const one = list.find((item) => item.id === id) || null;
    return {
      products: one ? [one] : [],
      total: one ? 1 : 0,
      page: 1,
      limit: 1,
      totalPages: one ? 1 : 0,
    };
  }
  const ids = String(query.ids || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (ids.length) {
    const want = new Set(ids);
    const found = list.filter((item) => want.has(item.id));
    return {
      products: found,
      total: found.length,
      page: 1,
      limit: found.length || ids.length,
      totalPages: 1,
    };
  }
  const featured = query.featured === "1" || query.featured === "true";
  if (featured) list = list.filter((item) => item.featured);
  const parent = resolveCategoryQuerySlug(query.kategori);
  const mid = String(query.ara || "").trim();
  const child = String(query.alt || "").trim();
  if (parent) list = list.filter((item) => String(item.category || "") === parent);
  if (mid) list = list.filter((item) => String(item.mid || "") === mid);
  if (child) {
    list = list.filter((item) => {
      if (String(item.alt || "") === child) return true;
      if (!mid && String(item.mid || "") === child) return true;
      return false;
    });
  }
  list = sortPublicProducts(list, query);
  const limit = Math.min(48, Math.max(1, Number(query.limit) || 48));
  const page = Math.max(1, Number(query.page) || 1);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    products: list.slice(start, start + limit),
    total,
    page: safePage,
    limit,
    totalPages: total ? totalPages : 0,
  };
}

function diversityKey(product) {
  const alt = String((product && product.alt) || "").trim();
  if (alt) return "alt:" + alt;
  const mid = String((product && product.mid) || "").trim();
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

function homeFeaturedCatalog(products, query) {
  const per = Math.min(
    FEATURED_PER_CATEGORY,
    Math.max(1, Number(query && query.limit) || FEATURED_PER_CATEGORY)
  );
  const popularity = (query && query.popularity && typeof query.popularity === "object"
    ? query.popularity
    : {}) || {};
  const list = (products || [])
    .map(toPublicProduct)
    .filter((item) => item && item.active !== false);
  const byParent = {};
  REQUIRED_PARENT_SLUGS.forEach((slug) => {
    const filtered = list.filter((item) => String(item.category || "") === slug);
    byParent[slug] = pickDiverseFeatured(filtered, per, popularity);
  });
  return {
    byParent,
    products: mixFeaturedProducts(byParent, per),
    perCategory: per,
    parents: REQUIRED_PARENT_SLUGS.slice(),
  };
}

module.exports = {
  mergeCatalogProducts,
  toPublicProduct,
  queryPublicCatalog,
  homeFeaturedCatalog,
  mixFeaturedProducts,
  pickDiverseFeatured,
  FEATURED_PER_CATEGORY,
};
