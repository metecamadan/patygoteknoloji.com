#!/usr/bin/env node
/**
 * Patygo Teknoloji — bağımlılıksız statik geliştirme sunucusu.
 * Çalıştırma:  node server.js  (veya npm start)
 * Port:        PORT ortam değişkeni ya da ilk argüman (varsayılan 5173)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
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

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const target = path.normalize(path.join(root, decoded));
  if (!target.startsWith(root)) return null; // path traversal koruması
  return target;
}

const server = http.createServer((req, res) => {
  let filePath = safeJoin(ROOT, req.url === "/" ? "/index.html" : req.url);
  if (!filePath) {
    res.writeHead(403);
    return res.end("403 Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, "index.html");

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        const notFound = path.join(ROOT, "404.html");
        return fs.readFile(notFound, (e, page) => {
          res.writeHead(404, { "Content-Type": MIME[".html"] });
          res.end(e ? "404 Not Found" : page);
        });
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log("\n  Patygo Teknoloji — yerel sunucu çalışıyor");
  console.log("  ----------------------------------------");
  console.log(`  Adres : ${url}`);
  console.log("  Durdurmak için: Ctrl + C\n");
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
