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
const { publishSupplierSlot, syncXmlSiteCategoriesAsync } = require("./lib/supplier-site");
const { createSupplierScheduler, getNextScheduledAt, scheduleSummary } = require("./lib/supplier-schedule");
const { analyzeAkakceProducts, analyzeSupplierFeedIssues, buildAkakceFeedSummary, buildAkakceXml } = require("./lib/akakce");
const { loadMirrorIndex, mirrorAkakceCatalogImages, mirrorPaths } = require("./lib/product-image-mirror");
const {
  mergeCatalogProducts,
  queryPublicCatalog,
  queryPublicCatalogIndexed,
  buildStorefrontIndex,
  buildStorefrontLeafKeys,
  homeFeaturedCatalog,
  listingSnapshotFileName,
  listingSnapshotJobs,
} = require("./lib/catalog");
const {
  createCategoryStore,
  setCategoryListLoader,
  setPublicCategoryLeafKeysLoader,
} = require("./lib/categories");
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
  publicPosStatus,
  formatAmount,
} = require("./lib/akbank-pos");
const { createOrderStore, ORDER_STATUSES } = require("./lib/orders");
const { createCalendarStore } = require("./lib/calendar");
const { createAdminUserStore } = require("./lib/admin-users");
const { createConsentStore } = require("./lib/consent");
const { createAuditStore } = require("./lib/audit");
const { resolveSiteBaseUrl } = require("./lib/site-url");
const {
  SHIPPING_CARRIERS,
  NOTIFY_STATUSES,
  sendOrderStatusMail,
} = require("./lib/order-mail");
const {
  createContactStore,
  normalizeContactPayload,
  validateContactPayload,
  deliverContactMail,
  deliverSimpleMail,
  smtpConfigured,
} = require("./lib/contact");
const { lookupCheckoutProductsByIds } = require("./lib/checkout-products");
const { imageExtensionFromBytes } = require("./lib/image-bytes");
const {
  createAdminSecurityStore,
  updateEnvAdminPassword,
  MIN_ADMIN_PASSWORD_LENGTH,
} = require("./lib/admin-security");
const { createXmlFetchDigestStore } = require("./lib/xml-fetch-digest");
const { resolveOpsHealth } = require("./lib/ops-health");

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
const analyticsStore = createAnalyticsStore(DATA_ROOT);
const orderStore = createOrderStore(DATA_ROOT);
const calendarStore = createCalendarStore(DATA_ROOT);
const categoryStore = createCategoryStore(DATA_ROOT);
setCategoryListLoader(() => categoryStore.list());
const adminUserStore = createAdminUserStore(DATA_ROOT);
const consentStore = createConsentStore(DATA_ROOT);
const auditStore = createAuditStore(DATA_ROOT);
const contactStore = createContactStore(DATA_ROOT);
const akbankConfig = createAkbankConfig(process.env);
const paymentStartAttempts = new Map(); // IP -> { count, resetAt }
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
const sessions = new Map(); // token -> expiresAt

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

