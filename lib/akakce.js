function xmlEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const { normalizeVatPercent, priceInclVat } = require("./product-fields");
const { stockReadIsFresh } = require("./stock-visibility");
const { resolveFeedImageUrl, isOwnSiteImage } = require("./product-image-mirror");
const { assignedSiteCategory, loadCategories } = require("./categories");
const { buildProductRouteIndex, productPagePath } = require("./product-url");
const { computeShippingFee, normalizeShippingSettings } = require("./shipping-settings");

const AKAKCE_NAME_MAX = 200;
const AKAKCE_URL_MAX = 255;
const AKAKCE_BRAND_MAX = 60;
const AKAKCE_EXTRA_IMAGES_MAX = 5;
const AKAKCE_PROMO_NAME =
  /\b(en ucuz|süper fiyat|super fiyat|kampanyal[ıi]|hediyeli|f[ıi]rsat ürünü|s[ıi]n[ıi]rl[ıi] stok)\b/gi;
const AKAKCE_KEEP_UPPER =
  /^(ddr[2345]|usb|vga|led|oled|nvme|sata|wifi|wi-fi|ghz|mhz|tb|gb|mb|ssd|hdd|ram|ecc|rgb|lga|am[45]|uhd|hd|pc|psu|atx)$/i;
const AKAKCE_KEEP_LOWER = /^(i[3-9]|i[0-9]{2})$/i;

function absoluteUrl(value, siteBaseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, siteBaseUrl + "/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function formatAkakceDecimal(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0." + "0".repeat(digits);
  return n.toFixed(digits);
}

function normalizeAkakceText(value) {
  return String(value || "")
    .replace(/[\u00A0\s]+/g, " ")
    .replace(/\s*[-–—]+\s*[-–—]+\s*/g, " - ")
    .replace(/\s*[-–—]\s*$/g, "")
    .replace(/^[-–—]\s*/, "")
    .trim();
}

function isMostlyUppercaseText(value) {
  const text = String(value || "");
  const letters = text.match(/[A-Za-zİıĞğÜüŞşÖöÇç]/g) || [];
  if (letters.length < 6) return false;
  const upper = letters.filter((ch) => ch === ch.toLocaleUpperCase("tr-TR") && ch !== ch.toLocaleLowerCase("tr-TR"));
  return upper.length / letters.length >= 0.78;
}

function formatAkakceBrand(brand) {
  const raw = normalizeAkakceText(brand);
  if (!raw) return "";
  if (raw.length <= 3) return raw.toLocaleUpperCase("en-US");
  if (!isMostlyUppercaseText(raw) && /[a-zğüşıöç]/.test(raw)) return raw.slice(0, AKAKCE_BRAND_MAX);
  return raw
    .split(/([-\s/]+)/)
    .map((part) => {
      if (!/[A-Za-zİıĞğÜüŞşÖöÇç]/.test(part)) return part;
      return part.charAt(0).toLocaleUpperCase("tr-TR") + part.slice(1).toLocaleLowerCase("tr-TR");
    })
    .join("")
    .slice(0, AKAKCE_BRAND_MAX);
}

function formatAkakceNameWord(word) {
  const token = String(word || "");
  if (!token) return token;
  if (AKAKCE_KEEP_LOWER.test(token)) return "i" + token.slice(1);
  if (AKAKCE_KEEP_UPPER.test(token)) return token.toUpperCase();
  if (/\d/.test(token)) return token;
  return token.charAt(0).toLocaleUpperCase("tr-TR") + token.slice(1).toLocaleLowerCase("tr-TR");
}

function formatAkakceNameBody(name) {
  let text = normalizeAkakceText(name)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(AKAKCE_PROMO_NAME, " ");
  text = normalizeAkakceText(text);
  if (!text) return "";
  if (isMostlyUppercaseText(text)) {
    text = text.split(" ").map(formatAkakceNameWord).join(" ");
  }
  return text;
}

function stripLeadingBrand(name, brands) {
  let out = normalizeAkakceText(name);
  const variants = (brands || [])
    .map((item) => normalizeAkakceText(item).toLocaleLowerCase("tr-TR"))
    .filter((item, index, list) => item.length >= 2 && list.indexOf(item) === index);
  let changed = true;
  while (changed && out) {
    changed = false;
    const folded = out.toLocaleLowerCase("tr-TR");
    for (const variant of variants) {
      if (folded === variant) {
        out = "";
        changed = true;
        break;
      }
      if (folded.startsWith(variant + " ") || folded.startsWith(variant + "/") || folded.startsWith(variant + "-")) {
        out = normalizeAkakceText(out.slice(variant.length).replace(/^[\s/-]+/, ""));
        changed = true;
        break;
      }
    }
  }
  return out;
}

