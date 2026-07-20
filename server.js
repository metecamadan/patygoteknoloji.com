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
const { createSupplierStore } = require("./lib/supplier");
const { buildAkakceXml } = require("./lib/akakce");

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
const supplierStore = createSupplierStore(ROOT, {
  envUrl: process.env.SUPPLIER_XML_URL || "",
  defaultMarginPercent: process.env.SUPPLIER_MARGIN_PERCENT || 15,
  allowedHosts: String(process.env.SUPPLIER_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
});

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
  const manual = loadProducts()
    .map((item) => Object.assign({}, normalizeProduct(item), { source: "manual" }))
    .filter((item) => includeInactiveManual || item.active !== false);
  const ids = new Set(manual.map((item) => item.id));
  const supplier = supplierStore
    .listProducts()
    .filter((item) => item.active)
    .map((item) => {
      const normalized = normalizeProduct({
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
      return Object.assign(normalized, {
        source: "supplier",
        supplierSku: item.supplierSku,
        barcode: item.barcode || "",
        stockQty: item.stockQty,
        costPrice: item.costPrice,
      });
    })
    .filter((item) => !ids.has(item.id));
  return manual.concat(supplier);
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
  if (req.method === "GET" && urlPath === "/api/products") {
    const all = mergedProducts(false);
    const supplierStatus = supplierStore.status();
    return json(res, 200, {
      products: all,
      updatedAt:
        supplierStatus.lastFetchAt ||
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

  if (req.method === "GET" && urlPath === "/api/admin/supplier/status") {
    const feedProducts = mergedProducts(false);
    return json(res, 200, {
      status: supplierStore.status(),
      feed: {
        path: "/api/feeds/akakce.xml",
        activeCount: feedProducts.length,
        supplierActiveCount: feedProducts.filter((item) => item.source === "supplier").length,
        manualActiveCount: feedProducts.filter((item) => item.source === "manual").length,
      },
    });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/supplier/config") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const config = await supplierStore.saveUrl(body.url);
      return json(res, 200, { ok: true, config });
    } catch (err) {
      return json(res, 422, { ok: false, error: err.message || "Bağlantı kaydedilemedi" });
    }
  }

  if (req.method === "POST" && urlPath === "/api/admin/supplier/refresh") {
    try {
      const result = await supplierStore.refresh();
      return json(res, 200, {
        ok: true,
        result,
        status: supplierStore.status(),
        products: supplierStore.listProducts(),
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: err.message || "XML alınamadı" });
    }
  }

  if (req.method === "GET" && urlPath === "/api/admin/supplier/products") {
    return json(res, 200, {
      products: supplierStore.listProducts(),
      status: supplierStore.status(),
    });
  }

  if (req.method === "PUT" && urlPath === "/api/admin/supplier/settings") {
    try {
      const body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
      const settings = supplierStore.setGlobalMargin(body.globalMarginPercent);
      return json(res, 200, {
        ok: true,
        settings,
        products: supplierStore.listProducts(),
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
      supplierStore.updateOverrides(updates);
      return json(res, 200, {
        ok: true,
        products: supplierStore.listProducts(),
        feedCount: mergedProducts(false).length,
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

function serveStatic(req, res) {
  let filePath = safeJoin(ROOT, req.url === "/" ? "/index.html" : req.url);
  if (!filePath) {
    res.writeHead(403, securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    return res.end("403 Forbidden");
  }

  const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
  if (isBlocked(rel) || rel.split("/").some((p) => p.startsWith("."))) {
    res.writeHead(404, securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    return res.end("404 Not Found");
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      res.writeHead(404, securityHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
      return res.end("404 Not Found");
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        const notFound = path.join(ROOT, "404.html");
        return fs.readFile(notFound, (e, page) => {
          res.writeHead(404, securityHeaders({ "Content-Type": MIME[".html"] }));
          res.end(e ? "404 Not Found" : page);
        });
      }
      res.writeHead(200, securityHeaders({ "Content-Type": MIME[ext] || "application/octet-stream" }));
      if (req.method === "HEAD") return res.end();
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

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

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log("\n  Patygo Teknoloji — yerel sunucu");
  console.log("  ----------------------------------------");
  console.log(`  Site  : http://127.0.0.1:${PORT}`);
  console.log(`  Site  : http://localhost:${PORT}`);
  console.log(`  Admin : http://127.0.0.1:${PORT}/admin.html`);
  console.log(`  Şifre : ADMIN_PASSWORD (varsayılan: patygo-admin)`);
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
