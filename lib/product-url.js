"use strict";

const { foldSearchText } = require("./tr-text");

const SLUG_MAX = 96;
const NOISE_WORDS =
  /\b(en ucuz|super fiyat|kampanyali|hediyeli|firsat|upg|kutulu|box|freedos|notebook|laptop|işlemci|islemci|tarayici|yazici|monitor|monitör)\b/gi;

/** Cut to SLUG_MAX after hyphen collapse; may still end with "-" (legacy bug). */
function cutSlug(text) {
  return String(text || "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

function slugify(input) {
  // Trim again after slice: otherwise a 96-char cut can leave a trailing "-"
  // that parseProductRoutePath rejects → live product HTML 404s while the API still works.
  return cutSlug(foldSearchText(input)).replace(/^-+|-+$/g, "");
}

/** Pre-2026-10 slugs: plain toLowerCase() split "İşlemci" into "i-slemci". Kept only for 301s. */
function legacySlugify(input) {
  const folded = String(input || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
  return cutSlug(folded).replace(/^-+|-+$/g, "");
}

/** Pre-fix cut that kept a trailing "-"; used only as a 301 alias source. */
function legacyCutSlugify(input) {
  return cutSlug(foldSearchText(input));
}

function legacyCutLegacySlugify(input) {
  const folded = String(input || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
  return cutSlug(folded);
}

const CATEGORY_SEGMENT_OVERRIDES = {
  notebooklar: "notebook",
  notebook: "notebook",
};

function productDisplayName(product) {
  const brand = String((product && product.brand) || "").trim();
  const name = String((product && product.name) || "").trim();
  if (!name) return brand;
  // foldSearchText: ALL-CAPS brand "LOGITECH" must still match name "Logitech …".
  // toLocaleLowerCase("tr-TR") turns ASCII "I" into "ı", so startsWith failed and the
  // slug became "logitech-logitech-…" (GSC 404 noise).
  if (brand) {
    const brandFold = foldSearchText(brand);
    const nameFold = foldSearchText(name);
    if (brandFold && nameFold.startsWith(brandFold)) return name;
  }
  return brand ? brand + " " + name : name;
}

/** Pre-fix display that used tr-TR startsWith (doubled ALL-CAPS brands). Legacy 301 only. */
function legacyProductDisplayName(product) {
  const brand = String((product && product.brand) || "").trim();
  const name = String((product && product.name) || "").trim();
  if (!name) return brand;
  if (brand && name.toLocaleLowerCase("tr-TR").startsWith(brand.toLocaleLowerCase("tr-TR"))) {
    return name;
  }
  return brand ? brand + " " + name : name;
}

function categoryUrlSegment(product) {
  const override = String((product && product.urlCategorySegment) || "")
    .trim()
    .toLowerCase();
  if (override) return slugify(override).slice(0, 40) || "urun";
  const child = String((product && (product.siteChild || product.alt)) || "")
    .trim()
    .toLowerCase();
  const mid = String((product && (product.siteMid || product.mid)) || "")
    .trim()
    .toLowerCase();
  const raw = child || mid || "urun";
  if (CATEGORY_SEGMENT_OVERRIDES[raw]) return CATEGORY_SEGMENT_OVERRIDES[raw];
  if (raw.endsWith("lar") && raw.length > 4) return raw.slice(0, -3);
  if (raw.endsWith("ler") && raw.length > 4) return raw.slice(0, -3);
  return slugify(raw).slice(0, 40) || "urun";
}

function idHashSuffix(productId) {
  const id = String(productId || "");
  const tail = id.includes("-") ? id.split("-").pop() : id;
  return slugify(tail).slice(0, 8);
}

function buildProductSlugBase(product, options) {
  const legacy = Boolean(options && options.legacy);
  const cutOnly = Boolean(options && options.cutOnly);
  const toSlug = legacy
    ? cutOnly
      ? legacyCutLegacySlugify
      : legacySlugify
    : cutOnly
      ? legacyCutSlugify
      : slugify;
  const manual = String((product && product.urlSlug) || "").trim();
  if (manual) return toSlug(manual);
  let text = productDisplayName(product);
  // "İ" must become plain "I" first or the /işlemci/i noise filter never matches "İşlemci".
  if (!legacy) text = text.replace(/İ/g, "I");
  text = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/_/g, " ")
    .replace(NOISE_WORDS, " ")
    .replace(/\bintel\s+core\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:inch|inç|")\b/gi, " ")
    .replace(/\b\d+\s*gb\s*(?:ssd|hdd|nvme)\b/gi, " ")
    .replace(/\b\d+\s*tb\s*(?:ssd|hdd|nvme)\b/gi, " ")
    .replace(/\b(\d+)\s*gb\s*ram\b/gi, "$1gb")
    .replace(/\s+/g, " ")
    .trim();
  let slug = toSlug(text);
  if (!slug) slug = toSlug(product && product.id);
  return slug;
}

function buildProductSlug(product, collision) {
  let slug = buildProductSlugBase(product);
  if (collision) slug = slug + "-" + idHashSuffix(product && product.id);
  return slug;
}

function productPagePath(product, collision) {
  const segment = categoryUrlSegment(product);
  const slug = buildProductSlug(product, collision);
  return "/" + segment + "/" + slug;
}

function productPageUrl(product, siteBaseUrl, collision) {
  const base = String(siteBaseUrl || "").replace(/\/+$/, "");
  const path = productPagePath(product, collision);
  return base ? base + path : path;
}

function buildProductRouteIndex(products) {
  const byPath = Object.create(null);
  const byId = Object.create(null);
  const pathCounts = Object.create(null);
  const list = Array.isArray(products) ? products.filter(Boolean) : [];

  const drafts = list.map((product) => {
    const segment = categoryUrlSegment(product);
    const slug = buildProductSlug(product, false);
    const key = segment + "/" + slug;
    return { product, segment, slug, key };
  });

  drafts.forEach((draft) => {
    pathCounts[draft.key] = (pathCounts[draft.key] || 0) + 1;
  });

  const claimed = Object.create(null);
  drafts.forEach((draft) => {
    let slug = buildProductSlug(draft.product, false);
    const baseKey = draft.segment + "/" + slug;
    if (pathCounts[draft.key] > 1) {
      if (claimed[baseKey]) {
        slug = buildProductSlug(draft.product, true);
      } else {
        claimed[baseKey] = true;
      }
    }
    const path = "/" + draft.segment + "/" + slug;
    const routeKey = draft.segment + "/" + slug;
    byPath[routeKey] = draft.product.id;
    byId[draft.product.id] = path;
  });

  const legacyByPath = Object.create(null);
  drafts.forEach((draft) => {
    const oldSlug = buildProductSlugBase(draft.product, { legacy: true });
    const cutSlugModern = buildProductSlugBase(draft.product, { cutOnly: true });
    const cutSlugLegacy = buildProductSlugBase(draft.product, { legacy: true, cutOnly: true });
    // ALL-CAPS brand doubling (LOGITECH + Logitech …) before foldSearchText fix.
    const buggyText = legacyProductDisplayName(draft.product);
    const doubledModern = slugify(buggyText);
    const doubledLegacy = legacySlugify(buggyText);
    const doubledCutModern = cutSlug(foldSearchText(buggyText));
    const doubledCutLegacy = cutSlug(
      String(buggyText || "")
        .toLowerCase()
        .replace(/ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/ı/g, "i")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c")
    );
    const candidates = [
      oldSlug,
      oldSlug + "-" + idHashSuffix(draft.product.id),
      cutSlugModern,
      cutSlugModern + "-" + idHashSuffix(draft.product.id),
      cutSlugLegacy,
      cutSlugLegacy + "-" + idHashSuffix(draft.product.id),
      doubledModern,
      doubledModern + "-" + idHashSuffix(draft.product.id),
      doubledLegacy,
      doubledLegacy + "-" + idHashSuffix(draft.product.id),
      doubledCutModern,
      doubledCutLegacy,
    ];
    candidates.forEach((candidate) => {
      if (!candidate) return;
      const key = draft.segment + "/" + candidate;
      if (byPath[key] || legacyByPath[key]) return;
      legacyByPath[key] = draft.product.id;
    });
  });

  return { byPath, byId, legacyByPath };
}

/** Canonical path for a pre-fix product URL (301 target), or "" when the path is not a legacy alias. */
function resolveLegacyProductPath(routeIndex, segment, slug) {
  if (!routeIndex || !routeIndex.legacyByPath || !segment || !slug) return "";
  const key =
    String(segment).trim().toLowerCase() + "/" + String(slug).trim().toLowerCase();
  const id = routeIndex.legacyByPath[key];
  return (id && routeIndex.byId[id]) || "";
}

const MAP_KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const MAP_TARGET_RE = /^\/[a-z0-9-]+\/[a-z0-9-]+$/;

/**
 * nginx server-block include: one exact-match location per pre-fix product URL (with and
 * without trailing slash). Exact locations avoid map_hash_* sizing, which must precede every map.
 */
function legacyRedirectNginxText(routeIndex) {
  if (!routeIndex || !routeIndex.legacyByPath || !routeIndex.byId) return "";
  const lines = [];
  Object.keys(routeIndex.legacyByPath)
    .sort()
    .forEach((key) => {
      const target = routeIndex.byId[routeIndex.legacyByPath[key]];
      if (!target || !MAP_KEY_RE.test(key) || !MAP_TARGET_RE.test(target)) return;
      if ("/" + key === target) return;
      ["/" + key, "/" + key + "/"].forEach((from) => {
        lines.push("location = " + from + " { return 301 " + target + "$is_args$args; }");
      });
    });
  return lines.length ? lines.join("\n") + "\n" : "";
}

function resolveProductIdFromRoute(routeIndex, segment, slug) {
  if (!routeIndex || !segment || !slug) return "";
  const key =
    String(segment).trim().toLowerCase() + "/" + String(slug).trim().toLowerCase();
  return routeIndex.byPath[key] || "";
}

function parseProductRoutePath(urlPath) {
  const parts = String(urlPath || "")
    .split("/")
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const segment = String(parts[0] || "").toLowerCase();
  const rawSlug = String(parts[1] || "").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment)) return null;
  // Allow trailing "-" from the old SLUG_MAX cut; normalize before lookup.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-*$/.test(rawSlug)) return null;
  const slug = rawSlug.replace(/-+$/, "");
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return { segment, slug, rawSlug };
}

function attachProductUrlFields(product, routeIndex) {
  if (!product || !product.id) return product;
  const urlPath =
    (routeIndex && routeIndex.byId[product.id]) || productPagePath(product, false);
  const parts = urlPath.split("/").filter(Boolean);
  return Object.assign({}, product, {
    urlPath,
    categorySegment: parts[0] || categoryUrlSegment(product),
    slug: parts[1] || buildProductSlugBase(product),
  });
}

module.exports = {
  slugify,
  categoryUrlSegment,
  buildProductSlug,
  buildProductSlugBase,
  productPagePath,
  productPageUrl,
  buildProductRouteIndex,
  resolveProductIdFromRoute,
  resolveLegacyProductPath,
  legacyRedirectNginxText,
  parseProductRoutePath,
  attachProductUrlFields,
  idHashSuffix,
};
