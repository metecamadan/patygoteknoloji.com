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
const { enrichProductCopy, ensureListedProductCopy } = require("./product-description");
const { buildProductHighlights } = require("./product-highlights");
const { searchProducts } = require("./search");
const { formatBrandName } = require("./brand-name");
const { foldSearchText } = require("./tr-text");
const { parseSpecFilter, matchesSpecFilter, buildSpecFacets } = require("./spec-facets");
const { filterSupplierGalleryImages, collectRawProductImages, resolveStorefrontProductImages, productHasStorefrontImage, mirrorIndexHasEntries } = require("./product-images");
const { thumbUrlFor } = require("./product-thumbnails");

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

/**
 * Every storefront gate except the image gate. The image mirror must work from this list:
 * the merged catalog already drops rows whose images are not mirrored yet.
 */
function supplierStorefrontCandidates(supplierProducts, options) {
  const settings = options || {};
  const categories = settings.categories || loadCategories();
  return (supplierProducts || [])
    .filter(
      (item) =>
        item && item.active === true && item.unlisted !== true && hasSiteCategory(item, categories)
    )
    .filter((item) => Number(item.salePrice) > 0 && String(item.currency || "TRY").toUpperCase() === "TRY")
    .filter((item) => isSupplierOfferLive(item, settings.now));
}

function mergeCatalogProducts(manualProducts, supplierProducts, options) {
  const settings = options || {};
  const normalize = settings.normalizeProduct || ((product) => Object.assign({}, product));
  const defaults = settings.categoryDefaults || {};
  const categories = settings.categories || loadCategories();
  const manual = (manualProducts || [])
    .map((item) => Object.assign({}, normalize(item), { source: "manual" }))
    .filter((item) => settings.includeInactiveManual || item.active !== false);
  const manualIds = new Set(manual.map((item) => item.id));
  const supplier = supplierStorefrontCandidates(supplierProducts, {
    categories,
    now: settings.now,
  })
    .map(ensureListedProductCopy)
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
    placeholderMirrorFiles: settings.placeholderMirrorFiles,
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
      dataRoot: opts.dataRoot,
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
    const thumb = thumbUrlFor(out.image, options && options.dataRoot);
    if (thumb) out.thumb = thumb;
    out.description = compactText(enriched.description || enriched.details, LIST_DESCRIPTION_MAX);
    return out;
  }
  out.description = enriched.description || "";
  out.details = enriched.details || "";
  const highlights = buildProductHighlights(enriched, { brand: out.brand });
  if (highlights.length) out.highlights = highlights;
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

const MARKET_POPULAR_PATTERNS = [
  {
    pattern: /notebook|laptop|macbook|thinkpad|ideapad|vivobook|spectre|pavilion|elitebook|latitude|inspiron|surface/i,
    score: 22,
  },
  { pattern: /iphone|ipad|galaxy\s|samsung\s|redmi|realme|huawei|tablet|ipad/i, score: 18 },
  { pattern: /\b(rtx|geforce|ryzen\s[579]|core\s+i[579]|ddr5|nvme|ssd)\b/i, score: 14 },
  { pattern: /toner|kartu[sş]|cartridge|muadil/i, score: 10 },
  { pattern: /yaz[iı]c[iı]|printer|laserjet|deskjet/i, score: 10 },
  // Akakçe fiyat karşılaştırmasında sık aranan aksesuar / bileşen sinyalleri
  { pattern: /kulakl[iı]k|airpods|buds|mouse|fare|klavye|keyboard|webcam|powerbank|şarj|sarj/i, score: 12 },
  { pattern: /\b(ram|bellek|motherboard|anakart|ekran kart|monit[oö]r|router|switch)\b/i, score: 12 },
];

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
  const name = String((product && product.name) || "");
  let marketBoost = 0;
  MARKET_POPULAR_PATTERNS.forEach(({ pattern, score: boost }) => {
    if (pattern.test(name)) marketBoost = Math.max(marketBoost, boost);
  });
  score += marketBoost;
  if (siteParentOf(product) === "bilgisayar-tablet") score += 6;
  return score;
}

const PUBLIC_SORTS = new Set(["popular", "relevance", "price-asc", "price-desc", "name"]);

/** Listing default: relevance for searches (rows arrive ranked), otherwise popularity. */
function effectiveSort(query) {
  const requested = String((query && query.sort) || "").toLowerCase();
  if (PUBLIC_SORTS.has(requested)) return requested;
  return String((query && query.q) || "").trim() ? "relevance" : "popular";
}

const NAME_COLLATOR = new Intl.Collator("tr");

function compareByName(left, right) {
  return NAME_COLLATOR.compare(String((left && left.name) || ""), String((right && right.name) || ""));
}

function sortPublicProducts(list, query) {
  const sort = String((query && query.sort) || "").toLowerCase();
  if (sort === "price-asc" || sort === "price-desc") {
    const dir = sort === "price-asc" ? 1 : -1;
    return (Array.isArray(list) ? list : [])
      .slice()
      .sort((left, right) => dir * (priceInclVatAmount(left) - priceInclVatAmount(right)) || compareByName(left, right));
  }
  if (sort === "name") return (Array.isArray(list) ? list : []).slice().sort(compareByName);
  if (sort !== "popular") return list;
  const scores = query && query.popularity && typeof query.popularity === "object" ? query.popularity : {};
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      item,
      live: Number(scores[item && item.id]) || 0,
      fallback: popularityFallbackScore(item),
    }))
    .sort(
      (left, right) =>
        right.live - left.live || right.fallback - left.fallback || compareByName(left.item, right.item)
    )
    .map((row) => row.item);
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
    const key = foldSearchText(name);
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

