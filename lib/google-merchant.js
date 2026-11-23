"use strict";

const { priceInclVat } = require("./product-fields");
const { buildProductRouteIndex } = require("./product-url");
const { loadCategories } = require("./categories");
const { normalizeShippingSettings } = require("./shipping-settings");
const {
  analyzeAkakceProducts,
  akakceSku,
  akakceProductCategory,
  formatAkakceBrand,
  formatAkakceProductName,
  productPageUrl,
  productStock,
  resolveAkakceShipPrice,
  resolveMirroredImages,
} = require("./akakce");

const MERCHANT_EXTRA_IMAGES_MAX = 10;
const MERCHANT_DESC_MAX = 5000;
const GTIN_RE = /^\d{8,14}$/;

function analyzeMerchantProducts(products, options) {
  return analyzeAkakceProducts(products, options || {});
}

function priceToMicros(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(Math.round(n * 1_000_000));
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u00A0\s]+/g, " ")
    .trim();
}

function merchantDescription(product, fallbackTitle) {
  const text = stripHtml(product.details || product.description || fallbackTitle || "");
  if (text.length <= MERCHANT_DESC_MAX) return text;
  return text.slice(0, MERCHANT_DESC_MAX - 1).trim() + "…";
}

function merchantGtin(product) {
  const raw = String(product.barcode || "").trim();
  return GTIN_RE.test(raw) ? raw : "";
}

/**
 * Map one storefront product to Merchant API ProductInput.
 * Prefer Akakçe-eligible products from analyzeMerchantProducts / buildMerchantProductInputs.
 */
function toMerchantProductInput(product, options) {
  const opts = options || {};
  const siteBaseUrl = String(opts.siteBaseUrl || "").replace(/\/+$/, "");
  const categories = opts.categories || loadCategories();
  const routeIndex = opts.routeIndex || null;
  const mirrorIndex = opts.mirrorIndex || null;
  const offerId = akakceSku(product);
  if (!offerId || !siteBaseUrl) return null;

  const title = formatAkakceProductName(product);
  const brand = formatAkakceBrand(product.brand);
  const images = resolveMirroredImages(product, siteBaseUrl, mirrorIndex);
  if (!images.length || !title || !brand) return null;

  const gross = priceInclVat(product.price, product.vatPercent, product.basamak);
  const micros = priceToMicros(gross);
  if (!micros || micros === "0") return null;

  const stock = productStock(product);
  const availability = stock > 0 && product.soldOut !== true ? "IN_STOCK" : "OUT_OF_STOCK";
  const categoryPath = akakceProductCategory(product, categories);
  const link = productPageUrl(product, siteBaseUrl, routeIndex);
  const shipPrice = resolveAkakceShipPrice(product, opts);
  const shipMicros = priceToMicros(shipPrice);
  const gtin = merchantGtin(product);

  const productAttributes = {
    title,
    description: merchantDescription(product, title),
    link,
    imageLink: images[0],
    condition: "NEW",
    availability,
    brand,
    price: {
      amountMicros: micros,
      currencyCode: "TRY",
    },
  };

  const extra = images.slice(1, 1 + MERCHANT_EXTRA_IMAGES_MAX);
  if (extra.length) productAttributes.additionalImageLinks = extra;
  if (categoryPath) productAttributes.productTypes = [categoryPath];
  if (gtin) productAttributes.gtins = [gtin];

  if (shipMicros !== null) {
    productAttributes.shipping = [
      {
        country: "TR",
        price: {
          amountMicros: shipMicros,
          currencyCode: "TRY",
        },
      },
    ];
  }

  const shippingSettings =
    opts.shippingSettings != null ? normalizeShippingSettings(opts.shippingSettings) : null;
  if (shippingSettings && shippingSettings.freeShippingThreshold > 0) {
    const thresholdMicros = priceToMicros(shippingSettings.freeShippingThreshold);
    if (thresholdMicros) {
      productAttributes.freeShippingThreshold = [
        {
          country: "TR",
          priceThreshold: {
            amountMicros: thresholdMicros,
            currencyCode: "TRY",
          },
        },
      ];
    }
  }

  return {
    offerId,
    contentLanguage: "tr",
    feedLabel: "TR",
    productAttributes,
  };
}

function buildMerchantProductInputs(products, options) {
  const opts = options || {};
  const analysis = analyzeMerchantProducts(products, opts);
  const routeIndex = opts.routeIndex || buildProductRouteIndex(analysis.eligible);
  const inputs = [];
  for (const product of analysis.eligible) {
    const input = toMerchantProductInput(product, { ...opts, routeIndex });
    if (input) inputs.push(input);
  }
  return {
    total: analysis.total,
    eligible: analysis.eligible.length,
    excluded: analysis.excluded.length,
    reasonCounts: analysis.reasonCounts,
    inputs,
  };
}

module.exports = {
  analyzeMerchantProducts,
  toMerchantProductInput,
  buildMerchantProductInputs,
  priceToMicros,
  merchantGtin,
  merchantDescription,
};