function buildCheckoutOrder(body) {
  const rawItems = Array.isArray(body && body.items) ? body.items : [];
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
  const total = Math.round((subtotal + vat) * 100) / 100;
  const customer = (body && body.customer) || {};
  const name = String(customer.name || "").trim().slice(0, 120);
  const email = String(customer.email || "").trim().slice(0, 120);
  const phone = String(customer.phone || "").trim().slice(0, 40);
  if (!name || !email || !phone) throw new Error("Alıcı bilgileri eksik.");
  if (!isValidEmail(email)) throw new Error("Geçerli bir e-posta girin.");
  if (!body.contractsAccepted) throw new Error("Sözleşme onayları gerekli.");
  if (!body.kvkkAccepted) throw new Error("KVKK aydınlatma onayı gerekli.");

  const billingAddress = String(customer.billingAddress || "").trim().slice(0, 400);
  const shippingAddress = String(customer.shippingAddress || billingAddress).trim().slice(0, 400);
  if (!billingAddress) throw new Error("Fatura adresi gerekli.");

  return {
    id: makeOrderId(),
    accessToken: makeOrderAccessToken(),
    items,
    subtotal,
    vat,
    total,
    currency: "TRY",
    customer: {
      name,
      company: String(customer.company || "").trim().slice(0, 120),
      email,
      phone,
      taxId: String(customer.taxId || "").trim().slice(0, 40),
      note: String(customer.note || "").trim().slice(0, 500),
      billingAddress,
      shippingAddress,
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
  };
}

const storefrontCatalogMemo = { active: null, all: null };
let akakceXmlMemo = null;
const CATALOG_BOOTSTRAP_LIMIT = 20;
const CATALOG_BOOTSTRAP_DIR = path.join(DATA_ROOT, ".runtime", "catalog-bootstrap");

function invalidateStorefrontCatalog() {
  storefrontCatalogMemo.active = null;
  storefrontCatalogMemo.all = null;
  akakceXmlMemo = null;
}

function mergedProducts(includeInactiveManual) {
  const key = includeInactiveManual ? "all" : "active";
  const hit = storefrontCatalogMemo[key];
  if (hit && Array.isArray(hit.products)) return hit.products;
  const products = mergeCatalogProducts(loadProducts(), supplierManager.listProducts(), {
    includeInactiveManual,
    normalizeProduct,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
  });
  storefrontCatalogMemo[key] = { products, index: null };
  return products;
}

setPublicCategoryLeafKeysLoader(() => buildStorefrontLeafKeys(storefrontIndex(false)));

function storefrontIndex(includeInactiveManual) {
  const key = includeInactiveManual ? "all" : "active";
  const products = mergedProducts(includeInactiveManual);
  const memo = storefrontCatalogMemo[key];
  if (!memo.index) memo.index = buildStorefrontIndex(products);
  return memo.index;
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
  return queryPublicCatalog(
    mergeCatalogProducts(manuals, suppliers, {
      includeInactiveManual: false,
      normalizeProduct,
      categoryDefaults: CATEGORY_FEED_DEFAULTS,
    }),
    { id: productId, ids: idsRaw }
  );
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

function bootstrapSnapshotsReady() {
  const file = path.join(CATALOG_BOOTSTRAP_DIR, "all.json");
  if (!fs.existsSync(file)) return false;
  try {
    const stat = fs.statSync(file);
    return stat.size > 100;
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
  const jobs = listingSnapshotJobs({ compactAll: [], byParent: {} }, categoryStore.list());
  jobs.forEach((job) => {
    if (!job.file || !job.file.includes("__")) return;
    const file = path.join(CATALOG_BOOTSTRAP_DIR, job.file);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 20) return;
      atomicWriteJson(file, emptyListingSnapshotPayload());
    } catch (_) {}
  });
}

function writeCatalogBootstrapSnapshots() {
  const index = storefrontIndex(false);
  fs.mkdirSync(CATALOG_BOOTSTRAP_DIR, { recursive: true });
  const jobs = listingSnapshotJobs(index, categoryStore.publicList());
  const writeJob = (job) => {
    const payload = queryPublicCatalogIndexed(
      index,
      Object.assign({ page: 1, limit: CATALOG_BOOTSTRAP_LIMIT }, job.params)
    );
    atomicWriteJson(path.join(CATALOG_BOOTSTRAP_DIR, job.file), {
      products: payload.products,
      total: payload.total,
      page: payload.page,
      limit: payload.limit,
      totalPages: payload.totalPages,
      facets: payload.facets || null,
    });
  };
  try {
    atomicWriteJson(path.join(CATALOG_BOOTSTRAP_DIR, "categories.json"), {
      version: 5,
      categories: categoryStore.publicList(),
    });
  } catch (_) {}
  let offset = 0;
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

function storefrontAkakceXml() {
  const products = mergedProducts(false);
  const mirrorIndex = loadMirrorIndex(DATA_ROOT);
  const mirrorStamp = akakceMirrorIndexStamp();
  if (
    akakceXmlMemo &&
    akakceXmlMemo.products === products &&
    akakceXmlMemo.mirrorStamp === mirrorStamp
  ) {
    return akakceXmlMemo.xml;
  }
  const xml = buildAkakceXml(products, {
    siteBaseUrl: SITE_BASE_URL,
    mirrorIndex,
  });
  akakceXmlMemo = { products, mirrorStamp, xml };
  return xml;
}

let akakceMirrorTimer = null;

function scheduleAkakceImageMirror() {
  if (akakceMirrorTimer) clearTimeout(akakceMirrorTimer);
  akakceMirrorTimer = setTimeout(() => {
    akakceMirrorTimer = null;
    const memo = storefrontCatalogMemo.active;
    const products =
      memo && Array.isArray(memo.products) && memo.products.length
        ? memo.products
        : mergedProducts(false);
    mirrorAkakceCatalogImages(products, {
      dataRoot: DATA_ROOT,
      siteBaseUrl: SITE_BASE_URL,
      logError: (message, source, detail) =>
        console.warn("Akakçe görsel aynası", source, detail || message),
    })
      .then(() => {
        invalidateStorefrontCatalog();
      })
      .catch((err) => {
        console.warn("Akakçe görsel aynası atlandı:", err.message || err);
      });
  }, 30000);
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

function enrichSupplierProducts(products) {
  return (products || []).map((product) => {
    const feedIssues = analyzeSupplierFeedIssues(product, { siteBaseUrl: SITE_BASE_URL });
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
  return buildAkakceFeedSummary(mergedProducts(false), {
    siteBaseUrl: SITE_BASE_URL,
    mirrorIndex: loadMirrorIndex(DATA_ROOT),
  });
}

function manualCatalogCounts() {
  const list = loadProducts();
  return {
    manualCount: list.length,
    manualActiveCount: list.filter((item) => item && item.active !== false).length,
  };
}

function getSession(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const raw = sessions.get(token);
  if (!raw) return null;
  const exp = typeof raw === "number" ? raw : raw.exp;
  if (!exp || Date.now() > exp) {
    sessions.delete(token);
    return null;
  }
  const next =
    typeof raw === "number"
      ? { exp: Date.now() + ADMIN_IDLE_MS, userId: null }
      : Object.assign({}, raw, { exp: Date.now() + ADMIN_IDLE_MS });
  sessions.set(token, next);
  return next;
}

function authOk(req) {
  return Boolean(getSession(req));
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
  if (session.mustChangePassword === false) return false;
  if (session.mustChangePassword === true) return true;
  return adminSecurityStore.shouldForcePasswordChange(getAdminPassword());
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
    return json(res, 200, publicPosStatus(akbankConfig));
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
      const paid = hashOk && amountOk && isPaymentSuccess(payload);
      const alreadyPaid = Boolean(order && (order.paymentTaken || order.paymentStatus === "paid"));

      // İmzasız GET/POST sipariş durumunu değiştiremez; tutarsız tutar da "ödendi" yazmaz.
      if (order && hashOk && !(alreadyPaid && !paid)) {
        orderStore.update(orderId, {
          paymentStatus: paid ? "paid" : "failed",
          paymentTaken: paid,
          status: paid ? "paid" : "payment_failed",
          bankResponse: {
            responseCode: String(payload.responseCode || "").slice(0, 40),
            responseMessage: String(payload.responseMessage || "").slice(0, 200),
            hashOk,
            amountOk,
            at: new Date().toISOString(),
          },
        });
        if (paid) {
          const updated = orderStore.get(orderId);
          setImmediate(() => {
            sendOrderStatusMail(updated, "paid", { store: orderStore }).catch((err) => {
              console.error("order paid mail failed:", err.message);
            });
          });
        }
      }

      const result = paid || alreadyPaid ? "success" : "failed";
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
    return json(res, 200, {
      ok: true,
      order: {
        id: order.id,
        total: order.total,
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
              hashOk: Boolean(bank.hashOk),
            }
          : null,
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

  if (req.method === "GET" && urlPath === "/api/catalog-bootstrap") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const bootstrap = catalogBootstrapPayload(requestUrl);
    if (!bootstrap) {
      return json(res, 404, { ok: false, error: "Katalog önbelleği hazır değil." });
    }
    return json(res, 200, bootstrap, {
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
    });
  }

  if (req.method === "GET" && urlPath === "/api/products") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const updatedAt = fs.existsSync(PRODUCTS_FILE)
      ? fs.statSync(PRODUCTS_FILE).mtime.toISOString()
      : null;
    if (requestUrl.searchParams.get("homeFeatured") === "1") {
      const featured = homeFeaturedCatalog(mergedProducts(false), {
        popularity: popularProductScores(),
        limit: requestUrl.searchParams.get("limit") || 12,
      });
    return json(
      res,
      200,
      {
        products: featured.products,
        byParent: featured.byParent,
        perCategory: featured.perCategory,
        parents: featured.parents,
        total: featured.products.length,
        page: 1,
        limit: featured.perCategory,
        totalPages: 1,
        updatedAt,
      },
      { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" }
    );
    }
    const productId = String(requestUrl.searchParams.get("id") || "").trim();
    const idsRaw = String(requestUrl.searchParams.get("ids") || "").trim();
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
      requestUrl.searchParams.get("marka") ||
        requestUrl.searchParams.get("minFiyat") ||
        requestUrl.searchParams.get("maxFiyat") ||
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
      featured: requestUrl.searchParams.get("featured") || "",
      kategori: requestUrl.searchParams.get("kategori") || "",
      ara: requestUrl.searchParams.get("ara") || "",
      alt: requestUrl.searchParams.get("alt") || "",
      marka: requestUrl.searchParams.get("marka") || "",
      minFiyat: requestUrl.searchParams.get("minFiyat") || "",
      maxFiyat: requestUrl.searchParams.get("maxFiyat") || "",
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
      }

      const mustChangePassword = adminSecurityStore.shouldForcePasswordChange(getAdminPassword());
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, {
        exp: Date.now() + ADMIN_IDLE_MS,
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
    if (token) sessions.delete(token);
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
      }
      adminSecurityStore.clearForcePasswordChange();
      if (session && sessionToken) {
        session.mustChangePassword = false;
        sessions.set(sessionToken, session);
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

  if (req.method === "GET" && urlPath === "/api/admin/orders") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const status = requestUrl.searchParams.get("status") || "";
    const limit = requestUrl.searchParams.get("limit") || "50";
    const from = requestUrl.searchParams.get("from") || "";
    const to = requestUrl.searchParams.get("to") || "";
    const q = requestUrl.searchParams.get("q") || "";
    return json(res, 200, {
      ok: true,
      orders: orderStore.list({
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        q: q || undefined,
        limit,
      }),
      shippingCarriers: SHIPPING_CARRIERS,
    });
  }

  const adminOrderMatch = /^\/api\/admin\/orders\/([^/]+)$/.exec(urlPath);
  if (adminOrderMatch) {
    const orderId = decodeURIComponent(adminOrderMatch[1]);
    if (req.method === "GET") {
      const order = orderStore.get(orderId);
      if (!order) return json(res, 404, { ok: false, error: "Sipariş bulunamadı" });
      return json(res, 200, { ok: true, order });
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
        }

        if (Object.prototype.hasOwnProperty.call(body, "status")) {
          const status = String(body.status || "").trim();
          if (!ORDER_STATUSES.has(status)) {
            return json(res, 400, { ok: false, error: "Geçersiz sipariş durumu" });
          }
          if (!shippingSave) {
            patch.status = status;
            if (status === "paid") {
              if (!requireOwner(req, res)) return;
              patch.paymentStatus = "paid";
              patch.paymentTaken = true;
            }
            if (status === "payment_failed") {
              patch.paymentStatus = "failed";
              patch.paymentTaken = false;
            }
            if (status === "refunded") {
              patch.paymentStatus = "refunded";
              patch.paymentTaken = false;
            }
          }
        } else if (!shippingSave) {
          return json(res, 400, { ok: false, error: "Durum veya kargo bilgisi gerekli." });
        }

        const order = orderStore.update(orderId, patch);
        let mailSent = false;
        try {
          let mailResult = null;
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
              mailResult = await sendOrderStatusMail(order, patch.status, { store: orderStore });
            }
          }
          mailSent = Boolean(mailResult && mailResult.sent);
        } catch (err) {
          console.error("order status mail failed:", err.message);
        }
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
                }
              : { from: current.status, to: patch.status, mailSent },
            ip: clientIp(req),
          });
        } catch (_) {}
        return json(res, 200, { ok: true, order, mailSent });
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
      warmStorefrontCatalog();
      scheduleAkakceImageMirror();
      const slots = supplierManager.listSlots();
      const feedAnalysis = analyzeAkakceProducts(mergedProducts(false), {
        siteBaseUrl: SITE_BASE_URL,
        mirrorIndex: loadMirrorIndex(DATA_ROOT),
      });
      return json(res, 200, {
        ok: true,
        result,
        slots,
        feedCount: feedAnalysis.eligible.length,
        feedExcludedCount: feedAnalysis.excluded.length,
      });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Kaynak yayınlanamadı" });
    }
  }

  if (req.method === "POST" && urlPath === "/api/admin/supplier/refresh") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const result = await supplierManager.refresh(body.slotId || "supplier-1");
      await enqueueXmlCategorySync(result.slotId);
      scheduleAkakceImageMirror();
      const slots = supplierManager.listSlots();
      return json(res, 200, {
        ok: true,
        result,
        slots,
        status: slots.find((slot) => slot.id === result.slotId) || slots[0],
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: err.message || "XML alınamadı" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/products") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const slots = supplierManager.listSlots();
    const queried = supplierManager.queryProducts({
      q: requestUrl.searchParams.get("q") || "",
      status: requestUrl.searchParams.get("status") || "",
      slot: requestUrl.searchParams.get("slot") || "",
      page: requestUrl.searchParams.get("page") || 1,
      limit: requestUrl.searchParams.get("limit") || 50,
    });
    return json(res, 200, {
      products: enrichSupplierProducts(queried.products),
      total: queried.total,
      page: queried.page,
      limit: queried.limit,
      totalPages: queried.totalPages,
      catalogCount: queried.catalogCount,
      activeCount: queried.activeCount,
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
      const updates = Array.isArray(body.updates) ? body.updates.slice(0, 5000) : [];
      if (!updates.length) {
        return json(res, 422, { ok: false, error: "Güncellenecek ürün seçilmedi." });
      }
      supplierManager.updateProducts(updates);
      invalidateStorefrontCatalog();
      const feedAnalysis = analyzeAkakceProducts(mergedProducts(false), {
        siteBaseUrl: SITE_BASE_URL,
        mirrorIndex: loadMirrorIndex(DATA_ROOT),
      });
      return json(res, 200, {
        ok: true,
        feedCount: feedAnalysis.eligible.length,
        feedExcludedCount: feedAnalysis.excluded.length,
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
    return data;
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

function catalogBootstrapPayload(requestUrl) {
  const fromDisk = readCatalogBootstrapSnapshot(requestUrl);
  if (fromDisk) return fromDisk;
  const params = requestUrl.searchParams;
  if (params.get("marka") || params.get("minFiyat") || params.get("maxFiyat")) return null;
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

function sendCatalogHtml(res, req, filePath, method) {
  const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
  if (isBlocked(rel) || rel.split("/").some((p) => p.startsWith("."))) {
    return serveNotFound(res, method);
  }
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) return serveNotFound(res, method);
    let html = data.toString("utf8");
    const requestUrl = new URL(req.url || "/urunler", `http://${req.headers.host || "localhost"}`);
    const bootstrap = catalogBootstrapPayload(requestUrl);
    if (bootstrap) {
      const json = JSON.stringify(bootstrap).replace(/</g, "\\u003c");
      const tag =
        '<script type="application/json" id="patygo-catalog-bootstrap">' +
        json +
        "</script>\n  ";
      html = html.replace('<script src="/assets/js/cart.js">', tag + '<script src="/assets/js/cart.js">');
    }
    const headers = {
      "Content-Type": MIME[".html"],
      "Cache-Control": "public, max-age=0, must-revalidate",
    };
    res.writeHead(200, securityHeaders(headers));
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
    return json(
      res,
      200,
      { version: 5, categories: categoryStore.publicList() },
      { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" }
    );
  }

  if (urlPath.startsWith("/listing/")) {
    const name = urlPath.slice("/listing/".length);
    if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) {
      return serveNotFound(res, req.method);
    }
    if (name === "categories.json") {
      return json(
        res,
        200,
        { version: 5, categories: categoryStore.publicList() },
        { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" }
      );
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

const supplierScheduler = createSupplierScheduler({
  manager: supplierManager,
  digest: xmlFetchDigest,
  afterRefresh: (slotId) => {
    enqueueXmlCategorySync(slotId);
    scheduleAkakceImageMirror();
  },
  log: (message, slotId, key) => console.log(message, slotId, key),
  logError: (message, slotId, key, detail) =>
    console.error(message, slotId, key, detail || ""),
});
supplierScheduler.start();
setImmediate(() => {
  try {
    ensureListingTreeSnapshotFiles();
  } catch (_) {}
  if (!bootstrapSnapshotsReady()) {
    warmStorefrontCatalog();
    scheduleAkakceImageMirror();
  }
});
const xmlCategorySyncTimer = setTimeout(() => {
  enqueueXmlCategorySync();
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
