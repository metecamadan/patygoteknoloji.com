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
const { analyzeAkakceProducts, buildAkakceXml } = require("./lib/akakce");
const { mergeCatalogProducts } = require("./lib/catalog");
const { createAnalyticsStore } = require("./lib/analytics");
const {
  createAkbankConfig,
  buildHostedPaymentForm,
  verifyCallbackHash,
  isPaymentSuccess,
  publicPosStatus,
} = require("./lib/akbank-pos");
const { createOrderStore } = require("./lib/orders");

const ROOT = path.resolve(__dirname);
const ROOT_PREFIX = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const PORT = Number(process.env.PORT || process.argv[2] || 5173);

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : "patygo-admin");
if (!ADMIN_PASSWORD) {
  throw new Error("Canlı ortamda ADMIN_PASSWORD tanımlanmalıdır.");
}
const PRODUCTS_FILE = path.join(ROOT, "assets", "data", "products.json");
const PRODUCTS_IMG_DIR = path.join(ROOT, "assets", "img", "products");
const SITE_BASE_URL = String(process.env.SITE_BASE_URL || `http://localhost:${PORT}`).replace(
  /\/+$/,
  ""
);
const VAT_RATE = 0.2;
const supplierAllowedHosts = String(
  process.env.SUPPLIER_ALLOWED_HOSTS || "www.bilgisayarim.com.tr"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const supplierManager = createMultiSupplierManager(ROOT, {
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
const analyticsStore = createAnalyticsStore(ROOT);
const orderStore = createOrderStore(ROOT);
const akbankConfig = createAkbankConfig(process.env);
const paymentStartAttempts = new Map(); // IP -> { count, resetAt }

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
const loginAttempts = new Map(); // IP -> { count, resetAt }

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
        "connect-src 'self'; form-action 'self' https://formsubmit.co " +
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
  for (const row of rawItems.slice(0, 40)) {
    const product = byId[String(row.productId || "")];
    if (!product || product.active === false) {
      throw new Error("Sepette geçersiz ürün var.");
    }
    const qty = Math.max(1, Math.min(99, Number(row.qty) || 1));
    const line = product.price * qty;
    subtotal += line;
    items.push({
      productId: product.id,
      brand: product.brand,
      name: product.name,
      unitPrice: product.price,
      qty,
      line,
    });
  }

  const vat = Math.round(subtotal * VAT_RATE * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const customer = (body && body.customer) || {};
  const name = String(customer.name || "").trim().slice(0, 120);
  const email = String(customer.email || "").trim().slice(0, 120);
  const phone = String(customer.phone || "").trim().slice(0, 40);
  if (!name || !email || !phone) throw new Error("Alıcı bilgileri eksik.");
  if (!isValidEmail(email)) throw new Error("Geçerli bir e-posta girin.");
  if (!body.contractsAccepted) throw new Error("Sözleşme onayları gerekli.");

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
    },
    contractsAccepted: {
      onBilgilendirme: true,
      mesafeliSatis: true,
      iadeCayma: true,
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
  if (lower.startsWith("assets/data/") || lower.includes("/assets/data/")) return true;
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

function normalizeProduct(p, fallbackId) {
  const id = slugify(p.id || p.name || fallbackId || crypto.randomBytes(4).toString("hex"));
  const category = CATEGORIES.has(p.category) ? p.category : "bilgisayar";
  const price = Math.max(0, Number(p.price) || 0);
  const legacyImage = String(p.image || "").trim().slice(0, 260);
  const images = (Array.isArray(p.images) ? p.images : [])
    .map((value) => String(value || "").trim().slice(0, 260))
    .filter(Boolean)
    .slice(0, 10);
  if (legacyImage && !images.includes(legacyImage)) images.unshift(legacyImage);
  return {
    id,
    brand: String(p.brand || "").trim().toUpperCase().slice(0, 40),
    name: String(p.name || "").trim().slice(0, 120),
    price,
    category,
    description: String(p.description || "").trim().slice(0, 280),
    details: String(p.details || "").trim().slice(0, 4000),
    image: images[0] || "",
    images,
    featured: Boolean(p.featured),
    active: p.active !== false,
  };
}

function mergedProducts(includeInactiveManual) {
  return mergeCatalogProducts(loadProducts(), supplierManager.listProducts(), {
    includeInactiveManual,
    normalizeProduct,
  });
}

function authOk(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

async function handleApi(req, res, urlPath) {
  if (req.method === "GET" && urlPath === "/api/payment/status") {
    return json(res, 200, publicPosStatus(akbankConfig));
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
    const all = mergedProducts(false);
    const supplierStatuses = supplierManager.listSlots();
    const lastSupplierFetch = supplierStatuses
      .map((status) => status.lastFetchAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    return json(res, 200, {
      products: all,
      updatedAt:
        lastSupplierFetch ||
        (fs.existsSync(PRODUCTS_FILE) ? fs.statSync(PRODUCTS_FILE).mtime.toISOString() : null),
    });
  }

  if (req.method === "GET" && urlPath === "/api/feeds/akakce.xml") {
    const xml = buildAkakceXml(mergedProducts(false), {
      siteBaseUrl: SITE_BASE_URL,
      vatRate: VAT_RATE,
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

  if (req.method === "POST" && urlPath === "/api/admin/login") {
    try {
      const clientIp = (req.socket && req.socket.remoteAddress) || "unknown";
      const now = Date.now();
      const attempt = loginAttempts.get(clientIp);
      if (attempt && attempt.resetAt > now && attempt.count >= 10) {
        return json(res, 429, {
          ok: false,
          error: "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.",
        });
      }
      if (attempt && attempt.resetAt <= now) loginAttempts.delete(clientIp);
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
      const supplied = Buffer.from(String(body.password || ""));
      const expected = Buffer.from(ADMIN_PASSWORD);
      const matches =
        supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
      if (!matches) {
        const current = loginAttempts.get(clientIp);
        loginAttempts.set(clientIp, {
          count: current && current.resetAt > now ? current.count + 1 : 1,
          resetAt: current && current.resetAt > now ? current.resetAt : now + 15 * 60 * 1000,
        });
        return json(res, 401, { ok: false, error: "Şifre hatalı" });
      }
      loginAttempts.delete(clientIp);
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
      return json(res, 200, { ok: true, token });
    } catch (_) {
      return json(res, 400, { ok: false, error: "Geçersiz istek" });
    }
  }

  if (urlPath.startsWith("/api/admin/") && !authOk(req)) {
    return json(res, 401, { ok: false, error: "Oturum gerekli" });
  }

  if (req.method === "GET" && urlPath === "/api/admin/products") {
    return json(res, 200, { products: loadProducts() });
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
    return json(res, 200, {
      ok: true,
      analytics: Object.assign({}, analytics, { topViewedProducts }),
      commerce,
      server: {
        status: "online",
        uptimeSec: Math.floor(process.uptime()),
        node: process.version,
        memoryMB: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        pos: publicPosStatus(akbankConfig),
        checkedAt: new Date().toISOString(),
      },
      leadsNote:
        "Talep sayısı, formun FormSubmit ile başarıyla gönderildiği anları sayar. Posta kutusu teslimatı FormSubmit/e-posta sağlayıcısına bağlıdır.",
    });
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/status") {
    const feedProducts = mergedProducts(false);
    const feedAnalysis = analyzeAkakceProducts(feedProducts, {
      siteBaseUrl: SITE_BASE_URL,
    });
    const slots = supplierManager.listSlots();
    return json(res, 200, {
      slots,
      status: slots[0],
      feed: {
        path: "/api/feeds/akakce.xml",
        activeCount: feedAnalysis.eligible.length,
        excludedCount: feedAnalysis.excluded.length,
        supplierActiveCount: feedAnalysis.eligible.filter(
          (item) => item.source === "supplier"
        ).length,
        manualActiveCount: feedAnalysis.eligible.filter(
          (item) => item.source === "manual"
        ).length,
        issues: feedAnalysis.excluded.slice(0, 20),
      },
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
        products: supplierManager.listProducts(),
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: err.message || "XML alınamadı" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/products") {
    const slots = supplierManager.listSlots();
    return json(res, 200, {
      products: supplierManager.listProducts(),
      slots,
      status: slots[0],
    });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/supplier/settings") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const settings = supplierManager.setGlobalMargin(
        body.slotId || "supplier-1",
        body.globalMarginPercent
      );
      return json(res, 200, {
        ok: true,
        settings,
        products: supplierManager.listProducts(),
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
        products: supplierManager.listProducts(),
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
        const p = normalizeProduct(item);
        if (!p.id || !p.name || !p.brand) continue;
        if (seen.has(p.id)) continue;
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
      return json(res, 200, { ok: true, url: "assets/img/products/" + name });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || "Yükleme başarısız" });
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
    if (rel === "admin.html") {
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

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  HATA: ${PORT} portu kullanımda. node server.js 5174\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