function formatAkakceProductName(product) {
  const rawBrand = normalizeAkakceText(product && product.brand);
  const brand = formatAkakceBrand(rawBrand);
  const body = stripLeadingBrand(formatAkakceNameBody(product && product.name), [rawBrand, brand]);
  const name = normalizeAkakceText(brand ? (body ? brand + " " + body : brand) : body);
  if (name.length <= AKAKCE_NAME_MAX) return name;
  const sliced = name.slice(0, AKAKCE_NAME_MAX);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace >= 120) return sliced.slice(0, lastSpace).trim();
  return sliced.trim();
}

function formatDecimal(value, digits) {
  return formatAkakceDecimal(value, digits);
}

function cdataBlock(value) {
  const text = String(value || "");
  const safe = text.replace(/\]\]>/g, "]]]]><![CDATA[>");
  return "<![CDATA[" + safe + "]]>";
}

function resolveAkakceShipPrice(product, options) {
  const grossPrice = priceInclVat(product.price, product.vatPercent);
  const shippingSettings =
    options && options.shippingSettings ? normalizeShippingSettings(options.shippingSettings) : null;
  if (shippingSettings && shippingSettings.shippingFee > 0) {
    return computeShippingFee(grossPrice, shippingSettings);
  }
  const settings = akakceFeedConfig(options);
  return settings.shipPrice;
}

function akakceFeedConfig(options) {
  const opts = options || {};
  const shipPrice = Number(
    opts.shipPrice !== undefined ? opts.shipPrice : process.env.AKAKCE_SHIP_PRICE || 0
  );
  const dayOfDelivery = Math.max(
    0,
    Math.floor(
      Number(
        opts.dayOfDelivery !== undefined ? opts.dayOfDelivery : process.env.AKAKCE_DAY_OF_DELIVERY || 2
      )
    )
  );
  const expressHour = String(
    opts.expressDeliveryTime !== undefined
      ? opts.expressDeliveryTime
      : process.env.AKAKCE_EXPRESS_DELIVERY_HOUR || ""
  ).trim();
  return {
    shipPrice: Number.isFinite(shipPrice) ? Math.max(0, shipPrice) : 0,
    dayOfDelivery: Number.isFinite(dayOfDelivery) ? dayOfDelivery : 2,
    expressDeliveryTime: dayOfDelivery === 0 ? expressHour : "",
  };
}

function productStock(product) {
  let stock;
  if (Number.isFinite(Number(product.stockQty))) {
    stock = Math.max(0, Math.floor(Number(product.stockQty)));
  } else {
    stock = product.source === "supplier" ? 0 : 1;
  }
  const critical = Number(product.criticalStockQty);
  if (
    product.catalogStale !== true &&
    product.source === "supplier" &&
    Number.isFinite(critical) &&
    Number.isFinite(stock) &&
    stock <= critical
  ) {
    return 0;
  }
  return stock;
}

function akakceSku(product) {
  return String(product.id || product.supplierSku || "").trim();
}

function akakceProductCategory(product, categories) {
  const assigned = assignedSiteCategory(product, categories);
  if (!assigned) return "";
  if (assigned.mid) {
    return [assigned.parent.name, assigned.mid.name, assigned.child.name].join(" > ");
  }
  return String(assigned.label || "")
    .replace(/ › /g, " > ")
    .trim();
}

function resolveMirroredImages(product, siteBaseUrl, mirrorIndex) {
  const rawImages = Array.isArray(product.images)
    ? product.images.filter(Boolean)
    : product.image
      ? [product.image]
      : [];
  const urls = [];
  const seen = new Set();
  for (const raw of rawImages) {
    const resolved = mirrorIndex
      ? resolveFeedImageUrl(raw, siteBaseUrl, mirrorIndex)
      : absoluteUrl(raw, siteBaseUrl);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved.slice(0, AKAKCE_URL_MAX));
  }
  return urls;
}

