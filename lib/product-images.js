/** Supplier thumbnail suffixes (e.g. 115392_th.jpg) must not appear in storefront galleries. */
const SUPPLIER_THUMB_RE = /_th\.(jpe?g|png|webp)(\?.*)?$/i;

function mirrorHelpers() {
  return require("./product-image-mirror");
}

function isUsableImageUrl(url) {
  const href = String(url || "").trim();
  if (!href) return false;
  if (/^https?:\/\//i.test(href)) return true;
  return href.startsWith("/");
}

function mirrorIndexHasEntries(mirrorIndex) {
  return Boolean(
    mirrorIndex && typeof mirrorIndex === "object" && Object.keys(mirrorIndex).length > 0
  );
}

function supplierImageFullUrl(url) {
  const href = String(url || "")
    .trim()
    .replace(/^http:\/\//i, "https://");
  if (!href) return "";
  return href.replace(SUPPLIER_THUMB_RE, (_, ext, query) => `.${String(ext || "jpg").toLowerCase()}${query || ""}`);
}

function isSupplierThumbnailUrl(url) {
  return SUPPLIER_THUMB_RE.test(String(url || "").trim());
}

/** Drop _th duplicates; upgrade lone thumbnails to their full-size URL. */
function filterSupplierGalleryImages(images, max) {
  const cap = Math.max(1, Number(max) || 10);
  const list = (Array.isArray(images) ? images : [])
    .map((raw) =>
      String(raw || "")
        .trim()
        .replace(/^http:\/\//i, "https://")
    )
    .filter(Boolean);
  const fullPresent = new Set(
    list.filter((url) => !isSupplierThumbnailUrl(url)).map((url) => supplierImageFullUrl(url))
  );
  const seen = new Set();
  const out = [];
  for (const url of list) {
    let href = url;
    if (isSupplierThumbnailUrl(href)) {
      const full = supplierImageFullUrl(href);
      if (fullPresent.has(full) && full !== href) continue;
      href = full;
    }
    const key = supplierImageFullUrl(href);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(href);
    if (out.length >= cap) break;
  }
  return out;
}

function collectRawProductImages(product, max) {
  const cap = Math.max(1, Number(max) || 10);
  const images = Array.isArray(product && product.images)
    ? product.images.filter(Boolean)
    : product && product.image
      ? [product.image]
      : [];
  const normalized = images
    .map((url) =>
      String(url || "")
        .trim()
        .replace(/^http:\/\//i, "https://")
    )
    .filter(Boolean);
  return filterSupplierGalleryImages(normalized, cap);
}

function resolveStorefrontProductImages(product, options) {
  const opts = options || {};
  const cap = Math.max(1, Number(opts.limit) || 10);
  const raw = collectRawProductImages(product, cap);
  const mirrorIndex = opts.mirrorIndex;
  const siteBaseUrl = String(opts.siteBaseUrl || "").replace(/\/+$/, "");
  if (!mirrorIndexHasEntries(mirrorIndex) || !siteBaseUrl) return raw;
  const { resolveFeedImageUrl, isOwnSiteImage, absoluteImageUrl, mirrorEntryIsUsable } =
    mirrorHelpers();
  const out = [];
  const seen = new Set();
  for (const url of raw) {
    const abs = absoluteImageUrl(url, siteBaseUrl) || url;
    const entry = mirrorIndex[abs];
    if (entry && opts.dataRoot && !mirrorEntryIsUsable(entry, opts.dataRoot)) continue;
    let resolved = resolveFeedImageUrl(url, siteBaseUrl, mirrorIndex);
    if (!resolved && isOwnSiteImage(url, siteBaseUrl)) {
      resolved = absoluteImageUrl(url, siteBaseUrl);
    }
    if (!resolved || seen.has(resolved)) continue;
    if (opts.dataRoot && entry && !mirrorEntryIsUsable(entry, opts.dataRoot)) continue;
    seen.add(resolved);
    out.push(resolved);
    if (out.length >= cap) break;
  }
  return out;
}

/** Storefront/Akakce gate: supplier needs a mirrored or own-site image when mirror index is populated. */
function productHasStorefrontImage(product, options) {
  const opts = options || {};
  const raw = collectRawProductImages(product, 10);
  if (!raw.length) return false;
  const mirrorIndex = opts.mirrorIndex;
  const siteBaseUrl = String(opts.siteBaseUrl || "").replace(/\/+$/, "");
  if (product && product.source === "supplier" && mirrorIndexHasEntries(mirrorIndex) && siteBaseUrl) {
    return resolveStorefrontProductImages(product, opts).length > 0;
  }
  return raw.some((url) => isUsableImageUrl(url));
}

module.exports = {
  SUPPLIER_THUMB_RE,
  supplierImageFullUrl,
  isSupplierThumbnailUrl,
  filterSupplierGalleryImages,
  collectRawProductImages,
  resolveStorefrontProductImages,
  productHasStorefrontImage,
  mirrorIndexHasEntries,
};
