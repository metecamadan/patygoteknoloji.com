"use strict";

const { createMultiSupplierManager } = require("./multi-supplier");

function supplierManagerOptions(env) {
  const source = env || process.env;
  return {
    allowedHosts: String(
      source.SUPPLIER_ALLOWED_HOSTS || "www.bilgisayarim.com.tr"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    defaultMarginPercent: source.SUPPLIER_MARGIN_PERCENT || 15,
    slots: [
      {
        id: "supplier-1",
        filePrefix: "supplier",
        defaultName: "XML Kaynağı 1",
        envUrl: source.SUPPLIER_XML_URL || "",
      },
      {
        id: "supplier-2",
        filePrefix: "supplier-2",
        defaultName: "XML Kaynağı 2",
        envUrl: source.SUPPLIER_XML_URL_2 || "",
      },
      {
        id: "supplier-3",
        filePrefix: "supplier-3",
        defaultName: "XML Kaynağı 3",
        envUrl: source.SUPPLIER_XML_URL_3 || "",
      },
    ],
  };
}

function createConfiguredSupplierManager(root, env) {
  return createMultiSupplierManager(root, supplierManagerOptions(env));
}

module.exports = {
  supplierManagerOptions,
  createConfiguredSupplierManager,
};
