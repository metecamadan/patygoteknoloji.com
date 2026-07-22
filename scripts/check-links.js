#!/usr/bin/env node
/** Internal link audit for Patygo static pages. Exit 1 if broken. */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const net = require("net");

const root = path.resolve(__dirname, "..");
const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith(".html"));
const pageSlugs = new Set(
  htmlFiles.map((f) => (f === "index.html" ? "" : f.replace(/\.html$/i, "")))
);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function collectHrefTargets() {
  const targets = new Map();
  const re = /\b(?:href|action)=["']([^"']+)["']/gi;
  for (const file of htmlFiles) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    let m;
    while ((m = re.exec(text))) {
      const raw = m[1].trim();
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
      if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) continue;
      if (raw.startsWith("assets/") || raw.startsWith("/assets/")) continue;
      const noHash = raw.split("#")[0];
      const pathname = noHash.split("?")[0];
      if (!pathname) continue;
      if (!targets.has(pathname)) targets.set(pathname, new Set());
      targets.get(pathname).add(file);
    }
  }
  // JS-built commerce routes
  for (const route of ["/urunler", "/urun-detay", "/odeme", "/sepet", "/admin", "/"]) {
    if (!targets.has(route)) targets.set(route, new Set(["(js)"]));
  }
  return targets;
}

function staticExists(pathname) {
  const clean = pathname.replace(/^\//, "").replace(/\/$/, "");
  if (!clean) return true;
  if (pageSlugs.has(clean)) return true;
  if (fs.existsSync(path.join(root, clean + ".html"))) return true;
  if (fs.existsSync(path.join(root, clean))) return true;
  return false;
}

async function waitForServer(base, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error("server exited");
    try {
      const res = await fetch(base + "/api/payment/status");
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("server timeout");
}

async function main() {
  const targets = collectHrefTargets();
  const staticBroken = [];
  for (const [pathname, srcs] of targets) {
    if (pathname.startsWith("/api/")) continue;
    if (!staticExists(pathname) && !pathname.endsWith(".html")) {
      // allow .html only as redirect targets; still flag for cleanup
    }
    if (pathname.endsWith(".html")) {
      staticBroken.push({ pathname, reason: "legacy .html href", srcs: [...srcs] });
      continue;
    }
    if (!staticExists(pathname)) {
      staticBroken.push({ pathname, reason: "missing page", srcs: [...srcs] });
    }
  }

  const port = await getFreePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: "link-check-admin" },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const httpBroken = [];
  try {
    await waitForServer(base, child);
    const paths = new Set([...targets.keys()].map((p) => (p.endsWith(".html") ? p.replace(/\.html$/i, "") : p)));
    paths.add("/");
    paths.add("/admin");
    paths.add("/urunler.html"); // should 301
    paths.add("/sitemap.xml");
    paths.add("/robots.txt");

    for (const p of [...paths].sort()) {
      if (p.startsWith("/api/")) continue;
      const url = base + (p.startsWith("/") ? p : "/" + p);
      try {
        const res = await fetch(url, { redirect: "manual" });
        const ok =
          res.status === 200 ||
          res.status === 301 ||
          res.status === 302 ||
          res.status === 303;
        if (!ok) httpBroken.push({ path: p, status: res.status });
        if (p.endsWith(".html") && res.status !== 301) {
          httpBroken.push({ path: p, status: res.status, note: "expected 301" });
        }
      } catch (err) {
        httpBroken.push({ path: p, status: "ERR", note: err.message });
      }
    }

    // Admin login API smoke
    const login = await fetch(base + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "link-check-admin" }),
    });
    if (login.status !== 200) {
      httpBroken.push({ path: "/api/admin/login", status: login.status, note: "login failed" });
    }
  } finally {
    child.kill();
  }

  console.log("Checked href targets:", targets.size);
  if (staticBroken.length) {
    console.log("\nStatic issues:");
    for (const row of staticBroken) console.log("-", row.pathname, row.reason, "from", row.srcs.join(", "));
  }
  if (httpBroken.length) {
    console.log("\nHTTP issues:");
    for (const row of httpBroken) console.log("-", row.path, row.status, row.note || "");
  }

  if (staticBroken.length || httpBroken.length) {
    process.exit(1);
  }
  console.log("All internal links OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
