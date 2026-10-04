"use strict";

const SITE = "https://patygoteknoloji.com";
const DEFAULT_OG_IMAGE = SITE + "/assets/img/og-default.png";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Supplier descriptions may carry HTML; names are plain text and keep their angle brackets. */
function htmlToText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function plain(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return max && text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

function priceInclVat(product) {
  const net = Number(product && product.price) || 0;
  const rate = Number(product && product.vatPercent);
  const vat = Number.isFinite(rate) && rate >= 0 ? rate : 20;
  return Math.round(net * (1 + vat / 100) * 100) / 100;
}

function formatTry(amount) {
  return (
    "₺" +
    Number(amount || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function absoluteUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? SITE + value : "";
}

function productImages(product) {
  const list = [product.image].concat(Array.isArray(product.images) ? product.images : []);
  return Array.from(new Set(list.map(absoluteUrl).filter(Boolean))).slice(0, 6);
}

function jsonLdScript(id, data) {
  return (
    '<script type="application/ld+json" id="' +
    id +
    '">' +
    JSON.stringify(data).replace(/</g, "\\u003c") +
    "</script>"
  );
}

function socialMeta(meta) {
  const tags = [
    ["property", "og:site_name", "Patygo Teknoloji"],
    ["property", "og:locale", "tr_TR"],
    ["property", "og:type", meta.type || "website"],
    ["property", "og:title", meta.title],
    ["property", "og:description", meta.description],
    ["property", "og:url", meta.url],
    ["property", "og:image", meta.image || DEFAULT_OG_IMAGE],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.title],
    ["name", "twitter:description", meta.description],
    ["name", "twitter:image", meta.image || DEFAULT_OG_IMAGE],
  ].concat(meta.extra || []);
  return tags
    .map(([attr, key, value]) => "<meta " + attr + '="' + key + '" content="' + escapeHtml(value) + '" />')
    .join("\n  ");
}

function setHead(html, head) {
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(head.title) + "</title>");
  out = out.replace(/\s*<meta name="description"[^>]*>/i, "");
  out = out.replace(/\s*<link rel="canonical"[^>]*>/i, "");
  out = out.replace(/\s*<meta (?:property="og:|name="twitter:)[^>]*>/gi, "");
  const block =
    '<meta name="description" content="' +
    escapeHtml(head.description) +
    '" />\n  ' +
    (head.robots ? '<meta name="robots" content="' + escapeHtml(head.robots) + '" />\n  ' : "") +
    (head.canonical ? '<link rel="canonical" href="' + escapeHtml(head.canonical) + '" />\n  ' : "") +
    socialMeta(head.social) +
    (head.jsonLd ? "\n  " + head.jsonLd : "") +
    "\n</head>";
  return out.replace(/<\/head>/i, "  " + block);
}

/** Approved reviews only; Google ignores aggregateRating without visible reviews behind it. */
function reviewJsonLd(reviewData) {
  const summary = reviewData && reviewData.summary;
  if (!summary || !(summary.count > 0)) return null;
  return {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: String(summary.average),
      reviewCount: summary.count,
      bestRating: "5",
      worstRating: "1",
    },
    review: (reviewData.reviews || []).slice(0, 5).map((item) => ({
      "@type": "Review",
      author: { "@type": "Person", name: item.author },
      datePublished: String(item.createdAt || "").slice(0, 10),
      reviewRating: { "@type": "Rating", ratingValue: String(item.rating), bestRating: "5", worstRating: "1" },
      name: item.title || undefined,
      reviewBody: item.body,
    })),
  };
}

function reviewSsrHtml(reviewData) {
  const summary = reviewData && reviewData.summary;
  if (!summary || !(summary.count > 0)) return "";
  const items = (reviewData.reviews || [])
    .slice(0, 5)
    .map(
      (item) =>
        "<li><strong>" +
        escapeHtml(item.rating + "/5" + (item.title ? " · " + item.title : "")) +
        "</strong> <span>" +
        escapeHtml(item.author) +
        "</span><p>" +
        escapeHtml(item.body) +
        "</p></li>"
    )
    .join("");
  return (
    '<section class="detail-ssr-reviews"><h2>Değerlendirmeler</h2><p>' +
    escapeHtml(summary.average + " / 5 · " + summary.count + " değerlendirme") +
    "</p><ul>" +
    items +
    "</ul></section>"
  );
}

/** Product page HTML for crawlers and link previews; urun-detay.js re-renders the same root. */
function renderProductHtml(shell, product, reviewData) {
  const name = plain(product.name, 200);
  const urlPath = product.urlPath || "";
  const url = SITE + urlPath;
  const gross = priceInclVat(product);
  const images = productImages(product);
  const longText = htmlToText(product.description || product.details) || name;
  const description = plain(longText, 300) || name + " — Patygo Teknoloji";
  const metaDescription = plain(description, 160);
  const title = name + " | Patygo Teknoloji";
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    image: images,
    description: plain(longText, 5000),
    sku: String(product.id || ""),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "TRY",
      price: String(gross),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
  if (product.brand) ld.brand = { "@type": "Brand", name: product.brand };
  if (product.barcode && /^\d{8,14}$/.test(String(product.barcode))) ld.gtin = String(product.barcode);
  if (product.manufacturerCode) ld.mpn = String(product.manufacturerCode);
  Object.assign(ld, reviewJsonLd(reviewData));

  let html = setHead(shell, {
    title,
    description: metaDescription,
    canonical: url,
    social: {
      type: "product",
      title,
      description: metaDescription,
      url,
      image: images[0] || "",
      extra: [
        ["property", "product:price:amount", String(gross)],
        ["property", "product:price:currency", "TRY"],
      ],
    },
    jsonLd: jsonLdScript("product-jsonld", ld),
  });
  const body =
    '<article class="detail-ssr">' +
    (product.brand ? '<span class="brand-tag">' + escapeHtml(product.brand) + "</span>" : "") +
    "<h1>" +
    escapeHtml(name) +
    "</h1>" +
    '<p class="price">' +
    escapeHtml(formatTry(gross)) +
    " <small>KDV dahil</small></p>" +
    (description && description !== name ? '<p class="detail-desc">' + escapeHtml(description) + "</p>" : "") +
    reviewSsrHtml(reviewData) +
    "</article>";
  html = html.replace(/(<div class="container product-detail" id="detailRoot">)[\s\S]*?(<\/div>)/, "$1\n        " + body + "\n      $2");
  return html;
}