function analyzeAkakceProducts(products, options) {
  const siteBaseUrl = String((options && options.siteBaseUrl) || "").replace(/\/+$/, "");
  const categories = (options && options.categories) || loadCategories();
  const eligible = [];
  const excluded = [];
  for (const product of products || []) {
    if (!product || product.active === false) continue;
    const reasons = [];
    const sku = akakceSku(product);
    const price = Number(product.price);
    const mirrorIndex = (options && options.mirrorIndex) || null;
    const imageUrls = resolveMirroredImages(product, siteBaseUrl, mirrorIndex);
    const imageUrl = imageUrls[0] || "";
    const stock = productStock(product);
    const categoryPath = akakceProductCategory(product, categories);
    if (!sku) reasons.push("Stok kodu eksik");
    if (!String(product.name || "").trim()) reasons.push("Ürün adı eksik");
    if (!String(product.brand || "").trim()) reasons.push("Marka eksik");
    if (!categoryPath) reasons.push("Site kategorisi eksik");
    if (!Number.isFinite(price) || price <= 0) reasons.push("Fiyat geçersiz");
    if (!imageUrl) {
      const rawImage = absoluteUrl(product.image, siteBaseUrl);
      if (mirrorIndex && rawImage && !isOwnSiteImage(rawImage, siteBaseUrl)) {
        reasons.push("Görsel aynası hazır değil");
      } else {
        reasons.push("Görsel eksik");
      }
    }
    if (!String(product.barcode || "").trim()) reasons.push("Barkod eksik");
    if (![1, 8, 10, 20].includes(Number(product.vatPercent))) reasons.push("KDV geçersiz");
    if (!Number.isFinite(Number(product.stockQty)) && product.source === "manual") {
      reasons.push("Stok bilgisi eksik");
    } else if (product.source === "supplier" && stock <= 0) {
      reasons.push("Stok yok");
    }
    if (
      product.source === "supplier" &&
      !stockReadIsFresh(product.lastSuccessfulFetchAt, product.catalogStale, options && options.now)
    ) {
      reasons.push("Son 7 günde stok okunamadı");
    }
    if (!siteBaseUrl) reasons.push("Site adresi eksik");
    if (reasons.length) {
      excluded.push({
        id: product.id || sku,
        name: product.name || sku,
        reasons,
      });
    } else {
      eligible.push(product);
    }
  }
  const reasonCounts = {};
  for (const item of excluded) {
    for (const reason of item.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }
  return {
    total: eligible.length + excluded.length,
    eligible,
    excluded,
    reasonCounts,
  };
}

function analyzeSupplierFeedIssues(product, options) {
  const siteBaseUrl = String((options && options.siteBaseUrl) || "").replace(/\/+$/, "");
  const probe = Object.assign({}, product, {
    source: "supplier",
    active: true,
    price: product.salePrice,
    image: product.image,
    description: product.description,
    details: product.description,
  });
  const analysis = analyzeAkakceProducts([probe], { siteBaseUrl });
  const baseReasons = (analysis.excluded[0] && analysis.excluded[0].reasons) || ["Feed uygun değil"];
  const extra = [];
  if (!String(product.manufacturerCode || "").trim()) extra.push("Üretici kodu eksik");
  if (!String(product.gtipCode || "").trim()) extra.push("GTIP kodu eksik");
  if (!String(product.mainCategory || product.category || "").trim()) extra.push("Ana kategori eksik");
  if (!String(product.midCategory || "").trim()) extra.push("Ara kategori eksik");
  if (!String(product.subCategory || "").trim()) extra.push("Alt kategori eksik");
  if (!String(product.currency || "").trim()) extra.push("Döviz türü eksik");
  if (!String(product.unit || "").trim()) extra.push("Birim eksik");
  if (analysis.eligible.length && !extra.length) return [];
  return baseReasons.concat(extra);
}

function isSupplierFeedReady(product, options) {
  return analyzeSupplierFeedIssues(product, options).length === 0;
}

function buildAkakceFeedSummary(products, options) {
  const siteBaseUrl = String((options && options.siteBaseUrl) || "").replace(/\/+$/, "");
  const analysis = analyzeAkakceProducts(products, options || {});
  const shipping = normalizeShippingSettings((options && options.shippingSettings) || {});
  return {
    path: "/api/feeds/akakce.xml",
    publicUrl: siteBaseUrl ? siteBaseUrl + "/api/feeds/akakce.xml" : "/api/feeds/akakce.xml",
    format: "Akakce v1.3",
    activeCount: analysis.eligible.length,
    excludedCount: analysis.excluded.length,
    catalogActiveCount: analysis.total,
    supplierActiveCount: analysis.eligible.filter((item) => item.source === "supplier").length,
    manualActiveCount: analysis.eligible.filter((item) => item.source === "manual").length,
    reasonCounts: analysis.reasonCounts,
    issues: analysis.excluded.slice(0, 20),
    shipping: {
      freeShippingThreshold: shipping.freeShippingThreshold,
      shippingFee: shipping.shippingFee,
      enabled: shipping.shippingFee > 0,
    },
  };
}

function productPageUrl(product, siteBaseUrl, routeIndex) {
  const base = String(siteBaseUrl || "").replace(/\/+$/, "");
  const path =
    (product && product.urlPath) ||
    (routeIndex && routeIndex.byId && routeIndex.byId[product.id]) ||
    productPagePath(product);
  return base ? base + path : path;
}

function buildAkakceXml(products, options) {
  const siteBaseUrl = String(options.siteBaseUrl || "").replace(/\/+$/, "");
  const settings = akakceFeedConfig(options);
  const categories = (options && options.categories) || loadCategories();
  const analysis = analyzeAkakceProducts(products, options || {});
  const routeIndex = buildProductRouteIndex(products);
  const mirrorIndex = (options && options.mirrorIndex) || null;
  const rows = analysis.eligible.map((product) => {
    const stock = productStock(product);
    const imageUrls = resolveMirroredImages(product, siteBaseUrl, mirrorIndex);
    if (mirrorIndex && !imageUrls.length) return "";
    const mainImage = imageUrls[0] || "";
    const extraImages = imageUrls.slice(1, 1 + AKAKCE_EXTRA_IMAGES_MAX);
    const name = formatAkakceProductName(product);
    const pageUrl = productPageUrl(product, siteBaseUrl, routeIndex).slice(0, AKAKCE_URL_MAX);
    const description = String(product.details || product.description || name).trim();
    const grossPrice = priceInclVat(product.price, product.vatPercent);
    const shipPrice = resolveAkakceShipPrice(product, options);
    const brand = formatAkakceBrand(product.brand);
    const categoryPath = akakceProductCategory(product, categories).slice(0, 255);
    const barcode = String(product.barcode || "").trim().slice(0, 40);
    const parts = [
      "<product>",
      "<sku>" + xmlEscape(akakceSku(product)) + "</sku>",
      "<name>" + xmlEscape(name) + "</name>",
      "<url>" + xmlEscape(pageUrl) + "</url>",
      "<imgUrl>" + xmlEscape(mainImage) + "</imgUrl>",
    ];
    if (extraImages.length) {
      parts.push("<additionalimages>");
      extraImages.forEach((url) => {
        parts.push("<imgUrl>" + xmlEscape(url) + "</imgUrl>");
      });
      parts.push("</additionalimages>");
    }
    parts.push("<description>" + cdataBlock(description) + "</description>");
    parts.push("<distributor></distributor>");
    parts.push("<price>" + formatAkakceDecimal(grossPrice, 2) + "</price>");
    parts.push("<shipPrice>" + formatAkakceDecimal(shipPrice, 2) + "</shipPrice>");
    parts.push("<dayOfDelivery>" + xmlEscape(settings.dayOfDelivery) + "</dayOfDelivery>");
    parts.push(
      "<expressDeliveryTime>" +
        xmlEscape(settings.expressDeliveryTime) +
        "</expressDeliveryTime>"
    );
    parts.push("<quantity>" + xmlEscape(stock) + "</quantity>");
    parts.push("<productBrand>" + xmlEscape(brand) + "</productBrand>");
    parts.push("<productCategory>" + xmlEscape(categoryPath) + "</productCategory>");
    parts.push("<barcode>" + xmlEscape(barcode) + "</barcode>");
    parts.push("</product>");
    return parts.join("\n");
  });
  return (
    '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n' +
    '<products xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
    rows.filter(Boolean).join("\n") +
    "\n</products>"
  );
}

module.exports = {
  analyzeAkakceProducts,
  analyzeSupplierFeedIssues,
  isSupplierFeedReady,
  buildAkakceFeedSummary,
  buildAkakceXml,
  xmlEscape,
  absoluteUrl,
  formatDecimal,
  formatAkakceDecimal,
  productStock,
  productPageUrl,
  akakceFeedConfig,
  resolveAkakceShipPrice,
  akakceProductCategory,
  akakceSku,
  formatAkakceBrand,
  formatAkakceProductName,
};
