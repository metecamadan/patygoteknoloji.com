function mergeCatalogProducts(manualProducts, supplierProducts, options) {
  const settings = options || {};
  const normalize = settings.normalizeProduct || ((product) => Object.assign({}, product));
  const manual = (manualProducts || [])
    .map((item) => Object.assign({}, normalize(item), { source: "manual" }))
    .filter((item) => settings.includeInactiveManual || item.active !== false);
  const manualIds = new Set(manual.map((item) => item.id));
  const supplier = (supplierProducts || [])
    .filter((item) => item && item.active === true)
    .map((item) => {
      const normalized = normalize({
        id: item.id,
        brand: item.brand,
        name: item.name,
        price: item.salePrice,
        category: item.category,
        description: item.description,
        details: item.description,
        image: item.image,
        images: item.image ? [item.image] : [],
        featured: false,
        active: true,
      });
      return Object.assign({}, normalized, {
        source: "supplier",
        supplierSku: item.supplierSku,
        barcode: item.barcode || "",
        stockQty: item.stockQty,
        costPrice: item.costPrice,
      });
    })
    .filter((item) => !manualIds.has(item.id));
  return manual.concat(supplier);
}

module.exports = { mergeCatalogProducts };
