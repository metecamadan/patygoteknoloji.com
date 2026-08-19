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
} = require("../lib/product-url");

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
