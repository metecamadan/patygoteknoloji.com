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
const { createSupplierScheduler, getNextScheduledAt, scheduleSummary } = require("./lib/supplier-schedule");
const { analyzeAkakceProducts, analyzeSupplierFeedIssues, buildAkakceFeedSummary, buildAkakceXml } = require("./lib/akakce");
const { mergeCatalogProducts, toPublicProduct } = require("./lib/catalog");
const {
  createCategoryStore,
  setCategoryListLoader,
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
} = require("./lib/akbank-pos");
const { createOrderStore, ORDER_STATUSES } = require("./lib/orders");
const { createCalendarStore } = require("./lib/calendar");
const { createAdminUserStore } = require("./lib/admin-users");
const { createAgentOpsStore } = require("./lib/agent-ops");
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
} = require("./lib/contact");

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
if (!ADMIN_PASSWORD) {
  throw new Error("Canlı ortamda ADMIN_PASSWORD tanımlanmalıdır.");
}
const PRODUCTS_FILE = path.join(ROOT, "assets", "data", "products.json");
const PRODUCTS_IMG_DIR = path.join(ROOT, "assets", "img", "products");
const SITE_BASE_URL = resolveSiteBaseUrl(process.env.SITE_BASE_URL, PORT, IS_PRODUCTION);
const rawIdleMs = Number(process.env.ADMIN_IDLE_MS);
const ADMIN_IDLE_MS =
  Number.isFinite(rawIdleMs) && rawIdleMs > 0 ? rawIdleMs : 30 * 60 * 1000;
const supplierAllowedHosts = String(
  process.env.SUPPLIER_ALLOWED_HOSTS ||
    "www.bilgisayarim.com.tr,cdnsta.avansas.com,www.avansas.com"
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
const agentOpsStore = createAgentOpsStore(DATA_ROOT);
const consentStore = createConsentStore(DATA_ROOT);
const auditStore = createAuditStore(DATA_ROOT);

agentOpsStore.seedIfEmpty([
  {
    type: "decision",
    from: "orchestrator",
    summary: "Yarım kalan 3 iş: ödeme spacing, takvim mail, kullanıcı yönetimi — sıra: FE → BE → QA → Release",
    taskId: "resume-aug2",
    status: "planned",
  },
  {
    type: "handoff",
    from: "orchestrator",
    to: "frontend",
    summary: "Ödeme sayfası dikey boşlukları sıkılaştır",
    files: ["odeme.html", "assets/css/style.css"],
    taskId: "checkout-compact",
  },
  {
    type: "change",
    from: "frontend",
    summary: "checkout-page compact hero/section eklendi",
    files: ["odeme.html", "assets/css/style.css", "tests/checkout-layout.test.js"],
    taskId: "checkout-compact",
  },
  {
    type: "handoff",
    from: "orchestrator",
    to: "backend",
    summary: "notifyEmail + admin kullanıcı store",
    files: ["lib/calendar.js", "lib/admin-users.js", "server.js"],
    taskId: "users-calendar",
  },
  {
    type: "change",
    from: "backend",
    summary: "admin-users API ve takvim e-posta hedefi",
    files: ["lib/admin-users.js", "lib/contact.js", "server.js"],
    taskId: "users-calendar",
  },
  {
    type: "handoff",
    from: "backend",
    to: "frontend",
    summary: "Kullanıcılar sekmesi + takvim e-posta alanı",
    files: ["admin.html", "assets/js/admin.js"],
    taskId: "users-calendar",
  },
  {
    type: "handoff",
    from: "frontend",
    to: "qa",
    summary: "Regression: checkout + users + calendar",
    taskId: "resume-aug2",
  },
  {
    type: "gate",
    from: "qa",
    summary: "npm test 117/117 yeşil",
    status: "pass",
    taskId: "resume-aug2",
  },
  {
    type: "handoff",
    from: "qa",
    to: "release",
    summary: "Commit + push main",
    taskId: "resume-aug2",
  },
  {
    type: "gate",
    from: "release",
    summary: "GitHub Actions CI and Deploy success",
    status: "pass",
    taskId: "resume-aug2",
  },
  {
    type: "decision",
    from: "orchestrator",
    summary: "Canlı agent-ops paneli: görev paslaşmalarını kullanıcıya göster",
    taskId: "agent-ops-live",
    status: "planned",
  },
]);
const contactStore = createContactStore(DATA_ROOT);
const akbankConfig = createAkbankConfig(process.env);
const paymentStartAttempts = new Map(); // IP -> { count, resetAt }
const contactAttempts = new Map(); // IP -> { count, resetAt }

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
        "img-src 'self' data: https: http:; font-src 'self' data: https:; " +
        "connect-src 'self'; form-action 'self'; " +
        "https://virtualpospaymentgatewaypre.akbank.com https://virtualpospaymentgateway.akbank.com",
    },
    extra || {}
  );
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(
    status,
    securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
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

function buildCheckoutOrder(body) {
  const catalog = mergedProducts(false);
  const byId = Object.fromEntries(catalog.map((product) => [product.id, product]));
  const rawItems = Array.isArray(body && body.items) ? body.items : [];
  if (!rawItems.length) throw new Error("Sepet boş.");

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
    "\">Devam</a></p></body></html>";
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
  const category = CATEGORIES.has(p.category) ? p.category : "bilgisayar";
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
  };
}

