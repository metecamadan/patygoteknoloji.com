"use strict";

const { mergeCatalogProducts } = require("./catalog");

function lookupCheckoutProductsByIds(ids, options) {
  const settings = options || {};
  const want = [
    ...new Set(
      (ids || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ),
  ].slice(0, 40);
  if (!want.length) return {};
  const idSet = new Set(want);
  const loadManual = settings.loadManual || (() => []);
  const getSupplierById = settings.getSupplierById || (() => null);
  const manuals = loadManual().filter((item) => item && idSet.has(item.id));
  const suppliers = want.map((id) => getSupplierById(id)).filter(Boolean);
  const merged = mergeCatalogProducts(manuals, suppliers, settings.mergeOptions || {});
  const byId = Object.create(null);
  merged.forEach((product) => {
    if (product && product.id) byId[product.id] = product;
  });
  return byId;
}

module.exports = {
  lookupCheckoutProductsByIds,
};
