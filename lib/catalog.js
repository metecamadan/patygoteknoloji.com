const { normalizeVatPercent } = require("./product-fields");
const { loadCategories, hasSiteCategory } = require("./categories");

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
    .map((item) => {
      const tree = defaults[item.category] || defaults.bilgisayar || {};
      const assignedParent = String(item.siteParent || "").trim();
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
        siteParent: assignedParent,
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
    alt: product.siteChild || product.alt || "",
    description: product.description || "",
    details: product.details || "",
    image: String(images[0] || product.image || "").replace(/^http:\/\//i, "https://"),
    images: images.map((src) => String(src).replace(/^http:\/\//i, "https://")),
    featured: Boolean(product.featured),
    active: product.active !== false,
  };
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
  const parent = String(query.kategori || "").trim();
  const child = String(query.alt || "").trim();
  if (parent) list = list.filter((item) => String(item.category || "") === parent);
  if (child) list = list.filter((item) => String(item.alt || "") === child);
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

module.exports = { mergeCatalogProducts, toPublicProduct, queryPublicCatalog };