function mergedProducts(includeInactiveManual) {
  return mergeCatalogProducts(loadProducts(), supplierManager.listProducts(), {
    includeInactiveManual,
    normalizeProduct,
    categoryDefaults: CATEGORY_FEED_DEFAULTS,
  });
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
        to: delivery.to,
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

  if (req.method === "POST" && urlPath === "/api/payment/callback") {
    try {
      const raw = await readBody(req, 256 * 1024);
      const payload = parseFormBody(raw);
      const orderId = String(payload.orderId || payload.merchantData || "").slice(0, 64);
      const order = orderId ? orderStore.get(orderId) : null;
      const hashOk = akbankConfig.enabled && verifyCallbackHash(payload, akbankConfig.secretKey);
      const paid = hashOk && isPaymentSuccess(payload);

      if (order) {
        orderStore.update(orderId, {
          paymentStatus: paid ? "paid" : "failed",
          paymentTaken: paid,
          status: paid ? "paid" : "payment_failed",
          bankResponse: {
            responseCode: String(payload.responseCode || "").slice(0, 40),
            responseMessage: String(payload.responseMessage || "").slice(0, 200),
            hashOk,
            at: new Date().toISOString(),
          },
        });
        if (paid) {
          try {
            const updated = orderStore.get(orderId);
            await sendOrderStatusMail(updated, "paid", { store: orderStore });
          } catch (err) {
            console.error("order paid mail failed:", err.message);
          }
        }
      }

      const result = paid ? "success" : "failed";
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
    const order = orderId ? orderStore.get(orderId) : null;
    if (!order) return json(res, 404, { ok: false, error: "Sipariş bulunamadı." });
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

  if (req.method === "GET" && urlPath === "/api/products") {
    const all = mergedProducts(false).map(toPublicProduct);
    const updatedAt = fs.existsSync(PRODUCTS_FILE)
      ? fs.statSync(PRODUCTS_FILE).mtime.toISOString()
      : null;
    return json(res, 200, {
      products: all,
      updatedAt,
    });
  }

  if (req.method === "GET" && urlPath === "/api/feeds/akakce.xml") {
    const xml = buildAkakceXml(mergedProducts(false), {
      siteBaseUrl: SITE_BASE_URL,
    });
    res.writeHead(
      200,
      securityHeaders({
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      })
    );
    return res.end(xml);
  }

  if (req.method === "POST" && urlPath === "/api/agent-ops/ingest") {
    const expected = String(process.env.AGENT_OPS_INGEST_KEY || "").trim();
    const got = String(req.headers["x-agent-ops-key"] || "").trim();
    if (!expected) {
      return json(res, 503, { ok: false, error: "Agent Ops ingest kapalı" });
    }
    const a = crypto.createHash("sha256").update(expected).digest();
    const b = crypto.createHash("sha256").update(got).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      return json(res, 401, { ok: false, error: "Anahtar geçersiz" });
    }
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const event = agentOpsStore.append(body);
      return json(res, 200, { ok: true, event });
    } catch (err) {
      return json(res, 400, { ok: false, error: (err && err.message) || "Olay yazılamadı" });
    }
  }

  if (req.method === "POST" && urlPath === "/api/admin/login") {
    try {
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
        const expected = Buffer.from(ADMIN_PASSWORD);
        const matches =
          supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        if (!matches) {
          return json(res, 401, { ok: false, error: "Şifre hatalı" });
        }
      }

      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, {
        exp: Date.now() + ADMIN_IDLE_MS,
        userId: user ? user.id : null,
      });
      return json(res, 200, { ok: true, token, user });
    } catch (_) {
      return json(res, 400, { ok: false, error: "Geçersiz istek" });
    }
  }

  if (urlPath.startsWith("/api/admin/") && !authOk(req)) {
    return json(res, 401, { ok: false, error: "Oturum gerekli" });
  }

  if (req.method === "GET" && urlPath === "/api/admin/me") {
    return json(res, 200, { ok: true, user: sessionUser(req) });
  }

  if (req.method === "GET" && urlPath === "/api/admin/agent-ops") {
    const requestUrl = new URL(req.url || urlPath, `http://${req.headers.host || "localhost"}`);
    const limit = requestUrl.searchParams.get("limit");
    return json(res, 200, { ok: true, snapshot: agentOpsStore.snapshot(), events: agentOpsStore.list(limit) });
  }

  if (req.method === "POST" && urlPath === "/api/admin/agent-ops") {
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const event = agentOpsStore.append(body);
      return json(res, 200, { ok: true, event });
    } catch (err) {
      return json(res, 400, { ok: false, error: (err && err.message) || "Olay yazılamadı" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/users") {
    return json(res, 200, { ok: true, users: adminUserStore.list() });
  }

  if (req.method === "POST" && urlPath === "/api/admin/users") {
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
    return json(res, 200, {
      ok: true,
      orders: orderStore.list({ status: status || undefined, limit }),
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
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
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
    const mem = process.memoryUsage();
    const analytics = analyticsStore.summary(range);
    const commerce = orderStore.commerceSummary(range);
    const catalogById = Object.fromEntries(
      mergedProducts(true).map((product) => [product.id, product])
    );
    const topViewedProducts = (analytics.topViewedProducts || []).map((row) => {
      const product = catalogById[row.productId];
      return {
        productId: row.productId,
        views: row.views,
        name: product ? product.name : row.productId,
        brand: product ? product.brand : "",
      };
    });
    // Process metrics only — never expose host IP / “server online” as site health.
    return json(res, 200, {
      ok: true,
      analytics: Object.assign({}, analytics, { topViewedProducts }),
      commerce,
      process: {
        apiReachable: true,
        uptimeSec: Math.floor(process.uptime()),
        node: process.version,
        memoryMB: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        pos: publicPosStatus(akbankConfig),
        siteBaseUrl: SITE_BASE_URL,
        checkedAt: new Date().toISOString(),
      },
      leadsNote:
        "Talep sayısı, formun FormSubmit ile başarıyla gönderildiği anları sayar. Posta kutusu teslimatı FormSubmit/e-posta sağlayıcısına bağlıdır.",
    });
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/status") {
    const slots = supplierManager.listSlots();
    const primary = slots[0] || {};
    return json(res, 200, {
      slots,
      status: slots[0],
      schedule: primary.schedule || scheduleSummary(),
      nextScheduled: primary.nextScheduled || getNextScheduledAt(new Date()),
      feed: buildAkakceFeedSummary(mergedProducts(false), {
        siteBaseUrl: SITE_BASE_URL,
      }),
    });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/supplier/config") {
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

  if (req.method === "POST" && urlPath === "/api/admin/supplier/refresh") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const result = await supplierManager.refresh(body.slotId || "supplier-1");
      const slots = supplierManager.listSlots();
      return json(res, 200, {
        ok: true,
        result,
        slots,
        status: slots.find((slot) => slot.id === result.slotId) || slots[0],
        products: enrichSupplierProducts(supplierManager.listProducts()),
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: err.message || "XML alınamadı" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/products") {
    const slots = supplierManager.listSlots();
    return json(res, 200, {
      products: enrichSupplierProducts(supplierManager.listProducts()),
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
        scheduleStart: body.scheduleStart,
        scheduleStartMinute: body.scheduleStartMinute,
        scheduleIntervalMinutes: body.scheduleIntervalMinutes,
      });
      return json(res, 200, {
        ok: true,
        settings,
        products: enrichSupplierProducts(supplierManager.listProducts()),
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
      const feedAnalysis = analyzeAkakceProducts(mergedProducts(false), {
        siteBaseUrl: SITE_BASE_URL,
      });
      return json(res, 200, {
        ok: true,
        products: enrichSupplierProducts(supplierManager.listProducts()),
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
      const ext = m[2] === "jpeg" ? "jpg" : m[2];
      const buf = Buffer.from(m[3], "base64");
      if (buf.length > 4 * 1024 * 1024) {
        return json(res, 400, { ok: false, error: "Görsel en fazla 4 MB olabilir" });
      }
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
    if (rel === "admin.html" || rel === "agent-ops.html") {
      headers["X-Robots-Tag"] = "noindex, nofollow";
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(200, securityHeaders(headers));
    if (method === "HEAD") return res.end();
    res.end(data);
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

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, securityHeaders({ Allow: "GET, HEAD" }));
    return res.end("405 Method Not Allowed");
  }

  if (urlPath === "/assets/data/categories.json") {
    return json(res, 200, { version: 1, categories: categoryStore.publicList() });
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

  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
  console.log("\n  Patygo Teknoloji — yerel sunucu");
  console.log("  ----------------------------------------");
  console.log(`  Site  : http://127.0.0.1:${PORT}`);
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
  log: (message, slotId, key) => console.log(message, slotId, key),
  logError: (message, slotId, key, detail) =>
    console.error(message, slotId, key, detail || ""),
});
supplierScheduler.start();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  HATA: ${PORT} portu kullanımda. node server.js 5174\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
