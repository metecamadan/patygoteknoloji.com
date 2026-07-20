#!/usr/bin/env node
/**
 * Patygo Teknoloji — yerel geliştirme sunucusu (yalnızca localhost).
 * Production'da kullanmayın; statik hosting tercih edin.
 * Çalıştırma:  node server.js  (veya npm start)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname);
const ROOT_PREFIX = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const PORT = Number(process.env.PORT || process.argv[2] || 5173);

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

function isBlocked(relPosix) {
  const lower = relPosix.toLowerCase();
  if (BLOCKED_FILES.has(path.basename(relPosix).toLowerCase())) return true;
  if (lower.startsWith(".git/") || lower.includes("/.git/")) return true;
  if (lower.startsWith(".env") || lower.includes("/.env")) return true;
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

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, securityHeaders({ Allow: "GET, HEAD" }));
    return res.end("405 Method Not Allowed");
  }

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
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

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
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log("\n  Patygo Teknoloji — yerel sunucu (yalnızca bu makine)");
  console.log("  ----------------------------------------");
  console.log(`  Adres : ${url}`);
  console.log("  Production'da bu sunucuyu kullanmayın.\n");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  HATA: ${PORT} portu kullanımda. Farklı bir port deneyin:`);
    console.error(`  node server.js 5174\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
