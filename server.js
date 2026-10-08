#!/usr/bin/env node
/**
 * Patygo Teknoloji — yerel sunucu + ürün admin API
 * Çalıştırma: node server.js
 * Admin şifresi: ADMIN_PASSWORD ortam değişkeni (varsayılan: patygo-admin)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { createMultiSupplierManager } = require("./lib/multi-supplier");
const { atomicWriteJson } = require("./lib/supplier");
const { createAdminSessionStore } = require("./lib/admin-sessions");
const {
  publishSupplierSlot,
  syncXmlSiteCategoriesAsync,
  markPanelCategoryChoice,
} = require("./lib/supplier-site");
const { createSupplierScheduler, getNextScheduledAt, scheduleSummary } = require("./lib/supplier-schedule");
const { analyzeAkakceProducts, analyzeSupplierFeedIssues, buildAkakceFeedSummary, buildAkakceXml } = require("./lib/akakce");
const { buildAdminCatalogSummary } = require("./lib/admin-catalog-summary");
const {
  MAX_REQUEST_BYTES: LEAD_REPLY_MAX_REQUEST_BYTES,
  validateLeadReplyInput,
  sendLeadReply,
} = require("./lib/lead-reply");
const {
  MAX_ORDER_DOC_REQUEST_BYTES,
  validateOrderDocInput,
  createOrderDocStore,
  createDocLinkSigner,
} = require("./lib/order-docs");
const { loadMirrorIndex, mirrorAkakceCatalogImages, mirrorPaths, getCachedPlaceholderMirrorFileSet } = require("./lib/product-image-mirror");
const { generateMissingThumbnails } = require("./lib/product-thumbnails");
const {
  mergeCatalogProducts,
  queryPublicCatalog,
  queryPublicCatalogIndexed,
  similarProductsIndexed,
  buildBrandCounts,
  buildStorefrontIndex,
  buildStorefrontLeafKeys,
  homeFeaturedCatalog,
  isHomeFeaturedSnapshotValid,
  listingSnapshotFileName,
  listingSnapshotJobs,
  enrichCatalogSnapshotProducts,
  supplierStorefrontCandidates,
  priceInclVatAmount,
} = require("./lib/catalog");
const {
  createCategoryStore,
  setCategoryListLoader,
  setPublicCategoryLeafKeysLoader,
  parseUrunlerPathname,
  categoryQueryToPath,
  categoryHref,
  loadCategories,
} = require("./lib/categories");
const { buildStorefrontSitemap } = require("./lib/sitemap");
const {
  CATEGORY_FEED_DEFAULTS,
  validateManualFeedFields,
  normalizeVatPercent,
  isAllowedVatPercent,
  vatAmountFromNet,
} = require("./lib/product-fields");
const { createAnalyticsStore } = require("./lib/analytics");
const {
  createAkbankConfig,
  buildHostedPaymentForm,
  verifyCallbackHash,
  isPaymentSuccess,
  sanitizeBankCallbackPayload,
  decidePaymentFromBank,
  publicPosStatus,
  formatAmount,
  executeBankReversal,
  queryOrderTransactions,
  summarizeInquiry,
} = require("./lib/akbank-pos");
const {
  createBankReversalConfig,
  buildReversalPreview,
  buildReversalEvent,
  sanitizeReversalResponse,
  publicBankReversalStatus,
  reconcileFromInquiry,
  sumReversedAmount,
  buildReversalAlertMail,
} = require("./lib/akbank-reversal");
const { createOrderStore, ORDER_STATUSES, ADMIN_FULFILLMENT_STATUSES } = require("./lib/orders");
const { getDb } = require("./lib/db");
const { createPriceHistory } = require("./lib/price-history");
const {
  createCouponStore,
  evaluateCoupon,
  normalizeCode: normalizeCouponCode,
} = require("./lib/coupons");
const { createPriceAlertStore } = require("./lib/price-alerts");
const { buildReceivedMail: buildPriceAlertReceivedMail, buildNotifyMail: buildPriceAlertNotifyMail } = require("./lib/price-alert-mail");
const { createReviewStore, reviewEligibility, REVIEW_STATUSES } = require("./lib/reviews");
const { createCalendarStore } = require("./lib/calendar");
const { createAdminUserStore } = require("./lib/admin-users");
const { createConsentStore } = require("./lib/consent");
const { createAuditStore } = require("./lib/audit");
const { resolveSiteBaseUrl } = require("./lib/site-url");
const {
  SHIPPING_CARRIERS,
  NOTIFY_STATUSES,
  sendOrderStatusMail,
  itemDisplayName,
} = require("./lib/order-mail");
const {
  submitSalesInvoice,
  bizimhesapConfigured,
  pingBizimHesap,
  orderAllowsBizimHesapInvoice,
  findIssuedInvoiceNumber,
  listBizimHesapCustomers,
  reconcileInvoiceAfterReversal,
  buildInvoiceFollowupMail,
} = require("./lib/bizimhesap");
const {
  createContactStore,
  normalizeContactPayload,
  validateContactPayload,
  deliverContactMail,
  deliverSimpleMail,
  smtpConfigured,
  SMTP_NOT_CONFIGURED,
} = require("./lib/contact");
const {
  anonymizeOrder,
  createRetentionScheduler,
} = require("./lib/retention");
const {
  validateCustomerName,
  validateCustomerPhone,
} = require("./lib/customer-identity");
const { normalizeAddress, normalizeInvoiceIdentity } = require("./lib/checkout-billing");
const { lookupCheckoutProductsByIds } = require("./lib/checkout-products");
const { imageExtensionFromBytes } = require("./lib/image-bytes");
const {
  createAdminSecurityStore,
  updateEnvAdminPassword,
  MIN_ADMIN_PASSWORD_LENGTH,
} = require("./lib/admin-security");
const { createXmlFetchDigestStore } = require("./lib/xml-fetch-digest");
const { resolveOpsHealth } = require("./lib/ops-health");
const {
  attachProductUrlFields,
  parseProductRoutePath,
  resolveProductIdFromRoute,
  resolveLegacyProductPath,
  legacyRedirectNginxText,
} = require("./lib/product-url");
const {
  createShippingSettingsStore,
  computeShippingFee,
  minimumOrderError,
} = require("./lib/shipping-settings");
const { createInstallmentSettingsStore, resolveInstallment } = require("./lib/installment-settings");
const {
  renderProductHtml,
  renderSoldOutProductHtml,
  renderMissingProductHtml,
  renderCategoryHtml,
  renderMissingCategoryHtml,
  withListingPage,
} = require("./lib/product-ssr");

const ROOT = path.resolve(__dirname);
const DATA_ROOT = process.env.PATYGO_DATA_ROOT
  ? path.resolve(process.env.PATYGO_DATA_ROOT)
  : ROOT;
const ROOT_PREFIX = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const PORT = Number(process.env.PORT || process.argv[2] || 5173);

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ENV_FILE = path.join(ROOT, ".env");
const LEGACY_ADMIN_PASSWORD = "patygo-admin";
const DEFAULT_ADMIN_PASSWORD = "1234";

function migrateLegacyAdminPassword() {
  if (process.env.ADMIN_PASSWORD !== LEGACY_ADMIN_PASSWORD) return;
  try {
    if (!fs.existsSync(ENV_FILE)) return;
    const content = fs.readFileSync(ENV_FILE, "utf8");
    if (!/^ADMIN_PASSWORD=patygo-admin\s*$/m.test(content)) return;
    fs.writeFileSync(
      ENV_FILE,
      content.replace(/^ADMIN_PASSWORD=patygo-admin\s*$/m, `ADMIN_PASSWORD=${DEFAULT_ADMIN_PASSWORD}`),
      "utf8"
    );
    console.log(`ADMIN_PASSWORD .env dosyasında ${DEFAULT_ADMIN_PASSWORD} olarak güncellendi.`);
  } catch (err) {
    console.warn("ADMIN_PASSWORD migration skipped:", err.message);
  }
}
migrateLegacyAdminPassword();

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD === LEGACY_ADMIN_PASSWORD
    ? DEFAULT_ADMIN_PASSWORD
    : process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : LEGACY_ADMIN_PASSWORD);
let runtimeAdminPassword = ADMIN_PASSWORD;
function getAdminPassword() {
  return runtimeAdminPassword;
}
function setRuntimeAdminPassword(next) {
  runtimeAdminPassword = String(next || "");
}
if (!getAdminPassword()) {
  throw new Error("Canlı ortamda ADMIN_PASSWORD tanımlanmalıdır.");
}
const adminSecurityStore = createAdminSecurityStore(DATA_ROOT);
const xmlFetchDigest = createXmlFetchDigestStore(DATA_ROOT);
if (IS_PRODUCTION && adminSecurityStore.shouldForcePasswordChange(getAdminPassword())) {
  adminSecurityStore.activateForcePasswordChange(
    "Panel şifresi bir sonraki oturumda güncellenmeli (en az " +
      MIN_ADMIN_PASSWORD_LENGTH +
      " karakter)."
  );
  console.warn(
    "UYARI: Panel şifresi zayıf; bir sonraki admin oturumunda güçlü parola istenecek."
  );
}
const BIND_HOST = process.env.BIND_HOST || (IS_PRODUCTION ? "127.0.0.1" : "0.0.0.0");
const PRODUCTS_FILE = path.join(DATA_ROOT, "assets", "data", "products.json");
const PRODUCTS_IMG_DIR = path.join(ROOT, "assets", "img", "products");
const SITE_BASE_URL = resolveSiteBaseUrl(process.env.SITE_BASE_URL, PORT, IS_PRODUCTION);
const rawIdleMs = Number(process.env.ADMIN_IDLE_MS);
const ADMIN_IDLE_MS =
  Number.isFinite(rawIdleMs) && rawIdleMs > 0 ? rawIdleMs : 30 * 60 * 1000;
const adminSessionStore = createAdminSessionStore(DATA_ROOT, { idleMs: ADMIN_IDLE_MS });
const supplierAllowedHosts = String(
  process.env.SUPPLIER_ALLOWED_HOSTS ||
    "www.bilgisayarim.com.tr"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const supplierManager = createMultiSupplierManager(DATA_ROOT, {
  allowedHosts: supplierAllowedHosts,
  defaultMarginPercent: process.env.SUPPLIER_MARGIN_PERCENT || 15,
  slots: [
    {
      id: "supplier-1",
      filePrefix: "supplier",
      defaultName: "XML Kaynağı 1",
      envUrl: process.env.SUPPLIER_XML_URL || "",
    },
    {
      id: "supplier-2",
      filePrefix: "supplier-2",
      defaultName: "XML Kaynağı 2",
      envUrl: process.env.SUPPLIER_XML_URL_2 || "",
    },
    {
      id: "supplier-3",
      filePrefix: "supplier-3",
      defaultName: "XML Kaynağı 3",
      envUrl: process.env.SUPPLIER_XML_URL_3 || "",
    },
  ],
});
const analyticsStore = createAnalyticsStore(DATA_ROOT, {
  resolveProductIdFromPath(pathname) {
    const route = parseProductRoutePath(pathname);
    if (!route) return "";
    const routeIndex = storefrontIndex(false).routeIndex;
    return resolveProductIdFromRoute(routeIndex, route.segment, route.slug);
  },
});
const orderStore = createOrderStore(DATA_ROOT);
let priceHistory = null;
try {
  priceHistory = createPriceHistory(getDb(DATA_ROOT));
} catch (err) {
  console.error("[price-history] devre dışı:", err && err.message);
}

function recordPriceHistory(products) {
  if (!priceHistory) return;
  try {
    priceHistory.record(products);
  } catch (err) {
    console.error("[price-history] kayıt hatası:", err && err.message);
  }
}

let couponStore = null;
try {
  couponStore = createCouponStore(getDb(DATA_ROOT));
} catch (err) {
  console.error("[coupons] devre dışı:", err && err.message);
}

let priceAlertStore = null;
try {
  priceAlertStore = createPriceAlertStore(getDb(DATA_ROOT));
} catch (err) {
  console.error("[price-alerts] devre dışı:", err && err.message);
}

let reviewStore = null;
try {
  reviewStore = createReviewStore(getDb(DATA_ROOT));
} catch (err) {
  console.error("[reviews] devre dışı:", err && err.message);
}

function reviewDataFor(productId) {
  if (!reviewStore) return null;
  try {
    const summary = reviewStore.summary(productId);
    return summary.count ? { summary, reviews: reviewStore.publicList(productId, 10) } : null;
  } catch (err) {
    console.error("[reviews] okuma hatası:", err && err.message);
    return null;
  }
}

function reviewPageUrl(order) {
  if (!order || !order.accessToken) return "";
  return (
    SITE_BASE_URL +
    "/degerlendir?siparis=" +
    encodeURIComponent(order.id) +
    "&token=" +
    encodeURIComponent(order.accessToken)
  );
}

/** Storefront product (sellable, in stock) as the alert checker sees it, or null. */
function priceAlertProduct(productId) {
  const index = storefrontIndex(false);
  if (!index.compactById) index.compactById = new Map(index.compactAll.map((item) => [String(item.id), item]));
  const item = index.compactById.get(String(productId || ""));
  if (!item) return null;
  const image = item.image || (Array.isArray(item.images) ? item.images.find(Boolean) : "") || "";
  return { priceIncl: priceInclVatAmount(item), name: item.name, urlPath: item.urlPath, image };
}

/** Published but sold-out product (stock alert target), or null. priceIncl is the last known price. */
function soldOutAlertProduct(productId) {
  const item = soldOutCompact(productId);
  if (!item) return null;
  const image = item.image || (Array.isArray(item.images) ? item.images.find(Boolean) : "") || "";
  return { priceIncl: priceInclVatAmount(item), name: item.name, urlPath: item.urlPath, image, soldOut: true };
}

function alertProductInfo(productId) {
  return priceAlertProduct(productId) || soldOutAlertProduct(productId);
}

let priceAlertRun = null;

async function runPriceAlertCheck() {
  if (!priceAlertStore || priceAlertRun || !smtpConfigured(process.env)) return priceAlertRun;
  priceAlertRun = (async () => {
    try {
      priceAlertStore.purge();
      const due = priceAlertStore.evaluate(priceAlertProduct);
      for (const entry of due) {
        try {
          await deliverSimpleMail(buildPriceAlertNotifyMail(entry));
          priceAlertStore.markNotified(entry);
        } catch (err) {
          console.error("[price-alerts] bildirim gönderilemedi:", err && err.message);
        }
      }
      if (due.length) console.log("[price-alerts] gönderilen bildirim:", due.length);
    } catch (err) {
      console.error("[price-alerts] kontrol hatası:", err && err.message);
    } finally {
      priceAlertRun = null;
    }
  })();
  return priceAlertRun;
}

/** Returns { coupon, discount } for a valid code, null for an empty code; throws on invalid. */
function resolveCheckoutCoupon(code, merchandiseTotal) {
  const key = normalizeCouponCode(code);
  if (!key) return null;
  if (!couponStore) throw new Error("Kupon şu anda kullanılamıyor.");
  const coupon = couponStore.get(key);
  const result = evaluateCoupon(coupon, merchandiseTotal, Date.now());
  if (!result.ok) throw new Error(result.error);
  return { coupon, discount: result.discount };
}

function priceReferenceFor(id, price) {
  if (!priceHistory) return 0;
  try {
    return priceHistory.referenceFor(id, price);
  } catch (err) {
    console.error("[price-history] okuma hatası:", err && err.message);
    return 0;
  }
}
const shippingSettingsStore = createShippingSettingsStore(DATA_ROOT);
const installmentSettingsStore = createInstallmentSettingsStore(DATA_ROOT);
const calendarStore = createCalendarStore(DATA_ROOT);
const categoryStore = createCategoryStore(DATA_ROOT);
setCategoryListLoader(() => categoryStore.list(), () => categoryStore.stamp());
const adminUserStore = createAdminUserStore(DATA_ROOT);
const consentStore = createConsentStore(DATA_ROOT);
const auditStore = createAuditStore(DATA_ROOT);
const orderDocStore = createOrderDocStore(DATA_ROOT);
const orderDocLinks = createDocLinkSigner();

function orderDocumentsWithLinks(orderId) {
  return orderDocStore.list(orderId).map((doc) => Object.assign({}, doc, { viewUrl: orderDocLinks.link(orderId, doc.id) }));
}

function sendOrderDocument(res, found) {
  res.writeHead(
    200,
    securityHeaders({
      "Content-Type": found.doc.contentType,
      "Content-Length": found.content.length,
      "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(found.doc.filename),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    })
  );
  res.end(found.content);
}
const contactStore = createContactStore(DATA_ROOT);
const akbankConfig = createAkbankConfig(process.env);
const bankReversalConfig = createBankReversalConfig(process.env, akbankConfig);
const bankOperationLocks = new Set(); // orderId — aynı siparişe eşzamanlı banka iade/sorgu yok
const paymentStartAttempts = new Map(); // IP -> { count, resetAt }
const couponCheckAttempts = new Map(); // IP -> { count, resetAt }
const priceAlertAttempts = new Map(); // IP -> { count, resetAt }
const reviewAttempts = new Map(); // IP -> { count, resetAt }
const contactAttempts = new Map(); // IP -> { count, resetAt }
const adminLoginAttempts = new Map(); // IP -> { count, resetAt }
const analyticsAttempts = new Map(); // IP -> { count, resetAt }

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const ALLOWED_EXT = new Set(Object.keys(MIME));
const BLOCKED_FILES = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  ".gitignore",
  "README.md",
  "admin-v2-preview.html",
]);

const CATEGORIES = new Set(["bilgisayar", "yazici", "kucuk-ev", "beyaz-esya"]);

fs.mkdirSync(path.dirname(PRODUCTS_FILE), { recursive: true });
fs.mkdirSync(PRODUCTS_IMG_DIR, { recursive: true });

function securityHeaders(extra) {
  return Object.assign(
    {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
        "script-src 'self'; style-src 'self' 'unsafe-inline' https:; " +
        "img-src 'self' data: https:; font-src 'self' data: https:; " +
        "connect-src 'self'; " +
        "form-action 'self' https://virtualpospaymentgatewaypre.akbank.com https://virtualpospaymentgateway.akbank.com",
    },
    extra || {}
  );
}

