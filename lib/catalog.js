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
        details: item.description,
        image: item.image,
        images: item.image ? [item.image] : [],
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
    image: images[0] || product.image || "",
    images,
    featured: Boolean(product.featured),
    active: product.active !== false,
  };
}

module.exports = { mergeCatalogProducts, toPublicProduct };
