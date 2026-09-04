"use strict";

const { categoryHref } = require("./categories");

const STATIC_PATHS = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/urunler", changefreq: "weekly", priority: "0.9" },
  { path: "/kurumsal", changefreq: "monthly", priority: "0.8" },
  { path: "/hizmetler", changefreq: "monthly", priority: "0.8" },
  { path: "/markalar", changefreq: "monthly", priority: "0.7" },
  { path: "/iletisim", changefreq: "monthly", priority: "0.7" },
  { path: "/kvkk", changefreq: "yearly", priority: "0.3" },
  { path: "/gizlilik", changefreq: "yearly", priority: "0.3" },
  { path: "/cerez", changefreq: "yearly", priority: "0.3" },
  { path: "/kullanim-kosullari", changefreq: "yearly", priority: "0.3" },
  { path: "/hizmet-sozlesmesi", changefreq: "yearly", priority: "0.3" },
  { path: "/mesafeli-satis-sozlesmesi", changefreq: "yearly", priority: "0.4" },
  { path: "/on-bilgilendirme-formu", changefreq: "yearly", priority: "0.4" },
  { path: "/iade-ve-cayma", changefreq: "yearly", priority: "0.4" },
];

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function todayIsoDate(now) {
  const d = now instanceof Date ? now : new Date();
  return d.toISOString().slice(0, 10);
}

function collectCategoryPaths(categories) {
  const paths = [];
  const seen = new Set();
  function add(href) {
    if (!href || seen.has(href)) return;
    seen.add(href);
    paths.push(href);
  }
  (Array.isArray(categories) ? categories : []).forEach((parent) => {
    if (!parent || !parent.slug) return;
    add(categoryHref(parent.slug));
    (parent.children || []).forEach((mid) => {
      if (!mid || !mid.slug) return;
      add(categoryHref(parent.slug, mid.slug));
      (mid.children || []).forEach((child) => {
        if (!child || !child.slug) return;
        add(categoryHref(parent.slug, mid.slug, child.slug));
      });
    });
  });
  return paths;
}

function collectProductPaths(routeIndex) {
  const byId = routeIndex && routeIndex.byId;
  if (!byId || typeof byId !== "object") return [];
  return Object.keys(byId)
    .map((id) => byId[id])
    .filter((href) => typeof href === "string" && href.startsWith("/"))
    .sort();
}

function buildUrlset(entries, baseUrl) {
  const origin = String(baseUrl || "https://patygoteknoloji.com").replace(/\/+$/, "");
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    const loc = entry.path.startsWith("http") ? entry.path : origin + entry.path;
    lines.push("  <url>");
    lines.push("    <loc>" + xmlEscape(loc) + "</loc>");
    if (entry.lastmod) lines.push("    <lastmod>" + xmlEscape(entry.lastmod) + "</lastmod>");
    if (entry.changefreq) {
      lines.push("    <changefreq>" + xmlEscape(entry.changefreq) + "</changefreq>");
    }
    if (entry.priority) lines.push("    <priority>" + xmlEscape(entry.priority) + "</priority>");
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return lines.join("\n") + "\n";
}

function buildStorefrontSitemap(input) {
  const lastmod = todayIsoDate(input && input.now);
  const entries = STATIC_PATHS.map((row) => ({
    path: row.path,
    lastmod,
    changefreq: row.changefreq,
    priority: row.priority,
  }));

  collectCategoryPaths(input && input.categories).forEach((path) => {
    entries.push({
      path,
      lastmod,
      changefreq: "weekly",
      priority: path.split("/").length <= 3 ? "0.85" : "0.7",
    });
  });

  collectProductPaths(input && input.routeIndex).forEach((path) => {
    entries.push({
      path,
      lastmod,
      changefreq: "weekly",
      priority: "0.6",
    });
  });

  return buildUrlset(entries, input && input.baseUrl);
}

module.exports = {
  STATIC_PATHS,
  xmlEscape,
  collectCategoryPaths,
  collectProductPaths,
  buildStorefrontSitemap,
};