/** Brand counts grouped like the marka filter (folded), so "DELL", "Dell" and "FRİSBY"/"Frisby" are one row. */
function buildBrandCounts(list) {
  const brands = new Map();
  (list || []).forEach((item) => {
    const brand = String((item && item.brand) || "").trim();
    if (!brand) return;
    const key = foldSearchText(brand);
    const row = brands.get(key);
    if (row) row.count += 1;
    else brands.set(key, { name: formatBrandName(brand), count: 1 });
  });
  return Array.from(brands.values()).sort(
    (left, right) => right.count - left.count || NAME_COLLATOR.compare(left.name, right.name)
  );
}

function buildCatalogFacets(list) {
  let min = Infinity;
  let max = 0;
  (list || []).forEach((item) => {
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
    brands: buildBrandCounts(list).slice(0, 40),
    price,
    pricePresets: overlappingPricePresets(price),
  };
}

function applyFacetFilters(list, query) {
  const brands = parseBrandFilter(query);
  const brandKeys = new Set(brands.map((name) => foldSearchText(name)));
  const minFiyat = parsePriceBound(query && query.minFiyat);
  const maxFiyat = parsePriceBound(query && query.maxFiyat);
  const specFilter = parseSpecFilter(query && query.ozellik);
  return (list || []).filter((item) => {
    if (brandKeys.size) {
      if (!brandKeys.has(foldSearchText(String((item && item.brand) || "").trim()))) return false;
    }
    if (!matchesSpecFilter(item, specFilter)) return false;
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
  if (facets) facets.specs = buildSpecFacets(list, resolveCategoryQuerySlug(query && query.kategori) || "");
  let filtered = applyFacetFilters(list, query);
  filtered = sortPublicProducts(filtered, Object.assign({}, query, { sort: effectiveSort(query) }));
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
  if (!String(q || "").trim()) return list;
  return searchProducts(list, q, { tieBreak: popularityFallbackScore });
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

function isHomeFeaturedSnapshotValid(data, parentSlugs) {
  if (!data || !Array.isArray(data.products) || !data.products.length) return false;
  const byParent = data.byParent && typeof data.byParent === "object" ? data.byParent : {};
  const parents = Array.isArray(parentSlugs) && parentSlugs.length ? parentSlugs : REQUIRED_PARENT_SLUGS;
  return parents.some((slug) => Array.isArray(byParent[slug]) && byParent[slug].length);
}

/** "Tümü (en popüler)" mixes the parents that have a home tab; parents without a tab stay out. */
const HOME_POPULAR_PARENTS = new Set([
  "bilgisayar-tablet",
  "bilgisayar-bilesenleri",
  "kartus-toner",
  "baski-cozumleri",
  "yapi-gerecleri",
  "ofis-urunleri",
]);

/** Prefer rows a shopper can order alone (≥ minimum basket); cheaper rows only fill empty slots. */
function pickFeaturedAboveMinimum(list, per, popularity, minPriceInclVat) {
  const min = Number(minPriceInclVat) || 0;
  if (min <= 0) return pickDiverseFeatured(list, per, popularity);
  const eligible = list.filter((item) => priceInclVatAmount(item) >= min);
  const picked = pickDiverseFeatured(eligible, per, popularity);
  if (picked.length >= per) return picked;
  const rest = list.filter((item) => priceInclVatAmount(item) < min);
  return picked.concat(pickDiverseFeatured(rest, per - picked.length, popularity));
}

function homeFeaturedCatalog(products, query, options) {
  const per = Math.min(
    FEATURED_PER_CATEGORY,
    Math.max(1, Number(query && query.limit) || FEATURED_PER_CATEGORY)
  );
  const popularity = (query && query.popularity && typeof query.popularity === "object"
    ? query.popularity
    : {}) || {};
  const minPrice = Number(query && query.minPriceInclVat) || 0;
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
      pickFeaturedAboveMinimum(filtered, per, popularity, minPrice).map((item) =>
        toPublicProduct(item, pubOpts)
      ),
      routeIndex
    );
  });
  // "Tümü": kategori karışımı değil — satış/görüntülenme + Akakçe market popülerliği
  const popularPool = active.filter((item) => HOME_POPULAR_PARENTS.has(siteParentOf(item)));
  const allPopular = withPublicProductUrls(
    pickFeaturedAboveMinimum(popularPool, per, popularity, minPrice).map((item) =>
      toPublicProduct(item, pubOpts)
    ),
    routeIndex
  );
  return {
    byParent,
    products: allPopular.length ? allPopular : mixFeaturedProducts(byParent, per),
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

function listingSnapshotPageFileName(baseFile, page) {
  const pageNum = Math.max(1, Math.floor(Number(page) || 1));
  const base = String(baseFile || "all.json");
  if (pageNum <= 1) return base;
  return base.replace(/\.json$/i, "") + "__p" + pageNum + ".json";
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
  supplierStorefrontCandidates,
  toPublicProduct,
  productHasStorefrontImage,
  resolveStorefrontProductImages,
  collectRawProductImages,
  withPublicProductUrls,
  enrichCatalogSnapshotProducts,
  applyTextSearch,
  buildBrandCounts,
  queryPublicCatalog,
  buildStorefrontIndex,
  queryPublicCatalogIndexed,
  homeFeaturedCatalog,
  isHomeFeaturedSnapshotValid,
  productPagePath,
  mixFeaturedProducts,
  pickDiverseFeatured,
  FEATURED_PER_CATEGORY,
  PRICE_PRESETS,
  priceInclVatAmount,
  listingSnapshotFileName,
  listingSnapshotPageFileName,
  listingSnapshotJobs,
  listingKeysFromTree,
  buildStorefrontLeafKeys,
};