function json(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(
    status,
    securityHeaders(
      Object.assign(
        {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
        extraHeaders || {}
      )
    )
  );
  res.end(data);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseFormBody(buf) {
  const out = {};
  const params = new URLSearchParams(String(buf || ""));
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function clientIp(req) {
  return String((req.socket && req.socket.remoteAddress) || "unknown");
}

function rateLimited(map, ip, max, windowMs) {
  const now = Date.now();
  const attempt = map.get(ip);
  if (attempt && attempt.resetAt > now && attempt.count >= max) return true;
  if (attempt && attempt.resetAt <= now) map.delete(ip);
  const current = map.get(ip);
  map.set(ip, {
    count: current && current.resetAt > now ? current.count + 1 : 1,
    resetAt: current && current.resetAt > now ? current.resetAt : now + windowMs,
  });
  return false;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function makeOrderId() {
  const d = new Date();
  const stamp =
    d.getFullYear().toString().slice(2) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return "PTY-" + stamp + "-" + rand;
}

function makeOrderAccessToken() {
  return crypto.randomBytes(24).toString("hex");
}

function orderAccessOk(order, token) {
  if (!order || !order.accessToken || !token) return false;
  const a = Buffer.from(String(order.accessToken));
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function priceCheckoutItems(rawItems) {
  if (!rawItems.length) throw new Error("Sepet boş.");
  const productIds = rawItems.slice(0, 40).map((row) => String(row.productId || "").trim());
  const byId = lookupCheckoutProductsByIds(productIds, {
    loadManual: loadProducts,
    getSupplierById: (id) => supplierManager.getProductById(id),
    mergeOptions: {
      includeInactiveManual: false,
      normalizeProduct,
      categoryDefaults: CATEGORY_FEED_DEFAULTS,
    },
  });

  const items = [];
  let subtotal = 0;
  let vat = 0;
  for (const row of rawItems.slice(0, 40)) {
    const product = byId[String(row.productId || "")];
    if (!product || product.active === false) {
      throw new Error("Sepette geçersiz ürün var.");
    }
    const qty = Math.max(1, Math.min(99, Number(row.qty) || 1));
    const vatPercent = normalizeVatPercent(product.vatPercent);
    const unitPrice = product.price;
    const line = Math.round(unitPrice * qty * 100) / 100;
    const lineVat = vatAmountFromNet(line, vatPercent);
    subtotal += line;
    vat += lineVat;
    items.push({
      productId: product.id,
      brand: product.brand,
      name: product.name,
      unitPrice,
      vatPercent,
      qty,
      line,
      lineVat,
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  vat = Math.round(vat * 100) / 100;
  const merchandiseTotal = Math.round((subtotal + vat) * 100) / 100;
  return { items, subtotal, vat, merchandiseTotal };
}

function buildCheckoutOrder(body) {
  const rawItems = Array.isArray(body && body.items) ? body.items : [];
  const { items, subtotal, vat, merchandiseTotal } = priceCheckoutItems(rawItems);
  const shippingSettings = shippingSettingsStore.getSettings();
  const minimumError = minimumOrderError(merchandiseTotal, shippingSettings);
  if (minimumError) throw new Error(minimumError);
  const shippingFee = computeShippingFee(merchandiseTotal, shippingSettings);
  const applied = resolveCheckoutCoupon(body && body.couponCode, merchandiseTotal);
  const coupon = applied
    ? {
        code: applied.coupon.code,
        type: applied.coupon.type,
        value: applied.coupon.value,
        discount: applied.discount,
      }
    : null;
  const discount = coupon ? coupon.discount : 0;
  const baseTotal = Math.round((merchandiseTotal - discount + shippingFee) * 100) / 100;
  const installment = resolveInstallment(
    baseTotal,
    body && body.installCount,
    installmentSettingsStore.getSettings()
  );
  const total = installment ? installment.total : baseTotal;
  const customer = (body && body.customer) || {};
  const nameCheck = validateCustomerName(customer.name);
  if (!nameCheck.ok) throw new Error(nameCheck.error);
  const phoneCheck = validateCustomerPhone(customer.phone);
  if (!phoneCheck.ok) throw new Error(phoneCheck.error);
  const name = nameCheck.value;
  const email = String(customer.email || "").trim().slice(0, 120);
  const phone = phoneCheck.value;
  if (!email) throw new Error("Alıcı bilgileri eksik.");
  if (!isValidEmail(email)) throw new Error("Geçerli bir e-posta girin.");
  if (!body.contractsAccepted) throw new Error("Sözleşme onayları gerekli.");
  if (!body.kvkkAccepted) throw new Error("KVKK aydınlatma onayı gerekli.");

  let billingAddress = String(customer.billingAddress || "").trim().slice(0, 400);
  let shippingAddress = String(customer.shippingAddress || billingAddress).trim().slice(0, 400);
  let billingParts = null;
  let shippingParts = null;
  if (customer.billing && typeof customer.billing === "object") {
    const billingCheck = normalizeAddress(customer.billing, "Fatura adresi");
    if (!billingCheck.ok) throw new Error(billingCheck.error);
    billingParts = billingCheck.value;
    shippingParts = billingParts;
    if (customer.shipping && typeof customer.shipping === "object") {
      const shippingCheck = normalizeAddress(customer.shipping, "Teslimat adresi");
      if (!shippingCheck.ok) throw new Error(shippingCheck.error);
      shippingParts = shippingCheck.value;
    }
    billingAddress = billingParts.text;
    shippingAddress = shippingParts.text;
  }
  if (!billingAddress) throw new Error("Fatura adresi gerekli.");
  let invoice = {
    customerType: "",
    taxId: String(customer.taxId || "").trim().slice(0, 40),
    company: String(customer.company || "").trim().slice(0, 120),
    taxOffice: "",
  };
  if (customer.customerType) {
    const invoiceCheck = normalizeInvoiceIdentity(customer);
    if (!invoiceCheck.ok) throw new Error(invoiceCheck.error);
    invoice = invoiceCheck.value;
  }

  return {
    id: makeOrderId(),
    accessToken: makeOrderAccessToken(),
    items,
    subtotal,
    vat,
    merchandiseTotal,
    shippingFee,
    coupon,
    installment,
    total,
    currency: "TRY",
    customer: {
      name,
      company: invoice.company,
      email,
      phone,
      customerType: invoice.customerType,
      taxId: invoice.taxId,
      taxOffice: invoice.taxOffice,
      note: String(customer.note || "").trim().slice(0, 500),
      billingAddress,
      shippingAddress,
      billingCity: billingParts ? billingParts.city : "",
      billingDistrict: billingParts ? billingParts.district : "",
      billingPostalCode: billingParts ? billingParts.postalCode : "",
      shippingCity: shippingParts ? shippingParts.city : "",
      shippingDistrict: shippingParts ? shippingParts.district : "",
      shippingPostalCode: shippingParts ? shippingParts.postalCode : "",
    },
    contractsAccepted: {
      onBilgilendirme: true,
      mesafeliSatis: true,
      iadeCayma: true,
      kvkk: true,
      at: new Date().toISOString(),
    },
    status: "payment_pending",
    paymentStatus: "pending",
    paymentTaken: false,
    provider: "akbank",
    createdAt: new Date().toISOString(),
  };
}

function htmlRedirect(res, location) {
  const safe = String(location || "/").replace(/"/g, "");
  const body =
    "<!doctype html><html lang=\"tr\"><head><meta charset=\"utf-8\" />" +
    "<meta http-equiv=\"refresh\" content=\"0;url=" +
    safe +
    "\" /><title>Yönlendiriliyor</title></head><body>" +
    "<p>Yönlendiriliyorsunuz… <a href=\"" +
    safe +
    "\">Sipariş özetine git</a></p>" +
    "<script>location.replace(\"" +
    safe +
    "\");</script></body></html>";
  res.writeHead(
    303,
    securityHeaders({
      Location: safe,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    })
  );
  res.end(body);
}

function redirectTo(res, location) {
  res.writeHead(303, securityHeaders({ Location: String(location || "/"), "Cache-Control": "no-store" }));
  res.end();
}

function isBlocked(relPosix) {
  const lower = relPosix.toLowerCase();
  if (BLOCKED_FILES.has(path.basename(relPosix).toLowerCase())) return true;
  if (lower.startsWith(".git/") || lower.includes("/.git/")) return true;
  if (lower.startsWith(".env") || lower.includes("/.env")) return true;
  if (lower.startsWith(".runtime/") || lower.includes("/.runtime/")) return true;
  if (lower.startsWith("lib/") || lower.includes("/lib/")) return true;
  if (lower.startsWith("assets/data/") || lower.includes("/assets/data/")) {
    if (lower === "assets/data/categories.json" || lower.endsWith("/assets/data/categories.json")) {
      return false;
    }
    return true;
  }
  if (lower.startsWith("scripts/") || lower.includes("/scripts/")) return true;
  if (lower.startsWith("node_modules/")) return true;
  if (lower.startsWith(".cursor/")) return true;
  return false;
}

function safeJoin(root, reqPath) {
  let decoded;
  try {
    decoded = decodeURIComponent((reqPath || "/").split("?")[0]);
  } catch (_) {
    return null;
  }
  if (!decoded.startsWith("/")) decoded = "/" + decoded;
  const target = path.resolve(root, "." + decoded.replace(/\//g, path.sep));
  if (target !== root && !target.startsWith(ROOT_PREFIX)) return null;
  return target;
}

function loadProducts() {
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function saveProducts(list) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(list, null, 2), "utf8");
  invalidateStorefrontCatalog();
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const MIN_PRODUCT_IMAGES = 5;
const MAX_PRODUCT_IMAGES = 10;

function normalizeImageUrl(value) {
  const raw = String(value || "").trim().slice(0, 260);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  return raw.startsWith("/") ? raw : "/" + raw;
}

function normalizeProduct(p, fallbackId) {
  const id = slugify(p.id || p.name || fallbackId || crypto.randomBytes(4).toString("hex"));
  const siteParent = String((p && (p.siteParent || p.siteParentSlug)) || "").trim();
  const siteMid = String((p && (p.siteMid || p.siteMidSlug)) || "").trim();
  const siteChild = String((p && (p.siteChild || p.siteChildSlug)) || "").trim();
  const rawCategory = String((p && p.category) || "").trim();
  const slugOk = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || "").trim());
  const category = slugOk(siteParent)
    ? siteParent
    : CATEGORIES.has(rawCategory) || slugOk(rawCategory)
      ? rawCategory || "bilgisayar"
      : "bilgisayar";
  const price = Math.max(0, Number(p.price) || 0);
  const legacyImage = normalizeImageUrl(p.image);
  const images = (Array.isArray(p.images) ? p.images : [])
    .map((value) => normalizeImageUrl(value))
    .filter(Boolean)
    .slice(0, MAX_PRODUCT_IMAGES);
  if (legacyImage && !images.includes(legacyImage)) images.unshift(legacyImage);
  const tree = CATEGORY_FEED_DEFAULTS[category] || CATEGORY_FEED_DEFAULTS.bilgisayar;
  const stockQty = Number(p.stockQty);
  return {
    id,
    brand: String(p.brand || "").trim().toUpperCase().slice(0, 40),
    name: String(p.name || "").trim().slice(0, 120),
    price,
    category,
    description: String(p.description || "").trim().slice(0, 280),
    details: String(p.details || "").trim().slice(0, 4000),
    image: images[0] || "",
    images: images.slice(0, MAX_PRODUCT_IMAGES),
    featured: Boolean(p.featured),
    active: p.active !== false,
    manufacturerCode: String(p.manufacturerCode || "").trim().slice(0, 80),
    barcode: String(p.barcode || "").trim().slice(0, 40),
    gtipCode: String(p.gtipCode || "").trim().slice(0, 40),
    specialCode: String(p.specialCode || "").trim().slice(0, 40),
    mainCategory: String(p.mainCategory || tree.mainCategory).trim().slice(0, 80),
    midCategory: String(p.midCategory || tree.midCategory).trim().slice(0, 80),
    subCategory: String(p.subCategory || tree.subCategory).trim().slice(0, 80),
    stockQty: Number.isFinite(stockQty) ? Math.max(0, Math.floor(stockQty)) : 0,
    vatPercent: normalizeVatPercent(p.vatPercent),
    currency: String(p.currency || "TRY").trim().toUpperCase().slice(0, 8) || "TRY",
    unit: String(p.unit || "ADET").trim().toUpperCase().slice(0, 20) || "ADET",
    siteParent: siteParent || undefined,
    siteMid: siteMid || undefined,
    siteChild: siteChild || undefined,
    urlSlug: String(p.urlSlug || "").trim().slice(0, 120) || undefined,
    urlCategorySegment: String(p.urlCategorySegment || "").trim().slice(0, 40) || undefined,
  };
}

const storefrontCatalogMemo = { active: null, all: null };
const soldOutCatalogMemo = { index: null };
let akakceXmlMemo = null;
let akakceFeedSummaryMemo = { products: null, summary: null };
const CATALOG_BOOTSTRAP_LIMIT = 20;
const CATALOG_BOOTSTRAP_DIR = path.join(DATA_ROOT, ".runtime", "catalog-bootstrap");
const STARTUP_WARM_DEFER_MS = 45000;
// nginx includes these exact-match locations and 301s pre-fix product URLs without reaching Node.
const LEGACY_REDIRECT_CONF_FILE = path.join(DATA_ROOT, ".runtime", "nginx", "legacy-product-redirects.conf");

function legacyRedirectConfPresent() {
  try {
    return fs.statSync(LEGACY_REDIRECT_CONF_FILE).size > 0;
  } catch (_) {
    return false;
  }
}

function writeLegacyRedirectConf(routeIndex) {
  if (!routeIndex || !routeIndex.byId || !Object.keys(routeIndex.byId).length) return;
  const text = legacyRedirectNginxText(routeIndex);
  try {
    if (fs.readFileSync(LEGACY_REDIRECT_CONF_FILE, "utf8") === text) return;
  } catch (_) {}
  fs.mkdirSync(path.dirname(LEGACY_REDIRECT_CONF_FILE), { recursive: true });
  const tmp = LEGACY_REDIRECT_CONF_FILE + ".part";
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, LEGACY_REDIRECT_CONF_FILE);
}

function clearCatalogBootstrapSnapshots() {
  try {
    if (!fs.existsSync(CATALOG_BOOTSTRAP_DIR)) return;
    const keep = new Set(["categories.json", "all.json", "home-featured.json"]);
    for (const name of fs.readdirSync(CATALOG_BOOTSTRAP_DIR)) {
      if (!name.endsWith(".json")) continue;
      if (keep.has(name)) continue;
      fs.unlinkSync(path.join(CATALOG_BOOTSTRAP_DIR, name));
    }
  } catch (_) {}
}

function invalidateStorefrontCatalog() {
  akakceFeedSummaryMemo = { products: null, summary: null };
  storefrontCatalogMemo.active = null;
  storefrontCatalogMemo.all = null;
  soldOutCatalogMemo.index = null;
  akakceXmlMemo = null;
  if (warmCatalogTimer) {
    clearTimeout(warmCatalogTimer);
    warmCatalogTimer = null;
  }
  // nginx serves /listing/categories.json straight from disk with no Node fallback,
  // so the file must be replaced atomically, never deleted.
  try {
    writeCategoriesBootstrapSnapshot();
  } catch (_) {}
}

function catalogImageContext() {
  const mirrorIndex = loadMirrorIndex(DATA_ROOT);
  return {
    mirrorIndex,
    siteBaseUrl: SITE_BASE_URL,
    dataRoot: DATA_ROOT,
    placeholderMirrorFiles: getCachedPlaceholderMirrorFileSet(DATA_ROOT, mirrorIndex),
    priceReference: priceReferenceFor,
  };
}

function readHomeFeaturedSnapshot() {
  const file = path.join(CATALOG_BOOTSTRAP_DIR, "home-featured.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isHomeFeaturedSnapshotValid(data)) {
      try {
        fs.unlinkSync(file);
      } catch (_) {}
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function mergedProducts(includeInactiveManual) {
  const key = includeInactiveManual ? "all" : "active";
  const hit = storefrontCatalogMemo[key];
  if (hit && Array.isArray(hit.products)) return hit.products;
  const products = mergeCatalogProducts(loadProducts(), supplierManager.listProducts(), {
    includeInactiveManual,
    normalizeProduct,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
    ...catalogImageContext(),
  });
  storefrontCatalogMemo[key] = { products, index: null };
  return products;
}

setPublicCategoryLeafKeysLoader(() => buildStorefrontLeafKeys(storefrontIndex(false)));

function storefrontIndex(includeInactiveManual) {
  const key = includeInactiveManual ? "all" : "active";
  const products = mergedProducts(includeInactiveManual);
  const memo = storefrontCatalogMemo[key];
  // compareAtPrice depends on the calendar day (30-day window), so the index is rebuilt daily.
  const day = new Date().toISOString().slice(0, 10);
  if (!memo.index || memo.day !== day) {
    if (!includeInactiveManual) recordPriceHistory(products);
    memo.index = buildStorefrontIndex(products, catalogImageContext());
    memo.day = day;
  }
  return memo.index;
}

function soldOutCatalogOptions() {
  return {
    soldOutOnly: true,
    normalizeProduct,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
    ...catalogImageContext(),
  };
}

/**
 * Published XML products that are out of stock (or unread for 7 days). Only the product page
 * ("Tükendi" + stock alert form, noindex), stock alerts and the admin panel use it; listings,
 * search, sitemap, Akakçe and checkout never see these products.
 */
function soldOutIndex() {
  if (soldOutCatalogMemo.index) return soldOutCatalogMemo.index;
  const products = mergeCatalogProducts([], supplierManager.listProducts(), soldOutCatalogOptions());
  const index = buildStorefrontIndex(products, catalogImageContext());
  index.compactById = new Map(index.compactAll.map((item) => [String(item.id), item]));
  soldOutCatalogMemo.index = index;
  return index;
}

function soldOutCompact(productId) {
  const id = String(productId || "");
  if (!id || storefrontIndex(false).routeIndex.byId[id]) return null;
  return soldOutIndex().compactById.get(id) || null;
}

function lookupSoldOutProductByPath(segment, slug) {
  const index = soldOutIndex();
  const productId = resolveProductIdFromRoute(index.routeIndex, segment, slug);
  if (!productId || !soldOutCompact(productId)) return null;
  const supplier = supplierManager.getProductById(productId);
  if (!supplier) return null;
  const result = queryPublicCatalog(
    mergeCatalogProducts([], [supplier], soldOutCatalogOptions()),
    { id: productId },
    catalogImageContext()
  );
  const product = Array.isArray(result.products) ? result.products[0] : null;
  if (!product) return null;
  return Object.assign(attachProductUrlFields(product, index.routeIndex), { soldOut: true });
}

function requestedCatalogIds(productId, idsRaw) {
  if (productId) return [productId];
  return String(idsRaw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function lookupPublicProductsByIds(productId, idsRaw) {
  const ids = requestedCatalogIds(productId, idsRaw);
  const idSet = new Set(ids);
  const manuals = loadProducts().filter((item) => item && idSet.has(item.id));
  const suppliers = ids.map((id) => supplierManager.getProductById(id)).filter(Boolean);
  const result = queryPublicCatalog(
    mergeCatalogProducts(manuals, suppliers, {
      includeInactiveManual: false,
      normalizeProduct,
      categoryDefaults: CATEGORY_FEED_DEFAULTS,
      ...catalogImageContext(),
    }),
    { id: productId, ids: idsRaw },
    catalogImageContext()
  );
  const routeIndex = storefrontIndex(false).routeIndex;
  if (routeIndex && Array.isArray(result.products)) {
    result.products = result.products.map((item) => attachProductUrlFields(item, routeIndex));
  }
  return result;
}

function lookupPublicProductsByPath(pathValue) {
  const parts = String(pathValue || "")
    .split("/")
    .filter(Boolean);
  if (parts.length !== 2) {
    return { products: [], total: 0, page: 1, limit: 1, totalPages: 0 };
  }
  const routeIndex = storefrontIndex(false).routeIndex;
  let productId = resolveProductIdFromRoute(routeIndex, parts[0], parts[1]);
  if (!productId) {
    const legacyPath = resolveLegacyProductPath(routeIndex, parts[0], parts[1]);
    const legacyParts = legacyPath.split("/").filter(Boolean);
    if (legacyParts.length === 2) {
      productId = resolveProductIdFromRoute(routeIndex, legacyParts[0], legacyParts[1]);
    }
  }
  if (!productId) {
    const soldOut = lookupSoldOutProductByPath(parts[0], parts[1]);
    return soldOut
      ? { products: [soldOut], total: 1, page: 1, limit: 1, totalPages: 1 }
      : { products: [], total: 0, page: 1, limit: 1, totalPages: 0 };
  }
  return lookupPublicProductsByIds(productId, "");
}

function resolveProductNamesByIds(ids) {
  const want = new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean));
  const names = {};
  if (!want.size) return names;
  loadProducts().forEach((product) => {
    if (product && want.has(product.id)) {
      names[product.id] = {
        name: product.name || product.id,
        brand: product.brand || "",
      };
    }
  });
  want.forEach((id) => {
    if (names[id]) return;
    const product = supplierManager.getProductById(id);
    if (product) {
      names[id] = {
        name: product.name || id,
        brand: product.brand || "",
      };
    }
  });
  return names;
}

let warmCatalogTimer = null;

function readCategoriesBootstrapSnapshot() {
  const file = path.join(CATALOG_BOOTSTRAP_DIR, "categories.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !Array.isArray(data.categories)) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function writeCategoriesBootstrapSnapshot(payload) {
  fs.mkdirSync(CATALOG_BOOTSTRAP_DIR, { recursive: true });
  const body = payload || {
    version: 5,
    categories: categoryStore.publicList(),
  };
  atomicWriteJson(path.join(CATALOG_BOOTSTRAP_DIR, "categories.json"), {
    version: body.version || 5,
    categories: Array.isArray(body.categories) ? body.categories : [],
  });
}

function ensureCategoriesBootstrapSnapshot() {
  const existing = readCategoriesBootstrapSnapshot();
  if (existing) return existing;
  const payload = {
    version: 5,
    categories: categoryStore.publicList(),
  };
  try {
    writeCategoriesBootstrapSnapshot(payload);
  } catch (_) {}
  return payload;
}

function bootstrapSnapshotsReady() {
  const allFile = path.join(CATALOG_BOOTSTRAP_DIR, "all.json");
  const catFile = path.join(CATALOG_BOOTSTRAP_DIR, "categories.json");
  try {
    if (!fs.existsSync(allFile) || fs.statSync(allFile).size <= 100) return false;
    if (!fs.existsSync(catFile)) return false;
    const cat = JSON.parse(fs.readFileSync(catFile, "utf8"));
    if (!cat || !Array.isArray(cat.categories)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function scheduleWarmStorefrontCatalog() {
  if (warmCatalogTimer) clearTimeout(warmCatalogTimer);
  warmCatalogTimer = setTimeout(() => {
    warmCatalogTimer = null;
    try {
      storefrontIndex(false);
      writeCatalogBootstrapSnapshots();
    } catch (_) {}
  }, 400);
  if (typeof warmCatalogTimer.unref === "function") warmCatalogTimer.unref();
}

function warmStorefrontCatalog() {
  scheduleWarmStorefrontCatalog();
}

function scheduleStartupCatalogWarm() {
  const timer = setTimeout(() => {
    try {
      if (bootstrapSnapshotsReady() && legacyRedirectConfPresent()) return;
      warmStorefrontCatalog();
    } catch (_) {}
  }, STARTUP_WARM_DEFER_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function emptyListingSnapshotPayload() {
  return {
    products: [],
    total: 0,
    page: 1,
    limit: CATALOG_BOOTSTRAP_LIMIT,
    totalPages: 0,
    facets: null,
  };
}

function ensureListingTreeSnapshotFiles() {
  fs.mkdirSync(CATALOG_BOOTSTRAP_DIR, { recursive: true });
}

function writeCatalogBootstrapSnapshots() {
  const index = storefrontIndex(false);
  fs.mkdirSync(CATALOG_BOOTSTRAP_DIR, { recursive: true });
  try {
    writeLegacyRedirectConf(index.routeIndex);
  } catch (err) {
    console.warn("Eski ürün yönlendirme dosyası yazılamadı:", err.message || err);
  }
  try {
    const featured = homeFeaturedCatalog(mergedProducts(false), {
      popularity: popularProductScores(),
      minPriceInclVat: shippingSettingsStore.getSettings().minOrderAmount,
      limit: 12,
    }, { routeIndex: index.routeIndex, ...catalogImageContext() });
    atomicWriteJson(path.join(CATALOG_BOOTSTRAP_DIR, "home-featured.json"), {
      products: featured.products,
      byParent: featured.byParent,
      perCategory: featured.perCategory,
      parents: featured.parents,
      total: featured.products.length,
      page: 1,
      limit: featured.perCategory,
      totalPages: 1,
    });
  } catch (_) {}
  const jobs = listingSnapshotJobs(index, categoryStore.publicList());
  const writeJob = (job) => {
    const payload = queryPublicCatalogIndexed(
      index,
      Object.assign({ page: 1, limit: CATALOG_BOOTSTRAP_LIMIT }, job.params)
    );
    const products = enrichCatalogSnapshotProducts(
      { products: payload.products },
      index.routeIndex
    ).products;
    atomicWriteJson(path.join(CATALOG_BOOTSTRAP_DIR, job.file), {
      products,
      total: payload.total,
      page: payload.page,
      limit: payload.limit,
      totalPages: payload.totalPages,
      facets: payload.facets || null,
    });
  };
  writeJob(jobs[0]);
  let offset = 1;
  try {
    writeCategoriesBootstrapSnapshot();
  } catch (_) {}
  const runChunk = () => {
    const end = Math.min(offset + 12, jobs.length);
    for (; offset < end; offset += 1) writeJob(jobs[offset]);
    if (offset < jobs.length) setImmediate(runChunk);
  };
  runChunk();
}

function akakceMirrorIndexStamp() {
  const { indexFile } = mirrorPaths(DATA_ROOT);
  try {
    return fs.statSync(indexFile).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function akakceShippingOptions() {
  return { shippingSettings: shippingSettingsStore.getSettings() };
}

function storefrontAkakceXml() {
  const products = mergedProducts(false);
  const mirrorIndex = loadMirrorIndex(DATA_ROOT);
  const mirrorStamp = akakceMirrorIndexStamp();
  const shippingStamp = JSON.stringify(shippingSettingsStore.getSettings());
  if (
    akakceXmlMemo &&
    akakceXmlMemo.products === products &&
    akakceXmlMemo.mirrorStamp === mirrorStamp &&
    akakceXmlMemo.shippingStamp === shippingStamp
  ) {
    return akakceXmlMemo.xml;
  }
  const xml = buildAkakceXml(products, {
    siteBaseUrl: SITE_BASE_URL,
    mirrorIndex,
    ...akakceShippingOptions(),
  });
  akakceXmlMemo = { products, mirrorStamp, shippingStamp, xml };
  return xml;
}

let storefrontSitemapMemo = null;

function storefrontSitemapXml() {
  const categories = categoryStore.list().filter((row) => row && row.active !== false);
  // Avoid cold-start stall: use warm storefront index only; otherwise categories-only.
  const warm = storefrontCatalogMemo.active && storefrontCatalogMemo.active.index;
  const routeIndex = warm && warm.routeIndex ? warm.routeIndex : { byId: {} };
  const productCount = routeIndex.byId ? Object.keys(routeIndex.byId).length : 0;
  const stamp = categories.length + ":" + productCount;
  if (storefrontSitemapMemo && storefrontSitemapMemo.stamp === stamp && storefrontSitemapMemo.index === warm) {
    return storefrontSitemapMemo.xml;
  }
  const xml = buildStorefrontSitemap({
    baseUrl: SITE_BASE_URL || "https://patygoteknoloji.com",
    categories,
    routeIndex,
    products: warm && Array.isArray(warm.compactAll) ? warm.compactAll : [],
  });
  storefrontSitemapMemo = { stamp, xml, index: warm };
  return xml;
}

let akakceMirrorTimer = null;
let akakceMirrorRunning = false;
let thumbnailTimer = null;
let thumbnailRunning = false;
let thumbnailRerun = false;
let eventLoopLagMs = 0;

/** Card previews for mirrored images; storefront snapshots are rebuilt once new previews exist. */
function scheduleThumbnailBackfill(delayMs) {
  if (thumbnailTimer) clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(() => {
    thumbnailTimer = null;
    if (thumbnailRunning) {
      thumbnailRerun = true;
      return;
    }
    thumbnailRunning = true;
    const startedAt = Date.now();
    generateMissingThumbnails(DATA_ROOT, loadMirrorIndex(DATA_ROOT), {
      logError: (file, detail) => console.warn("Küçük görsel üretilemedi", file, detail),
    })
      .then((result) => {
        if (result.unavailable) {
          console.warn("Küçük görsel atlandı: sharp yüklü değil");
          return;
        }
        if (result.created > 0) {
          invalidateStorefrontCatalog();
          warmStorefrontCatalog();
        }
        if (result.created || result.failed) {
          console.log("Küçük görsel:", result.created, "yeni,", result.failed, "hata,", Date.now() - startedAt, "ms");
        }
      })
      .catch((err) => console.warn("Küçük görsel atlandı:", err.message || err))
      .finally(() => {
        thumbnailRunning = false;
        if (thumbnailRerun) {
          thumbnailRerun = false;
          scheduleThumbnailBackfill(5000);
        }
      });
  }, Math.max(0, Number(delayMs) || 0));
  if (typeof thumbnailTimer.unref === "function") thumbnailTimer.unref();
}

const eventLoopProbeTimer = setInterval(() => {
  const started = Date.now();
  setImmediate(() => {
    eventLoopLagMs = Date.now() - started;
  });
}, 2000);
if (typeof eventLoopProbeTimer.unref === "function") eventLoopProbeTimer.unref();

function isEventLoopBusy(thresholdMs) {
  return eventLoopLagMs > (Number(thresholdMs) || 150);
}

function mirrorIndexIsFresh(maxAgeMs) {
  const { indexFile } = mirrorPaths(DATA_ROOT);
  try {
    if (!fs.existsSync(indexFile)) return false;
    return Date.now() - fs.statSync(indexFile).mtimeMs < (Number(maxAgeMs) || 6 * 60 * 60 * 1000);
  } catch (_) {
    return false;
  }
}

function scheduleAkakceImageMirror(options) {
  const settings = options || {};
  const delayMs = Number.isFinite(Number(settings.delayMs))
    ? Math.max(0, Number(settings.delayMs))
    : 30000;
  if (settings.skipIfRecent && mirrorIndexIsFresh(settings.freshMs || 6 * 60 * 60 * 1000)) {
    return;
  }
  if (akakceMirrorTimer) clearTimeout(akakceMirrorTimer);
  akakceMirrorTimer = setTimeout(() => {
    akakceMirrorTimer = null;
    if (akakceMirrorRunning) return;
    if (isEventLoopBusy(200)) {
      scheduleAkakceImageMirror({ delayMs: 60000 });
      return;
    }
    akakceMirrorRunning = true;
    setImmediate(() => {
      const run = (list) =>
        mirrorAkakceCatalogImages(list, {
          dataRoot: DATA_ROOT,
          siteBaseUrl: SITE_BASE_URL,
          logError: (message, source, detail) =>
            console.warn("Akakçe görsel aynası", source, detail || message),
        })
          .then((result) => {
            if (result && Number(result.mirrored) > 0) {
              invalidateStorefrontCatalog();
            }
            scheduleThumbnailBackfill(5000);
          })
          .catch((err) => {
            console.warn("Akakçe görsel aynası atlandı:", err.message || err);
          })
          .finally(() => {
            akakceMirrorRunning = false;
          });
      // Avoid a sync supplier hydrate on a busy loop; retry later.
      if (isEventLoopBusy(100)) {
        akakceMirrorRunning = false;
        scheduleAkakceImageMirror({ delayMs: 90000 });
        return;
      }
      try {
        // Not mergedProducts(): it already drops rows without a mirrored image, so new XML
        // products would never be mirrored and never reach the storefront.
        run(supplierStorefrontCandidates(supplierManager.listProducts()));
      } catch (err) {
        akakceMirrorRunning = false;
        console.warn("Akakçe görsel aynası atlandı:", err.message || err);
      }
    });
  }, delayMs);
  if (typeof akakceMirrorTimer.unref === "function") akakceMirrorTimer.unref();
}

const POPULAR_SCORES_TTL_MS = 60 * 1000;
let popularScoresMemo = { at: 0, scores: null };

function popularProductScores() {
  const now = Date.now();
  if (popularScoresMemo.scores && now - popularScoresMemo.at < POPULAR_SCORES_TTL_MS) {
    return popularScoresMemo.scores;
  }
  const scores = {};
  try {
    const views = analyticsStore.productViewCounts(90) || {};
    Object.keys(views).forEach((id) => {
      scores[id] = (Number(scores[id]) || 0) + (Number(views[id]) || 0);
    });
  } catch (_) {}
  try {
    const sold = orderStore.soldQuantities(90) || {};
    Object.keys(sold).forEach((id) => {
      scores[id] = (Number(scores[id]) || 0) + (Number(sold[id]) || 0) * 100;
    });
  } catch (_) {}
  popularScoresMemo = { at: now, scores };
  return scores;
}

function syncLiveXmlCategoriesAsync(slotId) {
  return syncXmlSiteCategoriesAsync({
    manager: supplierManager,
    categoryStore,
    slotId: slotId || "supplier-1",
    activate: false,
  }).catch((err) => {
    console.warn(
      "XML kategori senkronu atlandı:",
      slotId || "supplier-1",
      err && err.message ? err.message : err
    );
    return null;
  });
}

let xmlCategorySyncQueue = Promise.resolve();
function enqueueXmlCategorySync(slotId) {
  xmlCategorySyncQueue = xmlCategorySyncQueue
    .then(() => {
      if (slotId) return syncLiveXmlCategoriesAsync(slotId);
      return supplierManager
        .listSlots()
        .filter((slot) => slot.configured)
        .reduce(
          (prev, slot) => prev.then(() => syncLiveXmlCategoriesAsync(slot.id)),
          Promise.resolve()
        );
    })
    .then((result) => {
      invalidateStorefrontCatalog();
      warmStorefrontCatalog();
      return result;
    })
    .catch(() => null);
  return xmlCategorySyncQueue;
}

function enrichSupplierProducts(products, categories) {
  return (products || []).map((product) => {
    const feedIssues = analyzeSupplierFeedIssues(product, { siteBaseUrl: SITE_BASE_URL, categories });
    return Object.assign({}, product, {
      feedIssues,
      feedReady: feedIssues.length === 0,
    });
  });
}

function akakceFeedPublicMeta() {
  return {
    path: "/api/feeds/akakce.xml",
    publicUrl: SITE_BASE_URL.replace(/\/+$/, "") + "/api/feeds/akakce.xml",
    format: "Akakce v1.3",
  };
}

function akakceFeedFullSummary() {
  const products = mergedProducts(false);
  if (akakceFeedSummaryMemo.summary && akakceFeedSummaryMemo.products === products) {
    return akakceFeedSummaryMemo.summary;
  }
  const summary = buildAkakceFeedSummary(products, {
    siteBaseUrl: SITE_BASE_URL,
    mirrorIndex: loadMirrorIndex(DATA_ROOT),
    ...akakceShippingOptions(),
  });
  akakceFeedSummaryMemo = { products, summary };
  return summary;
}

function scheduleAkakceFeedSummaryWarm() {
  setImmediate(() => {
    try {
      akakceFeedFullSummary();
    } catch (_) {}
  });
}

function manualCatalogCounts() {
  const list = loadProducts();
  return {
    manualCount: list.length,
    manualActiveCount: list.filter((item) => item && item.active !== false).length,
  };
}

function resolveAdminSession(req) {
  if (Object.prototype.hasOwnProperty.call(req, "_adminSessionResolved")) {
    return req._adminSession;
  }
  req._adminSessionResolved = true;
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) {
    req._adminSession = null;
    return null;
  }
  req._adminSession = adminSessionStore.get(token);
  return req._adminSession;
}

function getSession(req) {
  return resolveAdminSession(req);
}

function authOk(req) {
  return Boolean(resolveAdminSession(req));
}

function sessionUser(req) {
  const session = getSession(req);
  if (!session || !session.userId) return null;
  return adminUserStore.publicUser(adminUserStore.get(session.userId));
}

function sessionRole(req) {
  const session = getSession(req);
  if (!session) return null;
  if (!session.userId) return "owner";
  const user = adminUserStore.get(session.userId);
  return user && user.role ? user.role : "admin";
}

function requireOwner(req, res) {
  if (sessionRole(req) !== "owner") {
    json(res, 403, { ok: false, error: "Bu işlem için owner yetkisi gerekli." });
    return false;
  }
  return true;
}

function reversalReasonMessage(reason) {
  const map = {
    order_missing: "Sipariş bulunamadı.",
    not_paid: "Yalnızca ödemesi alınmış siparişlerde banka iadesi yapılabilir.",
    missing_bank_success_evidence: "Banka başarı kanıtı (VPS-0000) olmadan iade yapılamaz.",
    already_reversed: "Bu siparişin tutarı zaten iade edilmiş.",
    shipped_use_refund_not_void: "Kargoya verilmiş siparişte void yerine iade (refund) kullanın.",
    invalid_amount: "Geçersiz iade tutarı.",
    amount_exceeds_remaining: "İade tutarı kalan tutarı aşıyor.",
    customer_email_required:
      "Müşteri e-posta adresi zorunlu (Akbank iade API). Siparişte e-posta yok.",
    void_only_same_day: "Void yalnızca ödeme günü (İstanbul) içinde yapılabilir.",
    void_requires_full_amount: "Void yalnızca kalan tutarın tamamı için uygulanır.",
    reversal_pending_inquiry:
      "Önceki banka işleminin sonucu bilinmiyor. Çift iadeyi önlemek için önce “Bankadan sorgula” ile sonucu netleştirin.",
    cancel_requires_unshipped:
      "Kargoya verilmiş siparişte iptal yerine ürün bazlı iade yapın.",
    cancel_after_partial_refund:
      "Bu siparişte kısmi iade yapılmış; kalan tutar için ürün bazlı iadeyi kullanın.",
    invalid_item: "Geçersiz sipariş kalemi.",
    item_qty_exceeds_remaining: "Seçilen adet, iade edilmemiş adetten fazla.",
    no_items_selected: "İade için en az bir ürün adedi veya kargo ücreti seçin.",
  };
  return map[String(reason || "")] || "Banka iadesi/iptali şu an yapılamaz.";
}

async function notifyOwner(mail, label) {
  try {
    await deliverSimpleMail(mail);
    return { sent: true };
  } catch (err) {
    console.error(label + " mail failed:", err.message);
    return { sent: false, reason: err.message === SMTP_NOT_CONFIGURED ? "smtp_not_configured" : "send_failed" };
  }
}

function notifyReversalProblem(input) {
  return notifyOwner(buildReversalAlertMail(Object.assign({ siteBase: SITE_BASE_URL }, input)), "bank reversal alert");
}

async function followUpInvoiceAfterReversal(orderId, event, fully) {
  let invoice;
  try {
    let issuedCheckError = "";
    if (event && event.type === "void" && fully && bizimhesapConfigured(process.env)) {
      const issued = await syncIssuedInvoiceNumber(orderId, { source: "reversal" });
      if (issued.reason === "api_error") issuedCheckError = "Fatura durumu okunamadı: " + issued.error;
    }
    invoice = await reconcileInvoiceAfterReversal({ store: orderStore, orderId, event, fully, issuedCheckError });
  } catch (err) {
    console.error("invoice follow-up failed:", err.message);
    return { action: "error", error: err.message };
  }
  if (
    invoice.action === "cancel_failed" ||
    invoice.action === "needs_return_document" ||
    invoice.action === "issued_cancel_required"
  ) {
    invoice.alertMail = await notifyOwner(
      buildInvoiceFollowupMail(Object.assign({ orderId, siteBase: SITE_BASE_URL }, invoice)),
      "invoice follow-up"
    );
  }
  return invoice;
}

/** Ödenen siparişi BizimHesap'a satış faturası taslağı olarak aktarır; müşteriye mail atmaz. */
async function transferOrderToBizimHesap(orderId, source, actorId) {
  if (!bizimhesapConfigured(process.env)) return { submitted: false, reason: "not_configured" };
  const order = orderStore.get(orderId);
  const allow = orderAllowsBizimHesapInvoice(order);
  if (!allow.ok) return { submitted: false, reason: allow.reason };
  try {
    const result = await submitSalesInvoice(order, { store: orderStore });
    if (result.submitted) {
      auditStore.record({
        actorType: actorId ? "admin_user" : "system",
        actorId: actorId || null,
        action: "order.bizimhesap_transferred",
        entityType: "order",
        entityId: orderId,
        detail: { source, guid: result.guid || null },
      });
    }
    return result;
  } catch (err) {
    const error = String((err && err.message) || err).slice(0, 300);
    console.error("bizimhesap transfer failed:", error);
    const alertMail = await notifyOwner(
      buildInvoiceFollowupMail({ orderId, action: "transfer_failed", error, siteBase: SITE_BASE_URL }),
      "bizimhesap transfer"
    );
    return { submitted: false, reason: "api_error", error, alertMail };
  }
}

/** Order-list summary of the BizimHesap invoice; null when the order was never transferred. */
function invoiceSummaryFor(orderId) {
  const current = orderStore.getIntegration(orderId, "bizimhesap_invoice");
  if (!(current && current.guid)) return null;
  const payload = current.payload || {};
  return {
    invoiceNo: payload.invoiceNo || null,
    checkedAt: payload.invoiceCheckedAt || null,
    cancelled: Boolean(payload.cancel && payload.cancel.ok),
  };
}

/** Paid before the first BizimHesap transfer, so the panel never tracked this order's invoice. */
function invoiceUntrackedFor(order, transferred, trackedSince) {
  return !transferred && Boolean(trackedSince) && String(order.paidAt || order.createdAt || "") < trackedSince;
}

/** Reads the issued GİB number from BizimHesap and stores it on the order's invoice integration. */
async function syncIssuedInvoiceNumber(orderId, options) {
  const opts = options || {};
  const current = orderStore.getIntegration(orderId, "bizimhesap_invoice");
  if (!(current && current.guid)) return { found: false, reason: "not_transferred" };
  if (current.payload && current.payload.invoiceNo) {
    return { found: true, invoiceNo: current.payload.invoiceNo, already: true };
  }
  const order = orderStore.get(orderId);
  if (!order) return { found: false, reason: "order_not_found" };
  let result;
  try {
    if (opts.listError) throw new Error(opts.listError);
    result = await findIssuedInvoiceNumber(order, { customers: opts.customers });
  } catch (err) {
    result = { found: false, reason: "api_error", error: String((err && err.message) || err).slice(0, 200) };
  }
  const checkedAt = new Date().toISOString();
  const payload = Object.assign({}, current.payload, { guid: current.guid, url: current.url, invoiceCheckedAt: checkedAt });
  delete payload.invoiceCheckError;
  if (result.found) {
    payload.invoiceNo = result.invoiceNo;
    payload.invoiceDate = result.date || "";
    payload.invoiceFoundAt = checkedAt;
  } else if (result.reason === "api_error") {
    payload.invoiceCheckError = result.error;
  }
  orderStore.saveIntegrationRef(orderId, "bizimhesap_invoice", payload);
  if (result.found) {
    auditStore.record({
      actorType: opts.actorId ? "admin_user" : "system",
      actorId: opts.actorId || null,
      action: "order.invoice_number_synced",
      entityType: "order",
      entityId: orderId,
      detail: { invoiceNo: result.invoiceNo, source: opts.source || "panel" },
    });
  }
  return result;
}

const INVOICE_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const INVOICE_SYNC_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;
let invoiceSyncRunning = false;

async function syncPendingInvoiceNumbers() {
  if (invoiceSyncRunning || !bizimhesapConfigured(process.env)) return;
  invoiceSyncRunning = true;
  try {
    const since = new Date(Date.now() - INVOICE_SYNC_LOOKBACK_MS).toISOString();
    const pending = orderStore.listIntegrationOrderIds("bizimhesap_invoice", { since, limit: 200 }).filter((id) => {
      const payload = (orderStore.getIntegration(id, "bizimhesap_invoice") || {}).payload || {};
      return !payload.invoiceNo && !(payload.cancel && payload.cancel.ok);
    });
    if (!pending.length) return;
    let customers = null;
    let listError = "";
    try {
      customers = await listBizimHesapCustomers();
    } catch (err) {
      listError = String((err && err.message) || err);
    }
    for (const id of pending) {
      await syncIssuedInvoiceNumber(id, { customers, listError, source: "scheduler" });
    }
  } catch (err) {
    console.error("bizimhesap invoice sync failed:", String((err && err.message) || err).slice(0, 200));
  } finally {
    invoiceSyncRunning = false;
  }
}

/** Closes the open invoice follow-up; with onlyReturns, only when an unresolved return is waiting for a document. */
function markInvoiceFollowupResolved(orderId, options) {
  const current = orderStore.getIntegration(orderId, "bizimhesap_invoice");
  if (!(current && current.guid)) return null;
  const payload = current.payload || {};
  if (options && options.onlyReturns) {
    const since = String(payload.resolvedAt || "");
    const open = (Array.isArray(payload.returns) ? payload.returns : []).some(
      (row) => row && (!since || String(row.eventAt || "") > since)
    );
    if (!open) return null;
  }
  const resolvedAt = new Date().toISOString();
  orderStore.saveIntegrationRef(
    orderId,
    "bizimhesap_invoice",
    Object.assign({}, payload, { guid: current.guid, url: current.url, resolvedAt })
  );
  return resolvedAt;
}

/** Başarılı banka iadesi/iptali sonrası: tam iadede kupon hakkı geri, müşteriye doğru mail, fatura takibi. */
async function afterSuccessfulReversal(before, updated, event) {
  const fully = Boolean(updated && updated.paymentStatus === "refunded");
  let couponReleased = false;
  if (fully && before && before.coupon && couponStore) {
    couponReleased = couponStore.release(before.id);
  }
  const wasShipped = Boolean(before && (before.status === "shipped" || before.status === "delivered"));
  let mailResult = null;
  try {
    if (fully) {
      mailResult = await sendOrderStatusMail(updated, "refunded", {
        store: orderStore,
        extra: {
          refund: {
            amount: formatAmount(sumReversedAmount(updated)),
            method: event.type === "void" ? "void" : wasShipped ? "return" : "refund",
          },
        },
      });
    } else {
      mailResult = await sendOrderStatusMail(updated, "partial_refund", {
        store: orderStore,
        claimKey: "partial_refund:" + event.at,
        extra: { refund: { amount: event.amount, method: "refund" } },
      });
    }
  } catch (err) {
    console.error("order refund mail failed:", err.message);
  }
  const invoice = await followUpInvoiceAfterReversal(updated && updated.id, event, fully);
  return {
    fully,
    couponReleased,
    mailSent: Boolean(mailResult && mailResult.sent),
    mailReason: mailResult && !mailResult.sent ? mailResult.reason || null : null,
    invoice,
  };
}

/**
 * Akbank işlem sorgulama (1010) ile yerel kaydı eşitler. Satış kaydı bankada görünmüyorsa
 * cevap güvenilir sayılmaz; belirsiz işlem çözülmüş sayılmaz (çift iade riski).
 */
async function reconcileOrderWithBank(orderId, actorId) {
  const order = orderStore.get(orderId);
  if (!order) return { ok: false, status: 404, error: "Sipariş bulunamadı" };
  const inquiry = await queryOrderTransactions(akbankConfig, orderId);
  if (!inquiry.ok) {
    return {
      ok: false,
      status: 502,
      error: inquiry.unknown
        ? "Bankaya ulaşılamadı; birkaç dakika sonra tekrar sorgulayın."
        : inquiry.responseMessage || "İşlem sorgulama başarısız.",
      responseCode: inquiry.responseCode || null,
    };
  }
  const summary = summarizeInquiry(inquiry.transactions, order.total);
  let decision = reconcileFromInquiry(order, summary);
  if (!summary.saleFound && decision.kind !== "record_success") decision = { kind: "inconclusive" };
  let updated = order;
  let follow = null;
  if (decision.kind === "record_success") {
    const event = buildReversalEvent({
      type: decision.type,
      amount: decision.amount,
      success: true,
      dryRun: false,
      response: { responseCode: "VPS-0000", responseMessage: "İşlem sorgulama ile doğrulandı" },
      source: "inquiry",
      mode: decision.mode,
      items: decision.items,
      shippingRefunded: decision.shippingRefunded,
      actorId,
    });
    updated = orderStore.recordBankReversal(orderId, { event, success: true, dryRun: false });
    follow = await afterSuccessfulReversal(order, updated, event);
  } else if (decision.kind === "resolve_not_performed") {
    const event = buildReversalEvent({
      type: "inquiry",
      amount: 0,
      success: false,
      dryRun: false,
      response: { responseMessage: "Bankada bu siparişe ait yeni iade/iptal kaydı yok" },
      source: "inquiry",
      actorId,
    });
    updated = orderStore.recordBankReversal(orderId, { event, success: false, dryRun: false });
  }
  auditStore.record({
    actorType: "admin_user",
    actorId,
    action: "order.bank_inquiry",
    entityType: "order",
    entityId: orderId,
    detail: {
      decision: decision.kind,
      summary,
      transactions: inquiry.transactions.map((tx) => ({
        txnCode: tx.txnCode,
        txnStatus: tx.txnStatus,
        responseCode: tx.responseCode,
        amount: tx.amount,
      })),
    },
  });
  return { ok: true, decision: decision.kind, summary, transactions: inquiry.transactions, order: updated, follow };
}

function passwordChangeBlocksAdmin(req, res, pathName) {
  const session = getSession(req);
  if (!session || !session.mustChangePassword) return false;
  const allowed = new Set([
    "/api/admin/me",
    "/api/admin/logout",
    "/api/admin/change-password",
  ]);
  if (allowed.has(pathName)) return false;
  json(res, 403, {
    ok: false,
    error: "Devam etmeden önce panel şifrenizi güncelleyin.",
    mustChangePassword: true,
    minPasswordLength: MIN_ADMIN_PASSWORD_LENGTH,
  });
  return true;
}

function sessionMustChangePassword(session) {
  if (!session) return false;
  if (session.userId) return false;
  if (session.mustChangePassword === false) return false;
  if (session.mustChangePassword === true) return true;
  return adminSecurityStore.shouldForcePasswordChange(getAdminPassword());
}

function syncSingleOwnerPassword(newPassword) {
  const owners = adminUserStore.list().filter((item) => item.role === "owner" && item.active !== false);
  if (owners.length !== 1) return;
  adminUserStore.update(owners[0].id, { password: newPassword });
}

async function sendCalendarReminderMail(entry, kind) {
  const to = String((entry && entry.notifyEmail) || "").trim();
  if (!to) throw new Error("Hatırlatıcı e-posta adresi yok.");
  const when = (entry && entry.time) || "09:00";
  const isCreate = kind === "created";
  await deliverSimpleMail({
    to,
    subject: (isCreate ? "Takvim kaydı: " : "Takvim hatırlatıcı: ") + entry.title,
    text: [
      isCreate
        ? "Patygo Yönetim Paneli — Yeni hatırlatıcı oluşturuldu"
        : "Patygo Yönetim Paneli — Takvim hatırlatıcısı",
      "-------------------------------------------",
      "Başlık: " + entry.title,
      "Tarih: " + entry.date,
      "Saat: " + when + " (Europe/Istanbul)",
      entry.body ? "" : null,
      entry.body || null,
      "",
      "Panel: https://patygoteknoloji.com/admin",
    ]
      .filter((line) => line != null)
      .join("\n"),
  });
}

async function handleApi(req, res, urlPath) {
  if (req.method === "GET" && urlPath === "/api/payment/status") {
    return json(res, 200, Object.assign({}, publicPosStatus(akbankConfig), {
      bankReversal: publicBankReversalStatus(bankReversalConfig),
    }));
  }

  if (req.method === "GET" && urlPath === "/api/shipping") {
    return json(res, 200, shippingSettingsStore.getPublic());
  }

  if (req.method === "POST" && urlPath === "/api/price-alerts") {
    const ip = clientIp(req);
    if (rateLimited(priceAlertAttempts, ip, 6, 15 * 60 * 1000)) {
      return json(res, 429, { ok: false, error: "Çok fazla istek. Lütfen sonra tekrar deneyin." });
    }
    try {
      if (!priceAlertStore) return json(res, 503, { ok: false, error: "Fiyat alarmı şu anda kullanılamıyor." });
      const body = JSON.parse((await readBody(req, 8 * 1024)).toString("utf8") || "{}");
      const email = String(body.email || "").trim().slice(0, 160);
      if (!isValidEmail(email)) return json(res, 422, { ok: false, error: "Geçerli bir e-posta girin." });
      if (body.consent !== true) {
        return json(res, 422, { ok: false, error: "Bildirim almak için onay kutusunu işaretleyin." });
      }
      const kind = body.kind === "stock" ? "stock" : "price";
      const product = kind === "stock" ? soldOutAlertProduct(body.productId) : priceAlertProduct(body.productId);
      if (!product) {
        if (kind === "stock" && priceAlertProduct(body.productId)) {
          return json(res, 409, { ok: false, error: "Bu ürün şu anda stokta; sayfayı yenileyip sipariş verebilirsiniz." });
        }
        return json(res, 404, { ok: false, error: "Bu ürün şu anda satışta değil." });
      }
      if (!smtpConfigured(process.env)) {
        return json(res, 503, { ok: false, error: "E-posta bildirimi şu anda kullanılamıyor." });
      }
      const { alert, state } = priceAlertStore.subscribe({
        email,
        kind,
        productId: body.productId,
        productName: product.name,
        price: product.priceIncl,
      });
      if (state === "active") return json(res, 200, { ok: true, state: "active", kind });
      try {
        consentStore.record({
          subjectType: kind === "stock" ? "stock_alert" : "price_alert",
          subjectRef: String(alert.id),
          purpose: kind === "stock" ? "stock_alert_email" : "price_alert_email",
          policyVersion: "2026-10-08",
          evidence: { ip, email: alert.email, productId: alert.productId, kind, granted: true },
        });
      } catch (_) {}
      try {
        await deliverSimpleMail(
          buildPriceAlertReceivedMail(alert, { productPath: product.urlPath, productImage: product.image })
        );
      } catch (err) {
        priceAlertStore.unsubscribe(alert.token);
        throw new Error("Bilgilendirme e-postası gönderilemedi; lütfen biraz sonra tekrar deneyin.");
      }
      return json(res, 200, { ok: true, state: "created", kind });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Fiyat alarmı kurulamadı." });
    }
  }

  if (req.method === "GET" && (urlPath === "/api/price-alerts/confirm" || urlPath === "/api/price-alerts/unsubscribe")) {
    const requestUrl = new URL(req.url || urlPath, "http://localhost");
    const token = String(requestUrl.searchParams.get("token") || "").slice(0, 64);
    const confirming = urlPath.endsWith("/confirm");
    let alert = null;
    try {
      alert = priceAlertStore && token ? (confirming ? priceAlertStore.confirm(token) : priceAlertStore.unsubscribe(token)) : null;
    } catch (_) {}
    if (!alert) return redirectTo(res, SITE_BASE_URL + "/urunler?alarm=gecersiz");
    const product = alertProductInfo(alert.productId);
    const target = product && product.urlPath ? product.urlPath : "/urunler";
    return redirectTo(res, SITE_BASE_URL + target + "?alarm=" + (confirming ? "onay" : "iptal"));
  }

  if (req.method === "GET" && urlPath === "/api/reviews") {
    const requestUrl = new URL(req.url || urlPath, "http://localhost");
    const productId = String(requestUrl.searchParams.get("productId") || "").trim().slice(0, 80);
    if (!productId) return json(res, 400, { ok: false, error: "Ürün gerekli." });
    const data = reviewDataFor(productId);
    return json(
      res,
      200,
      {
        ok: true,
        summary: data ? data.summary : { count: 0, average: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } },
        reviews: data ? data.reviews : [],
      },
      { "Cache-Control": "public, max-age=60" }
    );
  }

  if (req.method === "GET" && urlPath === "/api/reviews/order") {
    const requestUrl = new URL(req.url || urlPath, "http://localhost");
    const orderId = String(requestUrl.searchParams.get("siparis") || "").slice(0, 64);
    const token = String(requestUrl.searchParams.get("token") || "").slice(0, 64);
    const order = orderId ? orderStore.get(orderId) : null;
    if (!order || !orderAccessOk(order, token)) {
      return json(res, 403, { ok: false, error: "Değerlendirme bağlantısı geçersiz." });
    }
    const eligible = reviewEligibility(order, null);
    if (!eligible.ok) return json(res, 409, { ok: false, error: eligible.error });
    const done = reviewStore ? reviewStore.forOrder(order.id) : {};
    const seen = new Set();
    const items = (order.items || [])
      .filter((item) => item.productId && !seen.has(item.productId) && seen.add(item.productId))
      .map((item) => {
        const live = priceAlertProduct(item.productId);
        return {
          productId: item.productId,
          name: itemDisplayName(item),
          urlPath: live ? live.urlPath : null,
          review: done[item.productId] || null,
        };
      });
    return json(res, 200, { ok: true, orderId: order.id, items });
  }

  if (req.method === "POST" && urlPath === "/api/reviews") {
    if (rateLimited(reviewAttempts, clientIp(req), 10, 15 * 60 * 1000)) {
      return json(res, 429, { ok: false, error: "Çok fazla istek. Lütfen sonra tekrar deneyin." });
    }
    try {
      if (!reviewStore) return json(res, 503, { ok: false, error: "Değerlendirme şu anda kullanılamıyor." });
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const order = body.orderId ? orderStore.get(String(body.orderId).slice(0, 64)) : null;
      if (!order || !orderAccessOk(order, String(body.token || "").slice(0, 64))) {
        return json(res, 403, { ok: false, error: "Değerlendirme bağlantısı geçersiz." });
      }
      const review = reviewStore.submit(order, String(body.productId || "").slice(0, 80), body);
      return json(res, 200, { ok: true, status: review.status });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Değerlendirme kaydedilemedi." });
    }
  }

  if (req.method === "POST" && urlPath === "/api/coupons/check") {
    if (rateLimited(couponCheckAttempts, clientIp(req), 20, 15 * 60 * 1000)) {
      return json(res, 429, { ok: false, error: "Çok fazla kupon denemesi. Lütfen sonra tekrar deneyin." });
    }
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const rawItems = Array.isArray(body.items) ? body.items : [];
      const { merchandiseTotal } = priceCheckoutItems(rawItems);
      const applied = resolveCheckoutCoupon(body.code, merchandiseTotal);
      if (!applied) return json(res, 422, { ok: false, error: "Kupon kodunu yazın." });
      return json(res, 200, {
        ok: true,
        code: applied.coupon.code,
        type: applied.coupon.type,
        value: applied.coupon.value,
        maxDiscount: applied.coupon.maxDiscount,
        minOrder: applied.coupon.minOrder,
        discount: applied.discount,
        merchandiseTotal,
      });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Kupon uygulanamadı." });
    }
  }

  if (req.method === "GET" && urlPath === "/api/installments") {
    return json(res, 200, Object.assign({ posReady: akbankConfig.enabled }, installmentSettingsStore.getPublic()));
  }

  if (req.method === "POST" && urlPath === "/api/contact") {
    try {
      const ip = clientIp(req);
      if (rateLimited(contactAttempts, ip, 8, 15 * 60 * 1000)) {
        return json(res, 429, {
          ok: false,
          error: "Çok fazla istek. Lütfen daha sonra tekrar deneyin.",
        });
      }
      const body = JSON.parse((await readBody(req, 32 * 1024)).toString("utf8") || "{}");
      const data = normalizeContactPayload(body);
      const check = validateContactPayload(data);
      if (!check.ok) return json(res, 400, { ok: false, error: check.error });

      const lead = {
        id: "LEAD-" + Date.now().toString(36).toUpperCase(),
        createdAt: new Date().toISOString(),
        ip,
        firma: data.firma,
        vkn: data.vkn,
        email: data.email,
        tel: data.tel,
        konu: data.konu || "",
        urun: data.urun || "",
        kategori: data.kategori || "",
        mesaj: data.mesaj,
        spam: Boolean(check.spam),
      };
      contactStore.append(lead);

      try {
        consentStore.record({
          subjectType: "contact",
          subjectRef: lead.id,
          purpose: "kvkk_notice",
          policyVersion: "2026-08-03",
          evidence: { ip, email: data.email, granted: true },
        });
      } catch (_) {}

      if (check.spam) {
        return json(res, 200, { ok: true, delivered: false });
      }

      const delivery = await deliverContactMail(data);
      try {
        analyticsStore.record({ type: "lead_submitted" });
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        delivered: true,
      });
    } catch (err) {
      return json(res, 502, {
        ok: false,
        error:
          (err && err.message) ||
          "Talebiniz kaydedildi ancak e-posta iletilemedi. Lütfen info@patygoteknoloji.com adresine yazın.",
      });
    }
  }

  if (req.method === "POST" && urlPath === "/api/payment/start") {
    try {
      if (!akbankConfig.enabled) {
        return json(res, 503, {
          ok: false,
          error:
            "Sanal POS henüz yapılandırılmadı. .env içinde AKBANK_MERCHANT_SAFE_ID, AKBANK_TERMINAL_SAFE_ID ve AKBANK_SECRET_KEY tanımlayın.",
          pos: publicPosStatus(akbankConfig),
        });
      }
      const ip = clientIp(req);
      if (rateLimited(paymentStartAttempts, ip, 20, 15 * 60 * 1000)) {
        return json(res, 429, { ok: false, error: "Çok fazla ödeme denemesi. Lütfen sonra tekrar deneyin." });
      }
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const order = buildCheckoutOrder(body);
      orderStore.save(order);
      try {
        consentStore.record({
          subjectType: "checkout",
          subjectRef: order.id,
          purpose: "contracts_bundle",
          policyVersion: "2026-08-03",
          evidence: {
            onBilgilendirme: true,
            mesafeliSatis: true,
            iadeCayma: true,
            kvkk: true,
            ip,
          },
        });
        consentStore.record({
          subjectType: "checkout",
          subjectRef: order.id,
          purpose: "kvkk_notice",
          policyVersion: "2026-08-03",
          evidence: { ip, email: order.customer.email },
        });
      } catch (_) {}
      const callbackUrl = SITE_BASE_URL + "/api/payment/callback";
      const form = buildHostedPaymentForm(akbankConfig, {
        orderId: order.id,
        amount: order.total,
        currency: order.currency,
        installCount: order.installment ? order.installment.count : 1,
        okUrl: callbackUrl,
        failUrl: callbackUrl,
        emailAddress: order.customer.email,
        merchantData: order.id,
      });
      return json(res, 200, {
        ok: true,
        orderId: order.id,
        orderAccessToken: order.accessToken,
        amount: order.total,
        action: form.action,
        method: form.method,
        fields: form.fields,
        testMode: akbankConfig.testMode,
      });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Ödeme başlatılamadı." });
    }
  }

  if ((req.method === "POST" || req.method === "GET") && urlPath === "/api/payment/callback") {
    try {
      const payload =
        req.method === "GET"
          ? Object.fromEntries(new URL(req.url || urlPath, "http://localhost").searchParams.entries())
          : parseFormBody(await readBody(req, 256 * 1024));
      const orderId = String(payload.orderId || payload.merchantData || "").slice(0, 64);
      const order = orderId ? orderStore.get(orderId) : null;
      const hashOk = akbankConfig.enabled && verifyCallbackHash(payload, akbankConfig.secretKey);
      const amountOk =
        Boolean(order) &&
        payload.amount != null &&
        String(payload.amount).trim() !== "" &&
        formatAmount(payload.amount) === formatAmount(order.total);
      const success = isPaymentSuccess(payload);
      const alreadyPaid = Boolean(order && (order.paymentTaken || order.paymentStatus === "paid"));
      const decision = decidePaymentFromBank({
        hashOk,
        amountOk,
        success,
        alreadyPaid,
      });
      const sanitized = sanitizeBankCallbackPayload(payload);
      const event = Object.assign({}, sanitized, {
        hashOk,
        amountOk,
        at: new Date().toISOString(),
        method: req.method === "GET" ? "GET" : "POST",
      });

      // Yalnızca geçerli imza ile kayıt / durum güncellemesi (spam ve sahte cevap engeli).
      if (order && hashOk) {
        const beforePaid = alreadyPaid;
        orderStore.recordBankCallback(orderId, event, decision);
        const updated = orderStore.get(orderId);
        const nowPaid = Boolean(
          updated && (updated.paymentTaken || updated.paymentStatus === "paid")
        );
        if (nowPaid && !beforePaid) {
          if (couponStore && updated.coupon && updated.coupon.code) {
            try {
              couponStore.redeem(updated.id, updated.coupon.code);
            } catch (err) {
              console.error("[coupons] kullanım sayılamadı:", err && err.message);
            }
          }
          setImmediate(() => {
            sendOrderStatusMail(updated, "paid", { store: orderStore }).catch((err) => {
              console.error("order paid mail failed:", err.message);
            });
            transferOrderToBizimHesap(updated.id, "payment").catch((err) => {
              console.error("bizimhesap transfer failed:", err.message);
            });
          });
        }
      }

      const finalOrder = orderId ? orderStore.get(orderId) : null;
      const result =
        finalOrder && (finalOrder.paymentTaken || finalOrder.paymentStatus === "paid")
          ? "success"
          : "failed";
      const location =
        SITE_BASE_URL +
        "/odeme?payment=" +
        result +
        (orderId ? "&orderId=" + encodeURIComponent(orderId) : "");
      return htmlRedirect(res, location);
    } catch (_) {
      return htmlRedirect(res, SITE_BASE_URL + "/odeme?payment=failed");
    }
  }

  if (req.method === "GET" && urlPath === "/api/payment/order") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const orderId = String(requestUrl.searchParams.get("orderId") || "").slice(0, 64);
    const accessToken = String(requestUrl.searchParams.get("token") || "").slice(0, 64);
    const order = orderId ? orderStore.get(orderId) : null;
    if (!order) return json(res, 404, { ok: false, error: "Sipariş bulunamadı." });
    if (!orderAccessOk(order, accessToken)) {
      return json(res, 403, { ok: false, error: "Sipariş görüntüleme izni yok." });
    }
    const bank = order.bankResponse || null;
    const events = Array.isArray(order.paymentEvents) ? order.paymentEvents : [];
    return json(res, 200, {
      ok: true,
      order: {
        id: order.id,
        total: order.total,
        shippingFee: order.shippingFee || 0,
        installment: order.installment || null,
        coupon: order.coupon ? { code: order.coupon.code, discount: order.coupon.discount } : null,
        merchandiseTotal: order.merchandiseTotal || order.subtotal + order.vat,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
        paymentTaken: Boolean(order.paymentTaken),
        status: order.status,
        items: order.items,
        createdAt: order.createdAt,
        bankResponse: bank
          ? {
              responseCode: String(bank.responseCode || "").slice(0, 40),
              responseMessage: String(bank.responseMessage || "").slice(0, 200),
              authCode: bank.authCode ? String(bank.authCode).slice(0, 40) : null,
              hostRefNum: String(bank.hostRefNum || bank.hostRefNumber || "").slice(0, 64) || null,
              hostLogKey: bank.hostLogKey ? String(bank.hostLogKey).slice(0, 80) : null,
              rrn: bank.rrn ? String(bank.rrn).slice(0, 40) : null,
              amount: bank.amount ? String(bank.amount).slice(0, 24) : null,
              hashOk: Boolean(bank.hashOk),
              amountOk: bank.amountOk !== false,
              outcome: bank.outcome ? String(bank.outcome).slice(0, 64) : null,
              at: bank.at || null,
            }
          : null,
        paymentEventCount: events.length,
        deliveryArea:
          [order.customer && order.customer.shippingDistrict, order.customer && order.customer.shippingCity]
            .filter(Boolean)
            .join(" / ") || null,
        mailEnabled: smtpConfigured(process.env),
      },
    });
  }

  if (req.method === "POST" && urlPath === "/api/analytics/event") {
    try {
      const ip = clientIp(req);
      if (rateLimited(analyticsAttempts, ip, 120, 15 * 60 * 1000)) {
        return json(res, 429, { ok: false, error: "Çok fazla istek." });
      }
      const body = JSON.parse((await readBody(req, 4 * 1024)).toString("utf8") || "{}");
      analyticsStore.record({
        type: String(body.type || "").slice(0, 40),
        path: String(body.path || "/").slice(0, 220),
        productId: String(body.productId || "").slice(0, 80),
        sessionId: String(body.sessionId || "").slice(0, 120),
      });
      return json(res, 202, { ok: true });
    } catch (_) {
      return json(res, 422, { ok: false, error: "Analitik olayı geçersiz." });
    }
  }

  if (
    req.method === "GET" &&
    (urlPath === "/api/catalog-bootstrap" || urlPath === "/api/catalog/bootstrap")
  ) {
    const requestUrl = normalizeCatalogBootstrapRequestUrl(
      new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`)
    );
    const bootstrap = catalogBootstrapPayload(requestUrl);
    if (!bootstrap) {
      return json(res, 404, { ok: false, error: "Katalog önbelleği hazır değil." });
    }
    return json(res, 200, bootstrap, {
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
    });
  }

  if (req.method === "GET" && urlPath === "/api/brands") {
    return json(
      res,
      200,
      { brands: buildBrandCounts(storefrontIndex(false).compactAll) },
      { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" }
    );
  }

  if (req.method === "GET" && urlPath === "/api/products/similar") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const similarId = requestUrl.searchParams.get("id");
    const products = similarProductsIndexed(
      storefrontIndex(false),
      similarId,
      requestUrl.searchParams.get("limit"),
      soldOutCompact(similarId)
    );
    return json(res, 200, { products }, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    });
  }

  if (req.method === "GET" && urlPath === "/api/products") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const updatedAt = fs.existsSync(PRODUCTS_FILE)
      ? fs.statSync(PRODUCTS_FILE).mtime.toISOString()
      : null;
    if (requestUrl.searchParams.get("homeFeatured") === "1") {
      const snap = readHomeFeaturedSnapshot();
      if (snap) {
        return json(res, 200, Object.assign({ updatedAt }, snap), {
          "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
        });
      }
      const featured = homeFeaturedCatalog(mergedProducts(false), {
        popularity: popularProductScores(),
        minPriceInclVat: shippingSettingsStore.getSettings().minOrderAmount,
        limit: requestUrl.searchParams.get("limit") || 12,
      }, { routeIndex: storefrontIndex(false).routeIndex, ...catalogImageContext() });
      const payload = {
        products: featured.products,
        byParent: featured.byParent,
        perCategory: featured.perCategory,
        parents: featured.parents,
        total: featured.products.length,
        page: 1,
        limit: featured.perCategory,
        totalPages: 1,
        updatedAt,
      };
      try {
        fs.mkdirSync(CATALOG_BOOTSTRAP_DIR, { recursive: true });
        atomicWriteJson(path.join(CATALOG_BOOTSTRAP_DIR, "home-featured.json"), payload);
      } catch (_) {}
      return json(res, 200, payload, {
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
      });
    }
    const productId = String(requestUrl.searchParams.get("id") || "").trim();
    const idsRaw = String(requestUrl.searchParams.get("ids") || "").trim();
    const pathParam = String(requestUrl.searchParams.get("path") || "").trim();
    if (pathParam) {
      const queried = lookupPublicProductsByPath(pathParam);
      return json(
        res,
        200,
        {
          products: queried.products,
          total: queried.total,
          page: queried.page,
          limit: queried.limit,
          totalPages: queried.totalPages,
          updatedAt,
        },
        { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" }
      );
    }
    if (productId || idsRaw) {
      const queried = lookupPublicProductsByIds(productId, idsRaw);
      return json(
        res,
        200,
        {
          products: queried.products,
          total: queried.total,
          page: queried.page,
          limit: queried.limit,
          totalPages: queried.totalPages,
          updatedAt,
        },
          { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" }
      );
    }
    const sort = String(requestUrl.searchParams.get("sort") || "").toLowerCase();
    const page = Number(requestUrl.searchParams.get("page") || 1) || 1;
    const hasListingFilters = Boolean(
      requestUrl.searchParams.get("q") ||
        requestUrl.searchParams.get("marka") ||
        requestUrl.searchParams.get("minFiyat") ||
        requestUrl.searchParams.get("maxFiyat") ||
        requestUrl.searchParams.get("ozellik") ||
        requestUrl.searchParams.get("id") ||
        requestUrl.searchParams.get("ids") ||
        requestUrl.searchParams.get("featured")
    );
    if (page <= 1 && !hasListingFilters && !sort) {
      const snap = readCatalogBootstrapSnapshot(requestUrl);
      if (snap) {
        return json(
          res,
          200,
          {
            products: snap.products,
            total: snap.total,
            page: snap.page || 1,
            limit: snap.limit || CATALOG_BOOTSTRAP_LIMIT,
            totalPages: snap.totalPages,
            facets: snap.facets || null,
            updatedAt,
          },
          { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" }
        );
      }
    }
    const queried = queryPublicCatalogIndexed(storefrontIndex(false), {
      id: requestUrl.searchParams.get("id") || "",
      ids: requestUrl.searchParams.get("ids") || "",
      q: requestUrl.searchParams.get("q") || "",
      featured: requestUrl.searchParams.get("featured") || "",
      kategori: requestUrl.searchParams.get("kategori") || "",
      ara: requestUrl.searchParams.get("ara") || "",
      alt: requestUrl.searchParams.get("alt") || "",
      marka: requestUrl.searchParams.get("marka") || "",
      minFiyat: requestUrl.searchParams.get("minFiyat") || "",
      maxFiyat: requestUrl.searchParams.get("maxFiyat") || "",
      ozellik: requestUrl.searchParams.get("ozellik") || "",
      page: requestUrl.searchParams.get("page") || 1,
      limit: requestUrl.searchParams.get("limit") || 48,
      sort,
      popularity: sort === "popular" ? popularProductScores() : undefined,
    });
    return json(
      res,
      200,
      {
        products: queried.products,
        total: queried.total,
        page: queried.page,
        limit: queried.limit,
        totalPages: queried.totalPages,
        facets: queried.facets || null,
        updatedAt,
      },
      { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" }
    );
  }

  if (req.method === "GET" && urlPath === "/api/feeds/akakce.xml") {
    const xml = storefrontAkakceXml();
    res.writeHead(
      200,
      securityHeaders({
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      })
    );
    return res.end(xml);
  }

  if (req.method === "POST" && urlPath === "/api/admin/login") {
    try {
      const ip = clientIp(req);
      if (rateLimited(adminLoginAttempts, ip, 12, 15 * 60 * 1000)) {
        return json(res, 429, { ok: false, error: "Çok fazla giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin." });
      }
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const password = String(body.password || "");
      const email = String(body.email || "").trim();
      let user = null;

      if (email) {
        user = adminUserStore.authenticate(email, password);
        if (!user) {
          return json(res, 401, { ok: false, error: "E-posta veya şifre hatalı" });
        }
      } else {
        const supplied = Buffer.from(password);
        const expected = Buffer.from(getAdminPassword());
        const matches =
          supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        if (!matches) {
          return json(res, 401, { ok: false, error: "Şifre hatalı" });
        }
        if (adminUserStore.count() === 0) {
          try {
            adminUserStore.ensureBootstrapOwner(process.env);
          } catch (err) {
            console.warn("Admin owner bootstrap atlandı:", err.message || err);
          }
        }
      }

      const mustChangePassword = user
        ? false
        : adminSecurityStore.shouldForcePasswordChange(getAdminPassword());
      const token = crypto.randomBytes(24).toString("hex");
      adminSessionStore.create(token, {
        userId: user ? user.id : null,
        mustChangePassword,
      });
      adminLoginAttempts.delete(ip);
      return json(res, 200, {
        ok: true,
        token,
        user,
        mustChangePassword,
        minPasswordLength: MIN_ADMIN_PASSWORD_LENGTH,
        passwordChangeReason: mustChangePassword
          ? adminSecurityStore.read().reason ||
            "Panel şifresi güncellenmeli (en az " + MIN_ADMIN_PASSWORD_LENGTH + " karakter)."
          : "",
      });
    } catch (_) {
      return json(res, 400, { ok: false, error: "Geçersiz istek" });
    }
  }

  if (req.method === "POST" && urlPath === "/api/admin/logout") {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (token) adminSessionStore.remove(token);
    return json(res, 200, { ok: true });
  }

  if (urlPath.startsWith("/api/admin/") && !authOk(req)) {
    return json(res, 401, { ok: false, error: "Oturum gerekli" });
  }

  if (
    urlPath.startsWith("/api/admin/") &&
    authOk(req) &&
    passwordChangeBlocksAdmin(req, res, urlPath)
  ) {
    return;
  }

  if (req.method === "GET" && urlPath === "/api/admin/me") {
    const session = getSession(req);
    return json(res, 200, {
      ok: true,
      user: sessionUser(req),
      mustChangePassword: sessionMustChangePassword(session),
      minPasswordLength: MIN_ADMIN_PASSWORD_LENGTH,
      smtpConfigured: smtpConfigured(process.env),
      passwordChangeReason: sessionMustChangePassword(session)
        ? adminSecurityStore.read().reason || ""
        : "",
    });
  }

  if (req.method === "POST" && urlPath === "/api/admin/change-password") {
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const currentPassword = String(body.currentPassword || "");
      const newPassword = adminSecurityStore.validateNewPassword(body.newPassword);
      const confirmPassword = String(body.confirmPassword || "");
      if (newPassword !== confirmPassword) {
        return json(res, 422, { ok: false, error: "Yeni şifreler eşleşmiyor." });
      }
      const authHeader = req.headers.authorization || "";
      const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const session = getSession(req);
      const user = sessionUser(req);
      if (user && user.email) {
        const authed = adminUserStore.authenticate(user.email, currentPassword);
        if (!authed) {
          return json(res, 401, { ok: false, error: "Mevcut şifre hatalı." });
        }
        adminUserStore.update(user.id, { password: newPassword });
        if (user.role === "owner") {
          updateEnvAdminPassword(ENV_FILE, newPassword);
          setRuntimeAdminPassword(newPassword);
        }
      } else {
        const supplied = Buffer.from(currentPassword);
        const expected = Buffer.from(getAdminPassword());
        const matches =
          supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        if (!matches) {
          return json(res, 401, { ok: false, error: "Mevcut şifre hatalı." });
        }
        updateEnvAdminPassword(ENV_FILE, newPassword);
        setRuntimeAdminPassword(newPassword);
        syncSingleOwnerPassword(newPassword);
      }
      adminSecurityStore.clearForcePasswordChange();
      if (session && sessionToken) {
        adminSessionStore.replace(sessionToken, Object.assign({}, session, { mustChangePassword: false }));
      }
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Şifre güncellenemedi." });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/users") {
    if (!requireOwner(req, res)) return;
    return json(res, 200, { ok: true, users: adminUserStore.list() });
  }

  if (req.method === "POST" && urlPath === "/api/admin/users") {
    if (adminUserStore.count() > 0 && !requireOwner(req, res)) return;
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const role = adminUserStore.count() === 0 ? "owner" : "admin";
      const user = adminUserStore.create(body, { role });
      return json(res, 200, { ok: true, user });
    } catch (err) {
      return json(res, 400, { ok: false, error: (err && err.message) || "Kullanıcı kaydedilemedi" });
    }
  }

  const adminUserMatch = /^\/api\/admin\/users\/([a-f0-9]{16})$/.exec(urlPath);
  if (adminUserMatch) {
    const userId = adminUserMatch[1];
    if (req.method === "PUT") {
      if (!requireOwner(req, res)) return;
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
        const user = adminUserStore.update(userId, body);
        if (!user) return json(res, 404, { ok: false, error: "Kullanıcı bulunamadı" });
        return json(res, 200, { ok: true, user });
      } catch (err) {
        return json(res, 400, { ok: false, error: (err && err.message) || "Güncellenemedi" });
      }
    }
    if (req.method === "DELETE") {
      if (!requireOwner(req, res)) return;
      try {
        const removed = adminUserStore.remove(userId);
        if (!removed) return json(res, 404, { ok: false, error: "Kullanıcı bulunamadı" });
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, { ok: false, error: (err && err.message) || "Silinemedi" });
      }
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/shipping/settings") {
    return json(res, 200, { ok: true, settings: shippingSettingsStore.getSettings() });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/shipping/settings") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const settings = shippingSettingsStore.setSettings({
        freeShippingThreshold: body.freeShippingThreshold,
        shippingFee: body.shippingFee,
        minOrderAmount: body.minOrderAmount,
        dispatchBusinessDays: body.dispatchBusinessDays,
        closedDays: body.closedDays,
      });
      akakceXmlMemo = null;
      return json(res, 200, { ok: true, settings });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Kargo ayarları kaydedilemedi." });
    }
  }

  if (urlPath === "/api/admin/coupons" || urlPath.startsWith("/api/admin/coupons/")) {
    if (!couponStore) return json(res, 503, { ok: false, error: "Kupon modülü kullanılamıyor." });
    const codeParam = urlPath.startsWith("/api/admin/coupons/")
      ? decodeURIComponent(urlPath.slice("/api/admin/coupons/".length))
      : "";
    const auditCoupon = (action, code, detail) => {
      try {
        const session = getSession(req);
        auditStore.record({
          actorType: "admin_user",
          actorId: session && session.userId,
          action,
          entityType: "coupon",
          entityId: code,
          detail: detail || {},
          ip: clientIp(req),
        });
      } catch (_) {}
    };
    try {
      if (req.method === "GET" && !codeParam) {
        return json(res, 200, { ok: true, coupons: couponStore.list() });
      }
      if (req.method === "POST" && !codeParam) {
        const body = JSON.parse((await readBody(req, 8 * 1024)).toString("utf8") || "{}");
        const coupon = couponStore.save(body);
        auditCoupon("coupon.save", coupon.code, { type: coupon.type, value: coupon.value });
        return json(res, 200, { ok: true, coupon });
      }
      if (req.method === "PATCH" && codeParam) {
        const body = JSON.parse((await readBody(req, 4 * 1024)).toString("utf8") || "{}");
        const coupon = couponStore.setActive(codeParam, body.active !== false);
        if (!coupon) return json(res, 404, { ok: false, error: "Kupon bulunamadı." });
        auditCoupon("coupon.active", coupon.code, { active: coupon.active });
        return json(res, 200, { ok: true, coupon });
      }
      if (req.method === "DELETE" && codeParam) {
        if (!couponStore.remove(codeParam)) return json(res, 404, { ok: false, error: "Kupon bulunamadı." });
        auditCoupon("coupon.delete", normalizeCouponCode(codeParam));
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { ok: false, error: "Desteklenmeyen işlem." });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Kupon kaydedilemedi." });
    }
  }

  if (urlPath === "/api/admin/price-alerts" || urlPath.startsWith("/api/admin/price-alerts/")) {
    if (!priceAlertStore) return json(res, 503, { ok: false, error: "Alarm modülü kullanılamıyor." });
    const idParam = urlPath.startsWith("/api/admin/price-alerts/")
      ? Number(urlPath.slice("/api/admin/price-alerts/".length))
      : 0;
    try {
      if (req.method === "GET" && !idParam) {
        const requestUrl = new URL(req.url || urlPath, "http://localhost");
        if (requestUrl.searchParams.get("countsOnly") === "1") {
          return json(res, 200, { ok: true, counts: priceAlertStore.adminCounts() });
        }
        const kind = requestUrl.searchParams.get("kind") === "stock" ? "stock" : "price";
        const groups = new Map();
        priceAlertStore.adminList(kind).forEach((alert) => {
          let group = groups.get(alert.productId);
          if (!group) {
            const live = priceAlertProduct(alert.productId);
            const soldOut = live ? null : soldOutAlertProduct(alert.productId);
            const info = live || soldOut;
            group = {
              productId: alert.productId,
              name: (info && info.name) || alert.productName || alert.productId,
              urlPath: info ? info.urlPath : null,
              image: info ? info.image : "",
              state: live ? "live" : soldOut ? "soldout" : "gone",
              priceIncl: live ? live.priceIncl : null,
              lastRequestAt: alert.createdAt,
              requests: [],
            };
            groups.set(alert.productId, group);
          }
          group.requests.push({
            id: alert.id,
            email: alert.email,
            createdAt: alert.createdAt,
            basePrice: alert.basePrice,
            status: alert.status,
            notifyCount: alert.notifyCount,
            lastNotifiedAt: alert.lastNotifiedAt,
          });
        });
        const products = Array.from(groups.values()).sort(
          (a, b) => b.requests.length - a.requests.length || String(b.lastRequestAt).localeCompare(String(a.lastRequestAt))
        );
        return json(res, 200, { ok: true, kind, counts: priceAlertStore.adminCounts(), products });
      }
      if (req.method === "DELETE" && idParam) {
        const alert = priceAlertStore.remove(idParam);
        if (!alert) return json(res, 404, { ok: false, error: "Talep bulunamadı." });
        try {
          const session = getSession(req);
          auditStore.record({
            actorType: "admin_user",
            actorId: session && session.userId,
            action: "price_alert.delete",
            entityType: "price_alert",
            entityId: String(alert.id),
            detail: { productId: alert.productId, kind: alert.kind },
            ip: clientIp(req),
          });
        } catch (_) {}
        return json(res, 200, { ok: true, counts: priceAlertStore.adminCounts() });
      }
      return json(res, 405, { ok: false, error: "Desteklenmeyen işlem." });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Talepler okunamadı." });
    }
  }

  if (urlPath === "/api/admin/reviews" || urlPath.startsWith("/api/admin/reviews/")) {
    if (!reviewStore) return json(res, 503, { ok: false, error: "Yorum modülü kullanılamıyor." });
    const idParam = urlPath.startsWith("/api/admin/reviews/")
      ? Number(urlPath.slice("/api/admin/reviews/".length))
      : 0;
    const auditReview = (action, review, detail) => {
      try {
        const session = getSession(req);
        auditStore.record({
          actorType: "admin_user",
          actorId: session && session.userId,
          action,
          entityType: "review",
          entityId: String(review.id),
          detail: Object.assign({ productId: review.productId, orderId: review.orderId }, detail || {}),
          ip: clientIp(req),
        });
      } catch (_) {}
    };
    try {
      if (req.method === "GET" && !idParam) {
        const requestUrl = new URL(req.url || urlPath, "http://localhost");
        const status = String(requestUrl.searchParams.get("status") || "");
        return json(res, 200, {
          ok: true,
          reviews: reviewStore.adminList({ status: REVIEW_STATUSES.has(status) ? status : "" }),
          counts: reviewStore.statusCounts(),
        });
      }
      if (req.method === "PATCH" && idParam) {
        const body = JSON.parse((await readBody(req, 4 * 1024)).toString("utf8") || "{}");
        const review = reviewStore.moderate(idParam, String(body.status || ""));
        if (!review) return json(res, 404, { ok: false, error: "Yorum bulunamadı." });
        productHtmlCache.pages.clear();
        auditReview("review.moderate", review, { status: review.status });
        return json(res, 200, { ok: true, review, counts: reviewStore.statusCounts() });
      }
      if (req.method === "DELETE" && idParam) {
        const review = reviewStore.remove(idParam);
        if (!review) return json(res, 404, { ok: false, error: "Yorum bulunamadı." });
        productHtmlCache.pages.clear();
        auditReview("review.delete", review);
        return json(res, 200, { ok: true, counts: reviewStore.statusCounts() });
      }
      return json(res, 405, { ok: false, error: "Desteklenmeyen işlem." });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Yorum güncellenemedi." });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/installments/settings") {
    return json(res, 200, { ok: true, settings: installmentSettingsStore.getSettings() });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/installments/settings") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const settings = installmentSettingsStore.setSettings({
        enabled: body.enabled,
        minAmount: body.minAmount,
        options: body.options,
      });
      return json(res, 200, { ok: true, settings });
    } catch (err) {
      return json(res, 422, { ok: false, error: (err && err.message) || "Taksit ayarları kaydedilemedi." });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/orders") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const status = requestUrl.searchParams.get("status") || "";
    const limit = requestUrl.searchParams.get("limit") || "50";
    const from = requestUrl.searchParams.get("from") || "";
    const to = requestUrl.searchParams.get("to") || "";
    const q = requestUrl.searchParams.get("q") || "";
    const invoiceTrackedSince = orderStore.firstIntegrationAt("bizimhesap_invoice");
    const orders = orderStore
      .list({
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
        limit,
        sort: requestUrl.searchParams.get("sort") || "",
        dir: requestUrl.searchParams.get("dir") || "",
      })
      .map((order) => {
        const invoiceSummary = invoiceSummaryFor(order.id);
        const invoiceUntracked = invoiceUntrackedFor(order, Boolean(invoiceSummary), invoiceTrackedSince);
        return Object.assign({}, order, { invoiceSummary, invoiceUntracked });
      });
    return json(res, 200, { ok: true, orders, shippingCarriers: SHIPPING_CARRIERS });
  }

  if (req.method === "GET" && urlPath === "/api/admin/leads") {
    const leads = contactStore.readAll().map((lead) => ({
      id: lead.id || null,
      createdAt: lead.createdAt || null,
      firma: lead.firma || "",
      email: lead.email || "",
      tel: lead.tel || "",
      vkn: lead.vkn || "",
      konu: lead.konu || "",
      urun: lead.urun || "",
      kategori: lead.kategori || "",
      mesaj: lead.mesaj || "",
      spam: Boolean(lead.spam),
      replies: Array.isArray(lead.replies) ? lead.replies : [],
    }));
    return json(res, 200, {
      ok: true,
      leads,
      policyNote: "taslak politika — iletişim lead saklama süresi önerilen 2 yıl",
      replyEnabled: smtpConfigured(process.env),
    });
  }

  const adminLeadReplyMatch = /^\/api\/admin\/leads\/([^/]+)\/reply$/.exec(urlPath);
  if (adminLeadReplyMatch && req.method === "POST") {
    const leadId = decodeURIComponent(adminLeadReplyMatch[1]);
    const lead = contactStore.get(leadId);
    if (!lead) return json(res, 404, { ok: false, error: "Talep bulunamadı" });
    let raw;
    try {
      raw = await readBody(req, LEAD_REPLY_MAX_REQUEST_BYTES);
    } catch (err) {
      return json(res, 413, { ok: false, error: "Ekler çok büyük (toplam en fazla 10 MB)." });
    }
    let body;
    try {
      body = JSON.parse(raw.toString("utf8") || "{}");
    } catch (err) {
      return json(res, 400, { ok: false, error: "İstek okunamadı." });
    }
    const input = validateLeadReplyInput(body);
    if (!input.ok) return json(res, 400, { ok: false, error: input.error });
    const actor = sessionUser(req);
    try {
      const result = await sendLeadReply(lead, input, {
        by: actor ? actor.email || [actor.firstName, actor.lastName].filter(Boolean).join(" ") : "",
      });
      if (!result.ok) return json(res, result.status || 400, { ok: false, error: result.error });
      const updated = contactStore.update(leadId, (current) =>
        Object.assign(current, {
          replies: (Array.isArray(current.replies) ? current.replies : []).concat(result.reply),
        })
      );
      try {
        const session = getSession(req);
        auditStore.record({
          actorType: "admin_user",
          actorId: session && session.userId,
          action: "lead.reply",
          entityType: "lead",
          entityId: leadId,
          detail: { attachments: result.reply.attachments.length },
          ip: clientIp(req),
        });
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        reply: result.reply,
        replies: (updated && updated.replies) || [result.reply],
      });
    } catch (err) {
      return json(res, 502, {
        ok: false,
        error: "Yanıt gönderilemedi: " + ((err && err.message) || "SMTP hatası"),
      });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/customers") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const limit = requestUrl.searchParams.get("limit") || "50";
    return json(res, 200, {
      ok: true,
      customers: orderStore.listCustomers({ limit }),
    });
  }

  const adminOrderAnonymizeMatch = /^\/api\/admin\/orders\/([^/]+)\/anonymize$/.exec(urlPath);
  if (adminOrderAnonymizeMatch && req.method === "POST") {
    const orderId = decodeURIComponent(adminOrderAnonymizeMatch[1]);
    const current = orderStore.get(orderId);
    if (!current) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });
    const result = anonymizeOrder(DATA_ROOT, orderId);
    if (!result.ok) {
      return json(res, 400, { ok: false, error: result.error || "Anonimleştirilemedi" });
    }
    const order = orderStore.get(orderId);
    try {
      const session = getSession(req);
      auditStore.record({
        actorType: "admin_user",
        actorId: session && session.userId,
        action: "order.anonymize",
        entityType: "order",
        entityId: orderId,
        detail: {
          already: Boolean(result.already),
          legalHold: Boolean(order && order.legalHold),
          anonymizedAt: result.anonymizedAt,
        },
        ip: clientIp(req),
      });
    } catch (_) {}
    return json(res, 200, {
      ok: true,
      already: Boolean(result.already),
      order,
      policyNote: "taslak politika — PII anonim; tutar/kalem korunur; legal_hold silmeyi engeller",
    });
  }

  const adminOrderDocsMatch = /^\/api\/admin\/orders\/([^/]+)\/documents(?:\/([^/]+))?$/.exec(urlPath);
  if (adminOrderDocsMatch) {
    const orderId = decodeURIComponent(adminOrderDocsMatch[1]);
    const docId = adminOrderDocsMatch[2] ? decodeURIComponent(adminOrderDocsMatch[2]) : "";
    if (!orderStore.get(orderId)) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });
    const session = getSession(req);
    if (!docId && req.method === "POST") {
      let raw;
      try {
        raw = await readBody(req, MAX_ORDER_DOC_REQUEST_BYTES);
      } catch (_) {
        return json(res, 413, { ok: false, error: "Dosya en fazla 10 MB olabilir." });
      }
      let body;
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch (_) {
        return json(res, 400, { ok: false, error: "Dosya okunamadı." });
      }
      const input = validateOrderDocInput(body);
      if (!input.ok) return json(res, 400, input);
      const saved = orderDocStore.add(orderId, input, { by: session && session.userId });
      if (!saved.ok) return json(res, 400, saved);
      const resolvedAt = saved.doc.kind === "return" ? markInvoiceFollowupResolved(orderId, { onlyReturns: true }) : null;
      auditStore.record({
        actorType: "admin_user",
        actorId: session && session.userId,
        action: "order.document_uploaded",
        entityType: "order",
        entityId: orderId,
        detail: { docId: saved.doc.id, kind: saved.doc.kind, size: saved.doc.size, resolvedAt },
      });
      return json(res, 200, {
        ok: true,
        document: saved.doc,
        documents: orderDocumentsWithLinks(orderId),
        integration: orderStore.getIntegration(orderId, "bizimhesap_invoice"),
        followupResolved: Boolean(resolvedAt),
      });
    }
    if (docId && req.method === "GET") {
      const found = orderDocStore.read(orderId, docId);
      if (!found) return json(res, 404, { ok: false, error: "Belge bulunamadı" });
      return sendOrderDocument(res, found);
    }
    if (docId && req.method === "DELETE") {
      const removed = orderDocStore.remove(orderId, docId);
      if (!removed) return json(res, 404, { ok: false, error: "Belge bulunamadı" });
      auditStore.record({
        actorType: "admin_user",
        actorId: session && session.userId,
        action: "order.document_deleted",
        entityType: "order",
        entityId: orderId,
        detail: { docId: removed.id, kind: removed.kind },
      });
      return json(res, 200, { ok: true, documents: orderDocumentsWithLinks(orderId) });
    }
    return json(res, 405, { ok: false, error: "Desteklenmeyen işlem" });
  }

  const signedOrderDocMatch = /^\/api\/order-documents\/([^/]+)\/([^/]+)$/.exec(urlPath);
  if (signedOrderDocMatch && req.method === "GET") {
    const orderId = decodeURIComponent(signedOrderDocMatch[1]);
    const docId = decodeURIComponent(signedOrderDocMatch[2]);
    const params = new URL(req.url, "http://localhost").searchParams;
    const found = orderDocLinks.verify(orderId, docId, params.get("exp"), params.get("sig"))
      ? orderDocStore.read(orderId, docId)
      : null;
    if (!found) {
      res.writeHead(
        403,
        securityHeaders({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" })
      );
      return res.end(
        "<!doctype html><meta charset='utf-8'><title>Belge açılamadı</title>" +
          "<p style='font-family:sans-serif;padding:24px'>Belge bağlantısının süresi doldu veya geçersiz. Paneldeki siparişi yeniden açıp tekrar deneyin.</p>"
      );
    }
    return sendOrderDocument(res, found);
  }

  const adminOrderBizimhesapMatch = /^\/api\/admin\/orders\/([^/]+)\/bizimhesap-invoice$/.exec(urlPath);
  if (adminOrderBizimhesapMatch && req.method === "POST") {
    const orderId = decodeURIComponent(adminOrderBizimhesapMatch[1]);
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const order = orderStore.get(orderId);
      if (!order) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });
      if (body.action === "resolve") {
        const resolvedAt = markInvoiceFollowupResolved(orderId);
        if (!resolvedAt) {
          return json(res, 400, { ok: false, error: "Bu siparişte kesilmiş fatura yok." });
        }
        const session = getSession(req);
        auditStore.record({
          actorType: "admin_user",
          actorId: session && session.userId,
          action: "order.invoice_followup_resolved",
          entityType: "order",
          entityId: orderId,
          detail: { resolvedAt },
        });
        return json(res, 200, { ok: true, integration: orderStore.getIntegration(orderId, "bizimhesap_invoice") });
      }
      if (!bizimhesapConfigured(process.env)) {
        return json(res, 503, {
          ok: false,
          error: "BizimHesap yapılandırılmamış. .env içinde BIZIMHESAP_FIRM_ID, BIZIMHESAP_API_KEY ve BIZIMHESAP_API_TOKEN gerekli.",
        });
      }
      if (body.action === "sync") {
        const session = getSession(req);
        const result = await syncIssuedInvoiceNumber(orderId, { source: "panel", actorId: session && session.userId });
        if (result.reason === "not_transferred") {
          return json(res, 400, { ok: false, error: "Önce sipariş BizimHesap'a aktarılmalı." });
        }
        return json(res, 200, {
          ok: true,
          mode: "sync",
          result,
          integration: orderStore.getIntegration(orderId, "bizimhesap_invoice"),
        });
      }
      const allow = orderAllowsBizimHesapInvoice(order);
      if (!allow.ok) {
        const msg =
          allow.reason === "order_status_blocked"
            ? "İptal veya iade edilmiş sipariş BizimHesap'a aktarılamaz."
            : allow.reason === "order_reversed"
              ? "İade yapılmış sipariş panelden aktarılmaz; faturayı kalan tutarla BizimHesap'ta kesin."
              : "Yalnızca ödemesi alınmış siparişler BizimHesap'a aktarılabilir.";
        return json(res, 400, { ok: false, error: msg, reason: allow.reason });
      }

      const forceRecut = body.force === true;
      const existing = orderStore.getIntegration(orderId, "bizimhesap_invoice");
      if (forceRecut && existing && existing.payload && existing.payload.invoiceNo) {
        return json(res, 409, {
          ok: false,
          error: "Faturası kesilmiş sipariş yeniden aktarılmaz; değişiklik gerekiyorsa BizimHesap'ta düzeltin.",
        });
      }
      // Müşteriye fatura mailini BizimHesap atar; aktarım müşteriye mail atmaz.
      const session = getSession(req);
      const result = forceRecut
        ? await submitSalesInvoice(order, { store: orderStore, force: true })
        : await transferOrderToBizimHesap(orderId, "panel", session && session.userId);
      if (!result.submitted && result.reason === "api_error") {
        return json(res, 502, { ok: false, error: result.error || "BizimHesap aktarımı başarısız" });
      }
      return json(res, 200, {
        ok: true,
        mode: "transfer",
        result,
        integration: orderStore.getIntegration(orderId, "bizimhesap_invoice"),
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: (err && err.message) || "BizimHesap faturası gönderilemedi" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/bizimhesap/status") {
    const configured = bizimhesapConfigured(process.env);
    if (!configured) {
      return json(res, 200, {
        ok: true,
        configured: false,
        message: "BIZIMHESAP_FIRM_ID, BIZIMHESAP_API_KEY ve BIZIMHESAP_API_TOKEN tanımlanmalı.",
      });
    }
    const ping = await pingBizimHesap();
    return json(res, 200, {
      ok: true,
      configured: true,
      pingOk: ping.ok === true,
      pingMessage: ping.message || null,
    });
  }

  const adminOrderInquiryMatch = /^\/api\/admin\/orders\/([^/]+)\/bank-inquiry$/.exec(urlPath);
  if (adminOrderInquiryMatch && req.method === "POST") {
    if (!requireOwner(req, res)) return;
    const orderId = decodeURIComponent(adminOrderInquiryMatch[1]);
    if (!orderStore.get(orderId)) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });
    if (!akbankConfig.enabled) {
      return json(res, 503, { ok: false, error: "Akbank POS kimlik bilgileri tanımlı değil." });
    }
    if (bankOperationLocks.has(orderId)) {
      return json(res, 409, { ok: false, error: "Bu sipariş için banka işlemi sürüyor; sonucu bekleyin." });
    }
    bankOperationLocks.add(orderId);
    try {
      const session = getSession(req);
      const out = await reconcileOrderWithBank(orderId, session && session.userId);
      if (!out.ok) return json(res, out.status || 502, { ok: false, error: out.error, responseCode: out.responseCode });
      return json(res, 200, out);
    } catch (err) {
      return json(res, 502, { ok: false, error: (err && err.message) || "İşlem sorgulama başarısız." });
    } finally {
      bankOperationLocks.delete(orderId);
    }
  }

  const adminOrderReversalMatch = /^\/api\/admin\/orders\/([^/]+)\/bank-reversal$/.exec(urlPath);
  if (adminOrderReversalMatch && req.method === "POST") {
    if (!requireOwner(req, res)) return;
    const orderId = decodeURIComponent(adminOrderReversalMatch[1]);
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const order = orderStore.get(orderId);
      if (!order) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });
      const clientIp =
        String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1")
          .split(",")[0]
          .trim() || "127.0.0.1";
      const preview = buildReversalPreview(order, bankReversalConfig, {
        mode: body.mode,
        action: body.action || "auto",
        amount: body.amount,
        items: body.items,
        includeShipping: body.includeShipping === true,
        clientIp,
      });
      if (!preview.ok) {
        return json(res, 400, {
          ok: false,
          error: reversalReasonMessage(preview.reason),
          reason: preview.reason,
          preview,
        });
      }
      if (body.dryRun === true || body.preview === true) {
        return json(res, 200, { ok: true, dryRun: true, preview });
      }
      if (body.confirm !== true) {
        return json(res, 400, {
          ok: false,
          error: "Banka iadesi için confirm:true gönderin.",
          preview,
        });
      }
      if (!bankReversalConfig.canCallBank) {
        return json(res, 503, {
          ok: false,
          error:
            "Banka iadesi API kapalı. Test için AKBANK_BANK_REVERSAL_ENABLED=true ve AKBANK_TEST_MODE=true; canlı için ayrıca AKBANK_BANK_REVERSAL_LIVE=true gerekir.",
          preview,
        });
      }
      if (bankOperationLocks.has(orderId)) {
        return json(res, 409, {
          ok: false,
          error: "Bu sipariş için banka işlemi sürüyor; sonucu bekleyin.",
        });
      }
      bankOperationLocks.add(orderId);
      try {
        const session = getSession(req);
        const actorId = session && session.userId;
        const fresh = orderStore.get(orderId);
        const plan = buildReversalPreview(fresh, bankReversalConfig, {
          mode: body.mode,
          action: body.action || "auto",
          amount: body.amount,
          items: body.items,
          includeShipping: body.includeShipping === true,
          clientIp,
        });
        if (!plan.ok) {
          return json(res, 400, {
            ok: false,
            error: reversalReasonMessage(plan.reason),
            reason: plan.reason,
            preview: plan,
          });
        }
        const result = await executeBankReversal(akbankConfig, plan.plan);
        const successAttempt = (result.attempts || []).find((row) => row.success);
        const lastAttempt = (result.attempts || [])[(result.attempts || []).length - 1];
        const sanitized = sanitizeReversalResponse(
          (successAttempt && successAttempt.response) || (lastAttempt && lastAttempt.response)
        );
        const event = buildReversalEvent({
          type: result.method || (successAttempt && successAttempt.type) || "unknown",
          amount: result.amount || plan.plan.amount,
          success: Boolean(result.ok),
          unknown: result.unknown === true,
          dryRun: false,
          response: sanitized,
          mode: plan.plan.mode,
          items: plan.plan.items,
          shippingRefunded: plan.plan.shippingRefunded,
          actorId,
        });
        let updated = orderStore.recordBankReversal(orderId, {
          event,
          success: Boolean(result.ok),
          dryRun: false,
        });
        const publicAttempts = (result.attempts || []).map((row) => ({
          type: row.type,
          success: row.success,
          unknown: row.unknown,
          httpStatus: row.httpStatus,
          error: row.error,
          responseCode: row.response && row.response.responseCode,
          responseMessage: row.response && row.response.responseMessage,
        }));
        auditStore.record({
          actorType: "admin_user",
          actorId,
          action: result.ok
            ? "order.bank_reversal_ok"
            : result.unknown
              ? "order.bank_reversal_unknown"
              : "order.bank_reversal_fail",
          entityType: "order",
          entityId: orderId,
          detail: {
            mode: plan.plan.mode,
            method: result.method,
            amount: result.amount,
            items: plan.plan.items,
            responseCode: result.responseCode || sanitized.responseCode,
            attempts: publicAttempts,
          },
        });
        if (result.unknown) {
          let reconcile = null;
          try {
            reconcile = await reconcileOrderWithBank(orderId, actorId);
          } catch (err) {
            reconcile = { ok: false, error: err.message };
          }
          const resolvedOk = reconcile && reconcile.ok && reconcile.decision === "record_success";
          const alertMail = resolvedOk
            ? null
            : await notifyReversalProblem({
                orderId,
                unknown: true,
                method: result.method || (plan.plan.tryVoid ? "void" : "refund"),
                amount: plan.plan.amount,
                responseCode: result.responseCode || sanitized.responseCode,
                responseMessage: result.responseMessage || sanitized.responseMessage,
              });
          return json(res, resolvedOk ? 200 : 202, {
            alertMail,
            ok: resolvedOk,
            unknown: !resolvedOk,
            error: resolvedOk
              ? null
              : "Bankadan kesin sonuç alınamadı. Para iade edilmiş olabilir; tekrar denemeyin, birkaç dakika sonra “Bankadan sorgula” ile kontrol edin.",
            inquiry: reconcile,
            order: (reconcile && reconcile.order) || updated,
            attempts: publicAttempts,
          });
        }
        if (!result.ok) {
          const alertMail = await notifyReversalProblem({
            orderId,
            unknown: false,
            method: result.method || (plan.plan.tryVoid ? "void" : "refund"),
            amount: plan.plan.amount,
            responseCode: result.responseCode || sanitized.responseCode,
            responseMessage: result.responseMessage || sanitized.responseMessage,
          });
          return json(res, 502, {
            ok: false,
            alertMail,
            error: result.responseMessage || "Banka iadesi/iptali reddedildi.",
            responseCode: result.responseCode,
            attempts: publicAttempts,
            order: updated,
            preview: plan,
          });
        }
        const follow = await afterSuccessfulReversal(fresh, updated, event);
        updated = orderStore.get(orderId) || updated;
        return json(res, 200, {
          ok: true,
          method: result.method,
          amount: result.amount,
          fully: follow.fully,
          couponReleased: follow.couponReleased,
          mailSent: follow.mailSent,
          mailReason: follow.mailReason,
          invoice: follow.invoice,
          order: updated,
          attempts: publicAttempts,
        });
      } finally {
        bankOperationLocks.delete(orderId);
      }
    } catch (err) {
      return json(res, 502, {
        ok: false,
        error: (err && err.message) || "Banka iadesi işlenemedi.",
      });
    }
  }

  const adminOrderMatch = /^\/api\/admin\/orders\/([^/]+)$/.exec(urlPath);
  if (adminOrderMatch) {
    const orderId = decodeURIComponent(adminOrderMatch[1]);
    if (req.method === "GET") {
      let order = orderStore.get(orderId);
      if (!order) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });
      order = orderStore.reconcilePaidFromBankEvidence(orderId) || order;
      const bizimhesap = orderStore.getIntegration(orderId, "bizimhesap_invoice");
      return json(res, 200, {
        ok: true,
        order,
        statusMails: orderStore.listStatusMails(orderId),
        bizimhesap,
        documents: orderDocumentsWithLinks(orderId),
        bizimhesapConfigured: bizimhesapConfigured(process.env),
        invoiceUntracked: invoiceUntrackedFor(
          order,
          Boolean(bizimhesap && bizimhesap.guid),
          orderStore.firstIntegrationAt("bizimhesap_invoice")
        ),
        bankReversal: buildReversalPreview(
          order,
          bankReversalConfig,
          order.status === "shipped" || order.status === "delivered" ? { action: "refund" } : { mode: "cancel" }
        ),
        bankInquiryAvailable: Boolean(akbankConfig.enabled),
      });
    }
    if (req.method === "PATCH") {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
        const current = orderStore.get(orderId);
        if (!current) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });

        const patch = {};
        let mailKey = null;
        let mailExtra = null;
        let shippingSave = false;

        const hasCarrierField = Object.prototype.hasOwnProperty.call(body, "shippingCarrier");
        const hasTrackingField = Object.prototype.hasOwnProperty.call(body, "trackingCode");

        if (hasCarrierField || hasTrackingField) {
          const carrier = String(body.shippingCarrier || "").trim().slice(0, 80);
          const tracking = String(body.trackingCode || "").trim().slice(0, 80);
          if (!carrier || !tracking) {
            return json(res, 400, {
              ok: false,
              error: "Kargo firması ve gönderi kodu birlikte gerekli.",
            });
          }
          if (!SHIPPING_CARRIERS.includes(carrier)) {
            return json(res, 400, { ok: false, error: "Geçersiz kargo firması." });
          }
          patch.shippingCarrier = carrier;
          patch.trackingCode = tracking;
          patch.status = "shipped";
          mailKey = "shipped";
          mailExtra = { shippingCarrier: carrier, trackingCode: tracking };
          shippingSave = true;
          const resendMail = body.resendMail === true;
          const shippingChanged =
            String(current.shippingCarrier || "") !== carrier ||
            String(current.trackingCode || "") !== tracking;
          if (resendMail || shippingChanged) {
            orderStore.releaseStatusMail(orderId, "shipped");
          }
        }

        if (Object.prototype.hasOwnProperty.call(body, "status")) {
          const status = String(body.status || "").trim();
          if (!ORDER_STATUSES.has(status)) {
            return json(res, 400, { ok: false, error: "Geçersiz sipariş durumu" });
          }
          if (
            status === "paid" ||
            status === "payment_failed" ||
            status === "payment_pending"
          ) {
            return json(res, 400, {
              ok: false,
              error:
                "Ödeme durumu yalnızca banka callback ile güncellenir; panelden değiştirilemez.",
            });
          }
          if (!shippingSave && status === "shipped") {
            return json(res, 400, {
              ok: false,
              error:
                "Kargoda durumu yalnızca alttaki “Kargoyu kaydet ve müşteriye bildir” ile güncellenir.",
            });
          }
          if (!shippingSave) {
            if (status === "refunded") {
              return json(res, 400, {
                ok: false,
                error:
                  "İade durumu yalnızca “Banka iadesi/iptal” işlemi başarılı olunca güncellenir.",
              });
            }
            if (!ADMIN_FULFILLMENT_STATUSES.has(status)) {
              return json(res, 400, { ok: false, error: "Bu durum panelden seçilemez." });
            }
            const paidNotRefunded =
              (current.paymentTaken || current.paymentStatus === "paid") &&
              current.paymentStatus !== "refunded";
            if (status === "cancelled" && paidNotRefunded) {
              return json(res, 409, {
                ok: false,
                error:
                  "Ödemesi alınmış sipariş, para iade edilmeden iptal edilemez. “İptal et ve parayı iade et” düğmesini kullanın.",
              });
            }
            if (status === "delivered" && current.status !== "shipped" && current.status !== "delivered") {
              return json(res, 400, {
                ok: false,
                error: "Teslim edildi yalnızca kargoya verilmiş siparişte seçilebilir.",
              });
            }
            patch.status = status;
          }
        } else if (!shippingSave) {
          return json(res, 400, { ok: false, error: "Durum veya kargo bilgisi gerekli." });
        }

        const order = orderStore.update(orderId, patch);
        let mailSent = false;
        let mailResult = null;
        try {
          if (mailKey) {
            mailResult = await sendOrderStatusMail(order, mailKey, {
              extra: mailExtra,
              store: orderStore,
            });
          } else if (
            patch.status &&
            current.status !== patch.status &&
            NOTIFY_STATUSES.has(patch.status)
          ) {
            if (patch.status === "shipped" && !(order.shippingCarrier && order.trackingCode)) {
              mailResult = { sent: false, reason: "shipped_without_tracking" };
            } else {
              mailResult = await sendOrderStatusMail(order, patch.status, {
                store: orderStore,
                extra: patch.status === "delivered" ? { reviewUrl: reviewPageUrl(order) } : undefined,
              });
            }
          }
          mailSent = Boolean(mailResult && mailResult.sent);
        } catch (err) {
          console.error("order status mail failed:", err.message);
        }
        const mailReason = mailResult && !mailResult.sent ? mailResult.reason || null : null;
        const mailTo = mailResult && mailResult.to ? mailResult.to : null;
        try {
          const session = getSession(req);
          auditStore.record({
            actorType: "admin_user",
            actorId: session && session.userId,
            action: shippingSave ? "order.shipping_update" : "order.status_update",
            entityType: "order",
            entityId: orderId,
            detail: shippingSave
              ? {
                  shippingCarrier: patch.shippingCarrier,
                  trackingCode: patch.trackingCode,
                  status: patch.status,
                  mailSent,
                  mailReason,
                }
              : { from: current.status, to: patch.status, mailSent, mailReason },
            ip: clientIp(req),
          });
        } catch (_) {}
        return json(res, 200, {
          ok: true,
          order,
          mailSent,
          mailReason,
          mailTo,
          statusMails: orderStore.listStatusMails(orderId),
        });
      } catch (err) {
        return json(res, 400, { ok: false, error: (err && err.message) || "Güncellenemedi" });
      }
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/products") {
    return json(res, 200, { products: loadProducts() });
  }

  if (req.method === "GET" && urlPath === "/api/admin/categories") {
    return json(res, 200, { ok: true, categories: categoryStore.list() });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/categories") {
    try {
      const body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8") || "{}");
      const categories = categoryStore.save(body.categories);
      try {
        writeCategoriesBootstrapSnapshot();
      } catch (_) {}
      return json(res, 200, { ok: true, categories });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Kategori ağacı kaydedilemedi" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/analytics") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const from = requestUrl.searchParams.get("from");
    const to = requestUrl.searchParams.get("to");
    const days = requestUrl.searchParams.get("days");
    const range = from && to ? { from, to } : days;
    return json(res, 200, {
      analytics: analyticsStore.summary(range),
    });
  }

  if (req.method === "GET" && urlPath === "/api/admin/dashboard") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const from = requestUrl.searchParams.get("from");
    const to = requestUrl.searchParams.get("to");
    const days = requestUrl.searchParams.get("days");
    const range = from && to ? { from, to } : days;
    const analytics = analyticsStore.summary(range);
    const commerce = orderStore.commerceSummary(range);
    const viewedIds = (analytics.topViewedProducts || []).map((row) => row.productId);
    const catalogNames = resolveProductNamesByIds(viewedIds);
    const topViewedProducts = (analytics.topViewedProducts || []).map((row) => {
      const product = catalogNames[row.productId];
      return {
        productId: row.productId,
        views: row.views,
        name: product ? product.name : row.productId,
        brand: product ? product.brand : "",
      };
    });
    return json(res, 200, {
      ok: true,
      analytics: Object.assign({}, analytics, { topViewedProducts }),
      commerce,
      process: {
        pos: publicPosStatus(akbankConfig),
        siteBaseUrl: SITE_BASE_URL,
        smtpConfigured: smtpConfigured(process.env),
      },
      leadsNote:
        "Talep sayısı, iletişim formunun sunucuya kaydedildiği anları sayar. Gelen kutusu teslimatı ayrıdır.",
      catalog: manualCatalogCounts(),
      catalogSummary: buildAdminCatalogSummary({
        manualProducts: loadProducts(),
        supplierProducts: supplierManager.listProducts(),
        storefrontCount: storefrontIndex(false).compactAll.length,
        slots: supplierManager.listSlots(),
      }),
    });
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/status") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const includeFeed = requestUrl.searchParams.get("feed") === "1";
    const slots = supplierManager.listSlots();
    const primary = slots[0] || {};
    const yesterdayXmlAlert = xmlFetchDigest.getYesterdayAlert(new Date());
    return json(res, 200, {
      slots,
      status: slots[0],
      schedule: primary.schedule || scheduleSummary(),
      nextScheduled: primary.nextScheduled || getNextScheduledAt(new Date()),
      yesterdayXmlAlert,
      opsHealth: resolveOpsHealth({
        slots,
        yesterdayAlert: yesterdayXmlAlert,
        pos: publicPosStatus(akbankConfig),
      }),
      feed: includeFeed ? akakceFeedFullSummary() : akakceFeedPublicMeta(),
    });
  }

  if (req.method === "POST" && urlPath === "/api/admin/supplier/xml-alert/dismiss") {
    try {
      const body = JSON.parse((await readBody(req, 4 * 1024)).toString("utf8") || "{}");
      xmlFetchDigest.dismissAlert(body.date);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { ok: false, error: (err && err.message) || "Uyarı kapatılamadı." });
    }
  }

  if (req.method === "PUT" && urlPath === "/api/admin/supplier/config") {
    if (!requireOwner(req, res)) return;
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const config = await supplierManager.saveConfig(body.slotId || "supplier-1", {
        url: body.url,
        name: body.name,
      });
      return json(res, 200, { ok: true, config });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Bağlantı kaydedilemedi" });
    }
  }

  if (req.method === "POST" && urlPath === "/api/admin/supplier/publish") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const result = await publishSupplierSlot({
        manager: supplierManager,
        categoryStore,
        slotId: body.slotId || "supplier-1",
        root: DATA_ROOT,
      });
      invalidateStorefrontCatalog();
      akakceFeedSummaryMemo = { products: null, summary: null };
      warmStorefrontCatalog();
      scheduleAkakceImageMirror();
      scheduleAkakceFeedSummaryWarm();
      const slots = supplierManager.listSlots();
      return json(res, 200, {
        ok: true,
        result,
        slots,
        feedCount: null,
        feedExcludedCount: null,
      });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Kaynak yayınlanamadı" });
    }
  }

  if (req.method === "POST" && urlPath === "/api/admin/supplier/refresh") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const result = await supplierManager.refresh(body.slotId || "supplier-1");
      // Category sync + catalog warm must not hold the HTTP response (blocks all panel APIs).
      enqueueXmlCategorySync(result.slotId);
      scheduleAkakceImageMirror();
      const slots = supplierManager.listSlots();
      return json(res, 200, {
        ok: true,
        result,
        slots,
        status: slots.find((slot) => slot.id === result.slotId) || slots[0],
        categorySyncQueued: true,
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: err.message || "XML alınamadı" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/products") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const slots = supplierManager.listSlots();
    const categories = loadCategories();
    const feedReadyOf = (item) =>
      analyzeSupplierFeedIssues(item, { siteBaseUrl: SITE_BASE_URL, categories }).length === 0;
    const status = requestUrl.searchParams.get("status") || "";
    // "feedmissing" = in stock, published, Export badge "Eksik".
    const feedMissing = status === "feedmissing";
    const queried = supplierManager.queryProducts({
      q: requestUrl.searchParams.get("q") || "",
      status: feedMissing ? "stock" : status,
      match: feedMissing ? (item) => item.active === true && !feedReadyOf(item) : null,
      reason: requestUrl.searchParams.get("reason") || "",
      slot: requestUrl.searchParams.get("slot") || "",
      page: requestUrl.searchParams.get("page") || 1,
      limit: requestUrl.searchParams.get("limit") || 50,
      sort: requestUrl.searchParams.get("sort") || "",
      dir: requestUrl.searchParams.get("dir") || "",
      sortValues: {
        // Mirrors the Export badge: Eksik (0) < "—" (1) < Hazır (2).
        feed: (item) => (feedReadyOf(item) ? 2 : item.active ? 0 : 1),
      },
    });
    return json(res, 200, {
      products: enrichSupplierProducts(queried.products, categories),
      total: queried.total,
      page: queried.page,
      limit: queried.limit,
      totalPages: queried.totalPages,
      catalogCount: queried.catalogCount,
      activeCount: queried.activeCount,
      unlistedCount: queried.unlistedCount,
      menuMissingCount: queried.menuMissingCount,
      slots,
      status: slots[0],
    });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/supplier/settings") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const settings = supplierManager.setSettings(body.slotId || "supplier-1", {
        globalMarginPercent: body.globalMarginPercent,
        criticalStockQty: body.criticalStockQty,
      });
      invalidateStorefrontCatalog();
      warmStorefrontCatalog();
      return json(res, 200, {
        ok: true,
        settings,
      });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Ayar kaydedilemedi" });
    }
  }

  if (req.method === "PATCH" && urlPath === "/api/admin/supplier/products") {
    try {
      const body = JSON.parse((await readBody(req, 512 * 1024)).toString("utf8") || "{}");
      const updates = (Array.isArray(body.updates) ? body.updates.slice(0, 5000) : []).map(
        markPanelCategoryChoice
      );
      if (!updates.length) {
        return json(res, 422, { ok: false, error: "Güncellenecek ürün seçilmedi." });
      }
      supplierManager.updateProducts(updates);
      invalidateStorefrontCatalog();
      warmStorefrontCatalog();
      scheduleAkakceFeedSummaryWarm();
      // A product newly placed in the menu has never been a storefront candidate, so its
      // images were never mirrored; without this it stays hidden until the next XML read.
      if (updates.some((row) => row && (row.siteCategoryManual === true || row.active === true))) {
        scheduleAkakceImageMirror();
      }
      return json(res, 200, {
        ok: true,
        feedCount: null,
        feedExcludedCount: null,
      });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Ürünler güncellenemedi" });
    }
  }

  if (req.method === "PUT" && urlPath === "/api/admin/products") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const list = Array.isArray(body.products) ? body.products : [];
      const seen = new Set();
      const normalized = [];
      for (const item of list) {
        if (!isAllowedVatPercent(item && item.vatPercent)) {
          const label = String((item && (item.name || item.id)) || "Ürün");
          return json(res, 422, {
            ok: false,
            error: label + ": KDV oranı zorunludur (1, 8, 10 veya 20).",
          });
        }
        const p = normalizeProduct(item);
        if (!p.id || !p.name || !p.brand) continue;
        if (seen.has(p.id)) continue;
        if (p.images.length < MIN_PRODUCT_IMAGES) {
          return json(res, 422, {
            ok: false,
            error:
              p.name +
              ": en az " +
              MIN_PRODUCT_IMAGES +
              " görsel zorunlu (şu an " +
              p.images.length +
              ").",
          });
        }
        const missingFields = validateManualFeedFields(p);
        if (missingFields.length) {
          return json(res, 422, {
            ok: false,
            error:
              p.name +
              ": feed için zorunlu alanlar eksik — " +
              missingFields.join(", "),
          });
        }
        seen.add(p.id);
        normalized.push(p);
      }
      saveProducts(normalized);
      return json(res, 200, { ok: true, count: normalized.length, products: normalized });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || "Kayıt başarısız" });
    }
  }

  if (req.method === "POST" && urlPath === "/api/admin/upload") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const dataUrl = String(body.dataUrl || "");
      const m = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m) return json(res, 400, { ok: false, error: "Geçersiz görsel" });
      const buf = Buffer.from(m[3], "base64");
      if (buf.length > 4 * 1024 * 1024) {
        return json(res, 400, { ok: false, error: "Görsel en fazla 4 MB olabilir" });
      }
      const detected = imageExtensionFromBytes(buf);
      const declared = m[2] === "jpeg" ? "jpg" : m[2];
      if (!detected || detected !== declared) {
        return json(res, 400, { ok: false, error: "Görsel içeriği bildirilen türle uyuşmuyor." });
      }
      const ext = detected;
      const name =
        slugify(body.name || "urun") +
        "-" +
        Date.now().toString(36) +
        "." +
        ext;
      const out = path.join(PRODUCTS_IMG_DIR, name);
      fs.writeFileSync(out, buf);
      return json(res, 200, { ok: true, url: "/assets/img/products/" + name });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || "Yükleme başarısız" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/calendar") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const from = requestUrl.searchParams.get("from");
    const to = requestUrl.searchParams.get("to");
    return json(res, 200, { ok: true, entries: calendarStore.list(from, to) });
  }

  if (req.method === "POST" && urlPath === "/api/admin/calendar") {
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const entry = calendarStore.create(body);
      let mailSent = false;
      let mailError = null;
      if (entry.type === "reminder" && entry.notifyEmail) {
        try {
          await sendCalendarReminderMail(entry, "created");
          mailSent = true;
        } catch (err) {
          mailError = (err && err.message) || "E-posta gönderilemedi";
          console.error("Takvim oluşturma e-postası gönderilemedi:", mailError);
        }
      }
      return json(res, 200, { ok: true, entry, mailSent, mailError });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || "Kayıt başarısız" });
    }
  }

  const calendarEntryMatch = /^\/api\/admin\/calendar\/([a-f0-9]{16})$/.exec(urlPath);
  if (calendarEntryMatch) {
    const entryId = calendarEntryMatch[1];
    if (req.method === "PUT") {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
        const entry = calendarStore.update(entryId, body);
        if (!entry) return json(res, 404, { ok: false, error: "Kayıt bulunamadı" });
        return json(res, 200, { ok: true, entry });
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message || "Güncelleme başarısız" });
      }
    }
    if (req.method === "DELETE") {
      const removed = calendarStore.remove(entryId);
      if (!removed) return json(res, 404, { ok: false, error: "Kayıt bulunamadı" });
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { ok: false, error: "API bulunamadı" });
}

function permanentRedirect(res, location) {
  res.writeHead(
    301,
    securityHeaders({
      Location: location,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    })
  );
  res.end("Moved Permanently");
}

function serveNotFound(res, method) {
  const notFound = path.join(ROOT, "404.html");
  fs.readFile(notFound, (e, page) => {
    res.writeHead(404, securityHeaders({ "Content-Type": MIME[".html"] }));
    if (method === "HEAD") return res.end();
    res.end(e ? "404 Not Found" : page);
  });
}

function sendMirroredCatalogImage(res, filePath, method) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return serveNotFound(res, method);
  }
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) return serveNotFound(res, method);
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=604800",
    };
    res.writeHead(200, securityHeaders(headers));
    if (method === "HEAD") return res.end();
    res.end(data);
  });
}

function sendFile(res, filePath, method) {
  const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
  if (isBlocked(rel) || rel.split("/").some((p) => p.startsWith("."))) {
    return serveNotFound(res, method);
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return serveNotFound(res, method);
  }
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) return serveNotFound(res, method);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (rel === "admin.html") {
      headers["X-Robots-Tag"] = "noindex, nofollow";
      headers["Cache-Control"] = "no-store";
    } else if ([".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff2", ".ico"].includes(ext)) {
      headers["Cache-Control"] = "public, max-age=3600";
    }
    res.writeHead(200, securityHeaders(headers));
    if (method === "HEAD") return res.end();
    res.end(data);
  });
}

function catalogBootstrapSnapshotName(params) {
  if (params.get("marka") || params.get("minFiyat") || params.get("maxFiyat")) return null;
  return listingSnapshotFileName({
    kategori: params.get("kategori") || "",
    ara: params.get("ara") || "",
    alt: params.get("alt") || "",
  });
}

function readCatalogBootstrapSnapshot(requestUrl) {
  const name = catalogBootstrapSnapshotName(requestUrl.searchParams);
  if (!name) return null;
  const file = path.join(CATALOG_BOOTSTRAP_DIR, name);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.products)) return null;
    if (
      data.products.length &&
      data.products.every((item) => item && item.urlPath)
    ) {
      return data;
    }
    const routeIndex = storefrontIndex(false).routeIndex;
    return enrichCatalogSnapshotProducts(data, routeIndex);
  } catch (_) {
    return null;
  }
}

function writeBootstrapSnapshotFile(name, payload) {
  fs.mkdirSync(CATALOG_BOOTSTRAP_DIR, { recursive: true });
  atomicWriteJson(path.join(CATALOG_BOOTSTRAP_DIR, name), {
    products: payload.products,
    total: payload.total,
    page: payload.page,
    limit: payload.limit,
    totalPages: payload.totalPages,
    facets: payload.facets || null,
  });
}

function normalizeCatalogBootstrapRequestUrl(requestUrl) {
  const params = requestUrl.searchParams;
  const pathParam = String(params.get("path") || "").trim();
  if (!pathParam || params.get("kategori") || params.get("ara") || params.get("alt")) {
    return requestUrl;
  }
  const segments = pathParam.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments[0] === "urunler") segments.shift();
  if (segments[0]) params.set("kategori", segments[0]);
  if (segments[1]) params.set("ara", segments[1]);
  if (segments[2]) params.set("alt", segments[2]);
  params.delete("path");
  return requestUrl;
}

function catalogBootstrapPayload(requestUrl) {
  const params = requestUrl.searchParams;
  if (
    params.get("q") ||
    params.get("sirala") ||
    params.get("marka") ||
    params.get("minFiyat") ||
    params.get("maxFiyat") ||
    params.get("ozellik")
  ) {
    return null;
  }
  const fromDisk = readCatalogBootstrapSnapshot(requestUrl);
  if (fromDisk) return fromDisk;
  const memo = storefrontCatalogMemo.active;
  if (!memo || !memo.index) return null;
  const payload = queryPublicCatalogIndexed(memo.index, {
    kategori: params.get("kategori") || "",
    ara: params.get("ara") || "",
    alt: params.get("alt") || "",
    page: 1,
    limit: CATALOG_BOOTSTRAP_LIMIT,
  });
  const name = catalogBootstrapSnapshotName(params);
  if (name) {
    try {
      writeBootstrapSnapshotFile(name, payload);
    } catch (_) {}
  }
  return {
    products: payload.products,
    total: payload.total,
    page: payload.page,
    limit: payload.limit,
    totalPages: payload.totalPages,
    facets: payload.facets || null,
  };
}

const CATALOG_BOOTSTRAP_SCRIPT_ANCHOR =
  /<script defer src="\/assets\/js\/cart\.js"><\/script>/;

function injectCatalogBootstrapHtml(html, bootstrap) {
  if (!bootstrap || !CATALOG_BOOTSTRAP_SCRIPT_ANCHOR.test(html)) return html;
  const json = JSON.stringify(bootstrap).replace(/</g, "\\u003c");
  const tag =
    '<script type="application/json" id="patygo-catalog-bootstrap">' +
    json +
    "</script>\n  ";
  return html.replace(
    CATALOG_BOOTSTRAP_SCRIPT_ANCHOR,
    tag + '<script defer src="/assets/js/cart.js"></script>'
  );
}

const productHtmlCache = { index: null, shellMtime: 0, shell: "", pages: new Map() };
const PRODUCT_HTML_CACHE_MAX = 3000;

function sendProductHtml(res, req, shellPath, urlPath, warmIndex) {
  let stat;
  try {
    stat = fs.statSync(shellPath);
  } catch (_) {
    return serveNotFound(res, req.method);
  }
  if (productHtmlCache.index !== warmIndex || productHtmlCache.shellMtime !== stat.mtimeMs) {
    productHtmlCache.index = warmIndex;
    productHtmlCache.shellMtime = stat.mtimeMs;
    productHtmlCache.shell = fs.readFileSync(shellPath, "utf8");
    productHtmlCache.pages.clear();
  }
  const key = urlPath.replace(/\/+$/, "");
  let page = productHtmlCache.pages.get(key);
  if (!page) {
    const found = lookupPublicProductsByPath(key);
    const product = found && Array.isArray(found.products) ? found.products[0] : null;
    page = !product
      ? { status: 404, html: renderMissingProductHtml(productHtmlCache.shell) }
      : product.soldOut
        ? { status: 200, html: renderSoldOutProductHtml(productHtmlCache.shell, product) }
        : { status: 200, html: renderProductHtml(productHtmlCache.shell, product, reviewDataFor(product.id)) };
    if (productHtmlCache.pages.size >= PRODUCT_HTML_CACHE_MAX) productHtmlCache.pages.clear();
    productHtmlCache.pages.set(key, page);
  }
  res.writeHead(
    page.status,
    securityHeaders({
      "Content-Type": MIME[".html"],
      "Cache-Control": "public, max-age=60",
    })
  );
  if (req.method === "HEAD") return res.end();
  res.end(page.html);
}

function sendCatalogHtml(res, req, filePath, method) {
  const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
  if (isBlocked(rel) || rel.split("/").some((p) => p.startsWith("."))) {
    return serveNotFound(res, method);
  }
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) return serveNotFound(res, method);
    let html = data.toString("utf8");
    const requestUrl = new URL(req.url || "/urunler", `http://${req.headers.host || "localhost"}`);
    const pathCats = parseUrunlerPathname(requestUrl.pathname);
    if (pathCats && pathCats.parent && !requestUrl.searchParams.get("kategori")) {
      requestUrl.searchParams.set("kategori", pathCats.parent);
      if (pathCats.mid) requestUrl.searchParams.set("ara", pathCats.mid);
      if (pathCats.child) requestUrl.searchParams.set("alt", pathCats.child);
    }
    const listingPage = Math.min(Math.floor(Number(requestUrl.searchParams.get("sayfa")) || 1), 9999);
    // Embedded bootstrap is page 1; ?sayfa=N loads its own page client-side.
    const bootstrap = listingPage > 1 ? null : catalogBootstrapPayload(requestUrl);
    html = injectCatalogBootstrapHtml(html, bootstrap);
    let status = 200;
    if (pathCats && pathCats.parent) {
      const canonPath =
        categoryQueryToPath(requestUrl.searchParams) || "/urunler";
      const categories = categoryStore.list();
      const rendered = renderCategoryHtml(html, categories, pathCats, canonPath);
      if (rendered) {
        html = rendered;
      } else if (Array.isArray(categories) && categories.length) {
        status = 404;
        html = renderMissingCategoryHtml(html);
      }
    }
    if (status === 200) html = withListingPage(html, listingPage);
    const headers = {
      "Content-Type": MIME[".html"],
      "Cache-Control": "public, max-age=0, must-revalidate",
    };
    res.writeHead(status, securityHeaders(headers));
    if (method === "HEAD") return res.end();
    res.end(html);
  });
}

function serveStatic(req, res, pathname) {
  let filePath = safeJoin(ROOT, pathname === "/" ? "/index.html" : pathname);
  if (!filePath) {
    res.writeHead(403, securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    return res.end("403 Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      return sendFile(res, filePath, req.method);
    }
    if (!err && stat.isFile()) {
      return sendFile(res, filePath, req.method);
    }

    // Uzantısız temiz URL: /urunler → urunler.html
    if (!path.extname(pathname) && pathname !== "/") {
      const htmlPath = safeJoin(ROOT, pathname + ".html");
      if (htmlPath && fs.existsSync(htmlPath)) {
        if (pathname === "/urunler" || pathname.endsWith("/urunler")) {
          return sendCatalogHtml(res, req, htmlPath, req.method);
        }
        return sendFile(res, htmlPath, req.method);
      }
    }

    return serveNotFound(res, req.method);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const urlPath = requestUrl.pathname;
  const search = requestUrl.search || "";

  if (urlPath.startsWith("/api/")) {
    try {
      await handleApi(req, res, urlPath);
    } catch (err) {
      json(res, 500, { ok: false, error: "Sunucu hatası" });
    }
    return;
  }

  if (req.method === "POST" && (urlPath === "/admin" || urlPath === "/admin.html")) {
    const htmlPath = safeJoin(ROOT, "/admin.html");
    if (htmlPath) return sendFile(res, htmlPath, "GET");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, securityHeaders({ Allow: "GET, HEAD" }));
    return res.end("405 Method Not Allowed");
  }

  if (urlPath === "/assets/data/categories.json") {
    return json(res, 200, ensureCategoriesBootstrapSnapshot(), {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
    });
  }

  if (urlPath.startsWith("/listing/")) {
    const name = urlPath.slice("/listing/".length);
    if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) {
      return serveNotFound(res, req.method);
    }
    if (name === "categories.json") {
      const payload = ensureCategoriesBootstrapSnapshot();
      const catPath = path.resolve(CATALOG_BOOTSTRAP_DIR, name);
      const rootDir = path.resolve(CATALOG_BOOTSTRAP_DIR);
      if (!catPath.startsWith(rootDir + path.sep) || !fs.existsSync(catPath)) {
        return json(res, 200, payload, {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
        });
      }
    }
    const filePath = path.resolve(CATALOG_BOOTSTRAP_DIR, name);
    const rootDir = path.resolve(CATALOG_BOOTSTRAP_DIR);
    if (!filePath.startsWith(rootDir + path.sep)) {
      return serveNotFound(res, req.method);
    }
    if (!fs.existsSync(filePath)) {
      return serveNotFound(res, req.method);
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) return serveNotFound(res, req.method);
      res.writeHead(
        200,
        securityHeaders({
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
        })
      );
      if (req.method === "HEAD") return res.end();
      res.end(data);
    });
    return;
  }

  // SEO: kategori query → path (/urunler?kategori=… → /urunler/…)
  if (urlPath === "/urunler" || urlPath === "/urunler/") {
    const pathTarget = categoryQueryToPath(requestUrl.searchParams);
    if (pathTarget) {
      const next = new URL(pathTarget, "https://patygoteknoloji.com");
      ["marka", "minFiyat", "maxFiyat", "q"].forEach((key) => {
        const value = requestUrl.searchParams.get(key);
        if (value) next.searchParams.set(key, value);
      });
      return permanentRedirect(res, next.pathname + next.search);
    }
  }

  // SEO: /urunler/ana[/ara[/alt]] listing pages
  if (/^\/urunler\/[^/]+/i.test(urlPath)) {
    if (urlPath.endsWith("/")) {
      return permanentRedirect(res, urlPath.replace(/\/+$/, "") + search);
    }
    const htmlPath = safeJoin(ROOT, "/urunler.html");
    if (htmlPath) return sendCatalogHtml(res, req, htmlPath, req.method);
  }

  // SEO: /sayfa.html → /sayfa (301)
  if (/\.html$/i.test(urlPath)) {
    const clean =
      urlPath.toLowerCase() === "/index.html" ? "/" + search : urlPath.replace(/\.html$/i, "") + search;
    return permanentRedirect(res, clean);
  }

  // /urunler/ → /urunler
  if (urlPath.length > 1 && urlPath.endsWith("/")) {
    const trimmed = urlPath.replace(/\/+$/, "");
    const htmlPath = safeJoin(ROOT, trimmed + ".html");
    if (htmlPath && fs.existsSync(htmlPath)) {
      return permanentRedirect(res, trimmed + search);
    }
  }

  if (urlPath.startsWith("/media/catalog/")) {
    const rel = urlPath.slice("/media/catalog/".length).replace(/\\/g, "/");
    if (!rel || rel.includes("..")) {
      return serveNotFound(res, req.method);
    }
    const mediaRoot = path.join(DATA_ROOT, ".runtime", "media", "catalog");
    const filePath = path.resolve(mediaRoot, rel.split("/").join(path.sep));
    if (!filePath.startsWith(mediaRoot + path.sep) && filePath !== mediaRoot) {
      return serveNotFound(res, req.method);
    }
    return sendMirroredCatalogImage(res, filePath, req.method);
  }

  // SEO: /urun-detay?id= → /{kategori}/{slug}
  if (urlPath === "/urun-detay" || urlPath === "/urun-detay/") {
    const legacyId = String(requestUrl.searchParams.get("id") || "").trim();
    if (legacyId) {
      const routeIndex = storefrontIndex(false).routeIndex;
      const canonical = routeIndex && routeIndex.byId[legacyId];
      if (canonical) {
        return permanentRedirect(res, canonical);
      }
    }
  }

  // SEO: bare ANA slug /bilgisayar-tablet → /urunler/bilgisayar-tablet
  // Use list() (not publicList): publicList hides empty parents when catalog is cold.
  if (/^\/[a-z0-9-]+$/i.test(urlPath)) {
    const slug = urlPath.slice(1).toLowerCase();
    const reserved = new Set([
      "admin",
      "urunler",
      "sepet",
      "odeme",
      "kurumsal",
      "hizmetler",
      "markalar",
      "iletisim",
      "kvkk",
      "gizlilik",
      "cerez",
      "robots.txt",
      "sitemap",
      "sitemap.xml",
      "favicon.ico",
    ]);
    if (!reserved.has(slug) && !slug.includes(".")) {
      const parent = categoryStore
        .list()
        .find((row) => row && row.slug === slug && row.active !== false);
      if (parent) {
        return permanentRedirect(res, categoryHref(parent.slug) + search);
      }
    }
  }

  if (urlPath === "/sitemap.xml" || urlPath === "/sitemap") {
    const xml = storefrontSitemapXml();
    res.writeHead(
      200,
      securityHeaders({
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      })
    );
    if (req.method === "HEAD") return res.end();
    return res.end(xml);
  }

  const productRoute = parseProductRoutePath(urlPath);
  if (productRoute) {
    // Warm index only: a cold HTML request must not wait for the catalog build.
    const warmIndex = storefrontCatalogMemo.active && storefrontCatalogMemo.active.index;
    if (warmIndex) {
      const legacyTarget = resolveLegacyProductPath(
        warmIndex.routeIndex,
        productRoute.segment,
        productRoute.slug
      );
      if (legacyTarget && legacyTarget !== urlPath) {
        return permanentRedirect(res, legacyTarget + search);
      }
    }
    const htmlPath = safeJoin(ROOT, "/urun-detay.html");
    const accept = String(req.headers.accept || "");
    const wantsHtml =
      !accept || /\btext\/html\b/i.test(accept) || accept.includes("*/*");
    // Warm index: crawler-ready head + h1; cold: disk shell (client resolves via /listing).
    if (wantsHtml && htmlPath && fs.existsSync(htmlPath)) {
      if (warmIndex) return sendProductHtml(res, req, htmlPath, urlPath, warmIndex);
      return sendFile(res, htmlPath, req.method);
    }
    const routeIndex = storefrontIndex(false).routeIndex;
    const productId = resolveProductIdFromRoute(
      routeIndex,
      productRoute.segment,
      productRoute.slug
    );
    if (!productId && !lookupSoldOutProductByPath(productRoute.segment, productRoute.slug)) {
      return serveNotFound(res, req.method);
    }
    if (htmlPath && fs.existsSync(htmlPath)) {
      return sendFile(res, htmlPath, req.method);
    }
    return serveNotFound(res, req.method);
  }

  serveStatic(req, res, urlPath);
});

server.listen(PORT, BIND_HOST, () => {
  console.log("\n  Patygo Teknoloji — yerel sunucu");
  console.log("  ----------------------------------------");
  console.log(`  Site  : http://${BIND_HOST === "0.0.0.0" ? "127.0.0.1" : BIND_HOST}:${PORT}`);
  console.log(`  Site  : http://localhost:${PORT}`);
  console.log(`  Admin : http://127.0.0.1:${PORT}/admin`);
  console.log(`  Şifre : ADMIN_PASSWORD (varsayılan: patygo-admin)`);
  console.log(
    `  POS   : ${
      akbankConfig.enabled
        ? "Akbank SecurePay hazır (" + (akbankConfig.testMode ? "TEST" : "CANLI") + ")"
        : "yapılandırılmadı (.env AKBANK_* )"
    }`
  );
  console.log("");
});

async function processCalendarReminderEmails() {
  const due = calendarStore.dueForEmail(new Date(), 15);
  for (const entry of due) {
    try {
      if (!entry.notifyEmail) continue;
      await sendCalendarReminderMail(entry, "due");
      calendarStore.markEmailNotified(entry.id);
    } catch (err) {
      console.error("Takvim e-posta hatırlatıcısı gönderilemedi:", err.message || err);
    }
  }
}

const calendarMailTimer = setInterval(() => {
  processCalendarReminderEmails().catch(() => {});
}, 60 * 1000);
if (typeof calendarMailTimer.unref === "function") calendarMailTimer.unref();
setTimeout(() => {
  processCalendarReminderEmails().catch(() => {});
}, 8 * 1000);

const retentionScheduler = createRetentionScheduler(DATA_ROOT, {
  contactStore,
  intervalMs: 60 * 60 * 1000,
});
retentionScheduler.start();

const invoiceSyncTimer = setInterval(() => {
  syncPendingInvoiceNumbers().catch(() => {});
}, INVOICE_SYNC_INTERVAL_MS);
if (typeof invoiceSyncTimer.unref === "function") invoiceSyncTimer.unref();
const invoiceSyncStartTimer = setTimeout(() => {
  syncPendingInvoiceNumbers().catch(() => {});
}, 90 * 1000);
if (typeof invoiceSyncStartTimer.unref === "function") invoiceSyncStartTimer.unref();

const priceAlertTimer = setInterval(() => {
  runPriceAlertCheck().catch(() => {});
}, 60 * 60 * 1000);
if (typeof priceAlertTimer.unref === "function") priceAlertTimer.unref();

const supplierScheduler = createSupplierScheduler({
  manager: supplierManager,
  digest: xmlFetchDigest,
  afterRefresh: (slotId) => {
    enqueueXmlCategorySync(slotId);
    scheduleAkakceImageMirror();
    const alertTimer = setTimeout(() => {
      runPriceAlertCheck().catch(() => {});
    }, 3 * 60 * 1000);
    if (typeof alertTimer.unref === "function") alertTimer.unref();
  },
  log: (...parts) => console.log(...parts),
  logError: (...parts) => console.error(...parts),
});
supplierScheduler.start();
setImmediate(() => {
  try {
    ensureListingTreeSnapshotFiles();
  } catch (_) {}
  // Worker-parse supplier JSON, hydrate in yielding chunks, then build the storefront index so
  // the first visitor after a restart does not pay the cold build on the request thread.
  if (supplierManager && typeof supplierManager.preloadCachesAsync === "function") {
    const startedAt = Date.now();
    supplierManager
      .preloadCachesAsync()
      .then(() => {
        warmStorefrontCatalog();
        console.log("Katalog ön ısıtma: tedarikçi verisi hazır", Date.now() - startedAt, "ms");
      })
      .catch((err) => {
        console.warn("Tedarikçi ön yükleme atlandı:", err && err.message ? err.message : err);
      });
  }
  scheduleStartupCatalogWarm();
  // Do not hammer image mirror on every process restart when the index is already fresh.
  scheduleAkakceImageMirror({ delayMs: 180000, skipIfRecent: true });
  scheduleThumbnailBackfill(240000);
});
const xmlCategorySyncTimer = setTimeout(() => {
  if (!bootstrapSnapshotsReady()) enqueueXmlCategorySync();
}, 15000);
if (typeof xmlCategorySyncTimer.unref === "function") xmlCategorySyncTimer.unref();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  HATA: ${PORT} portu kullanımda. node server.js 5174\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
