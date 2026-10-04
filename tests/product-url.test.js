const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildProductSlugBase,
  buildProductRouteIndex,
  categoryUrlSegment,
  parseProductRoutePath,
  productPagePath,
  productPageUrl,
  resolveProductIdFromRoute,
  resolveLegacyProductPath,
  legacyRedirectMapText,
  slugify,
} = require("../lib/product-url");

test("slugify folds Turkish İ instead of splitting it", () => {
  assert.equal(slugify("İşlemci Soğutucu"), "islemci-sogutucu");
  assert.equal(slugify("Yazıcı Kartuşu"), "yazici-kartusu");
});

test("İ-prefixed noise words are stripped like their ASCII form", () => {
  const product = { id: "x-1", brand: "INTEL", name: "Intel Core i5-12400 İşlemci", siteChild: "islemciler" };
  const slug = buildProductSlugBase(product);
  assert.doesNotMatch(slug, /i-slemci/);
  assert.match(slug, /^[a-z0-9-]+$/);
});

test("pre-fix i-slemci URLs resolve to the canonical path for 301", () => {
  const product = { id: "sup-1-abcd1234", brand: "ÇAYKUR", name: "Çaykur İnce Belli Bardak İkili Set", siteChild: "gida" };
  const index = buildProductRouteIndex([product]);
  const canonical = index.byId[product.id];
  const legacySlug = buildProductSlugBase(product, { legacy: true });
  assert.notEqual("/" + canonical.split("/")[1] + "/" + legacySlug, canonical);
  assert.match(legacySlug, /i-nce/);
  const segment = canonical.split("/")[1];
  assert.equal(resolveLegacyProductPath(index, segment, legacySlug), canonical);
  assert.equal(resolveLegacyProductPath(index, segment, canonical.split("/")[2]), "");
  assert.equal(resolveLegacyProductPath(index, segment, "yok-boyle-bir-urun"), "");
});

test("legacy redirect map lists only pre-fix aliases for nginx", () => {
  const legacyProduct = { id: "sup-1-abcd1234", brand: "ÇAYKUR", name: "Çaykur İnce Belli Bardak İkili Set", siteChild: "gida" };
  const plainProduct = { id: "sup-2-ef567890", brand: "HP", name: "HP 212A Siyah Toner", siteChild: "toner" };
  const index = buildProductRouteIndex([legacyProduct, plainProduct]);
  const canonical = index.byId[legacyProduct.id];
  const legacyPath = "/" + canonical.split("/")[1] + "/" + buildProductSlugBase(legacyProduct, { legacy: true });
  const lines = legacyRedirectMapText(index).trim().split("\n");
  assert.ok(lines.includes(legacyPath + " " + canonical + ";"));
  assert.ok(lines.includes(legacyPath + "/ " + canonical + ";"));
  assert.ok(lines.every((line) => /^\/[a-z0-9-]+\/[a-z0-9-]+\/? \/[a-z0-9-]+\/[a-z0-9-]+;$/.test(line)));
  assert.ok(lines.every((line) => !line.includes(index.byId[plainProduct.id] + " ")));
  const plainIndex = buildProductRouteIndex([plainProduct]);
  const plainCanonical = plainIndex.byId[plainProduct.id];
  assert.deepEqual(legacyRedirectMapText(plainIndex).trim().split("\n"), [
    plainCanonical + "-ef567890 " + plainCanonical + ";",
    plainCanonical + "-ef567890/ " + plainCanonical + ";",
  ]);
  assert.equal(legacyRedirectMapText(null), "");
});

test("server writes the legacy map with catalog snapshots and warms when it is missing", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /\.runtime", "nginx", "legacy-product-redirects\.map"/);
  assert.match(serverJs, /function writeCatalogBootstrapSnapshots\(\) \{[\s\S]{0,200}writeLegacyRedirectMap\(index\.routeIndex\)/);
  assert.match(serverJs, /bootstrapSnapshotsReady\(\) && legacyRedirectMapPresent\(\)/);
});

test("category segment maps notebooklar to notebook", () => {
  assert.equal(categoryUrlSegment({ siteChild: "notebooklar" }), "notebook");
  assert.equal(categoryUrlSegment({ urlCategorySegment: "notebook" }), "notebook");
});

test("manual urlSlug produces canonical Lenovo path", () => {
  const product = {
    id: "sup-150-20-10-0738-237e44a9",
    brand: "LENOVO",
    name: 'Lenovo V15 83A100KXTR_40 Intel Core I7 1355U 40gb Ram 512GB SSD 15.6" FreeDOS Notebook (Upg)',
    siteChild: "notebooklar",
    urlSlug: "lenovo-v15-83a100kxtr-i7-1355u-40gb",
    urlCategorySegment: "notebook",
  };
  assert.equal(productPagePath(product), "/notebook/lenovo-v15-83a100kxtr-i7-1355u-40gb");
  assert.equal(
    productPageUrl(product, "https://patygoteknoloji.com"),
    "https://patygoteknoloji.com/notebook/lenovo-v15-83a100kxtr-i7-1355u-40gb"
  );
});

test("route index resolves slug paths and handles collisions", () => {
  const shared = {
    brand: "HP",
    name: "HP ProBook 450 G10",
    siteChild: "notebooklar",
  };
  const index = buildProductRouteIndex([
    Object.assign({ id: "a" }, shared),
    Object.assign({ id: "b" }, shared),
  ]);
  const slug = buildProductSlugBase(shared);
  assert.equal(index.byPath["notebook/" + slug], "a");
  assert.ok(index.byId.b.endsWith("-b") || index.byId.b.includes("-"));
  assert.equal(resolveProductIdFromRoute(index, "notebook", index.byId.a.split("/").pop()), "a");
});

test("normalizeProduct keeps SEO urlSlug overrides for route index", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /urlSlug: String\(p\.urlSlug/);
  assert.match(serverJs, /urlCategorySegment: String\(p\.urlCategorySegment/);
});

test("parseProductRoutePath accepts two-segment product URLs", () => {
  assert.deepEqual(parseProductRoutePath("/notebook/lenovo-v15-83a100kxtr-i7-1355u-40gb"), {
    segment: "notebook",
    slug: "lenovo-v15-83a100kxtr-i7-1355u-40gb",
  });
  assert.equal(parseProductRoutePath("/urunler"), null);
  assert.equal(parseProductRoutePath("/notebook"), null);
});

test("catalog.js productHref prefers slug urlPath over legacy id query", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const catalogJs = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "catalog.js"), "utf8");
  assert.match(catalogJs, /if \(productOrId\.urlPath\) return productOrId\.urlPath/);
  assert.match(catalogJs, /categorySegment && productOrId\.slug/);
});
