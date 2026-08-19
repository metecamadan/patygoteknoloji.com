/** Supplier thumbnail suffixes (e.g. 115392_th.jpg) must not appear in storefront galleries. */
const SUPPLIER_THUMB_RE = /_th\.(jpe?g|png|webp)(\?.*)?$/i;

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

module.exports = {
  SUPPLIER_THUMB_RE,
  supplierImageFullUrl,
  isSupplierThumbnailUrl,
  filterSupplierGalleryImages,
};