function renderMissingProductHtml(shell) {
  return setHead(shell, {
    title: "Ürün bulunamadı | Patygo Teknoloji",
    description: "Aradığınız ürün şu anda satışta değil. Patygo Teknoloji ürün kataloğuna göz atın.",
    robots: "noindex",
    social: {
      title: "Ürün bulunamadı | Patygo Teknoloji",
      description: "Aradığınız ürün şu anda satışta değil.",
      url: SITE + "/urunler",
    },
  });
}

function findCategoryNames(categories, pathCats) {
  const list = Array.isArray(categories) ? categories : [];
  const slug = (value) => String(value || "").toLowerCase();
  const pick = (rows, key) => (rows || []).find((row) => row && slug(row.slug) === slug(key)) || null;
  const parent = pick(list, pathCats.parent);
  if (!parent) return null;
  const mid = pathCats.mid ? pick(parent.children, pathCats.mid) : null;
  if (pathCats.mid && !mid) return null;
  const child = mid && pathCats.child ? pick(mid.children, pathCats.child) : null;
  if (pathCats.child && !child) return null;
  return [parent, mid, child].filter(Boolean).map((row) => prettyCategoryName(row.name));
}

/** Mirrors PatygoCatalog.prettyCategoryName so SSR and client headings match. */
function prettyCategoryName(name) {
  const text = String(name || "").trim();
  if (!text || text !== text.toLocaleUpperCase("tr-TR")) return text;
  return text
    .split(/(\s+)/)
    .map((token) => {
      if (!token.trim() || token.length <= 3) return token;
      const lower = token.toLocaleLowerCase("tr-TR");
      return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
    })
    .join("");
}

/** Category listing head + visible h1; null when the path is not in the category tree. */
function renderCategoryHtml(html, categories, pathCats, canonPath) {
  const names = pathCats && pathCats.parent ? findCategoryNames(categories, pathCats) : null;
  if (!names || !names.length) return null;
  const leaf = names[names.length - 1];
  const title = leaf + " Fiyatları ve Modelleri | Patygo Teknoloji";
  const description = plain(
    leaf +
      " ürünleri KDV dahil fiyatlarla Patygo Teknoloji'de: " +
      names.join(" › ") +
      " kategorisinde stoktaki modeller, güvenli ödeme ve hızlı kargo.",
    160
  );
  const url = SITE + (canonPath || "/urunler");
  let out = setHead(html, {
    title,
    description,
    canonical: url,
    social: { title, description, url },
  });
  out = out.replace(/(<h1[^>]*data-catalog-title[^>]*>)[\s\S]*?(<\/h1>)/, "$1" + escapeHtml(leaf) + "$2");
  return out;
}

function renderMissingCategoryHtml(html) {
  return setHead(html, {
    title: "Kategori bulunamadı | Patygo Teknoloji",
    description: "Aradığınız kategori bulunamadı. Patygo Teknoloji ürün kataloğuna göz atın.",
    robots: "noindex",
    social: {
      title: "Kategori bulunamadı | Patygo Teknoloji",
      description: "Aradığınız kategori bulunamadı.",
      url: SITE + "/urunler",
    },
  });
}

/** ?sayfa=N listing pages are their own canonical (infinite scroll component pages). */
function withListingPage(html, page) {
  const n = Math.floor(Number(page) || 1);
  if (n <= 1) return html;
  const suffix = " – Sayfa " + n;
  let out = html.replace(/<title>([\s\S]*?)<\/title>/i, (_, title) => {
    const parts = title.split(" | ");
    parts[0] += suffix;
    return "<title>" + parts.join(" | ") + "</title>";
  });
  out = out.replace(
    /(<meta property="og:title" content=")([^"]*)(")/i,
    (_, a, title, b) => a + title.split(" | ").map((part, i) => (i ? part : part + suffix)).join(" | ") + b
  );
  out = out.replace(/(<link rel="canonical" href=")([^"?]*)("[^>]*>)/i, "$1$2?sayfa=" + n + "$3");
  out = out.replace(/(<meta property="og:url" content=")([^"?]*)(")/i, "$1$2?sayfa=" + n + "$3");
  return out;
}

module.exports = {
  renderProductHtml,
  renderMissingProductHtml,
  renderCategoryHtml,
  renderMissingCategoryHtml,
  withListingPage,
  findCategoryNames,
  priceInclVat,
  reviewJsonLd,
};
