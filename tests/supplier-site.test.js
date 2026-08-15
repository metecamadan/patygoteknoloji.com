const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildTreeFromSupplierProducts,
  mergeCategoryTrees,
  suggestSiteCategory,
  cleanCategoryName,
} = require("../lib/supplier-site");
const { createCategoryStore, slugifyCategory } = require("../lib/categories");
const { queryPublicCatalog } = require("../lib/catalog");

test("XML ana/ara kategori becomes a two-level site tree", () => {
  const tree = buildTreeFromSupplierProducts([
    { mainCategory: "OEM &amp; ÇEVRE BİRİMLERİ", midCategory: "İşlemciler" },
    { mainCategory: "OEM & ÇEVRE BİRİMLERİ", midCategory: "İşlemciler" },
    { mainCategory: "KİŞİSEL BİLGİSAYARLAR", midCategory: "Taşınabilir Bilgisayarlar" },
  ]);
  assert.equal(cleanCategoryName("OEM &amp; ÇEVRE BİRİMLERİ"), "OEM & ÇEVRE BİRİMLERİ");
  assert.equal(tree.length, 2);
  const oem = tree.find((row) => row.slug === slugifyCategory("OEM & ÇEVRE BİRİMLERİ"));
  assert.ok(oem);
  assert.equal(oem.children[0].name, "İşlemciler");
  const pair = suggestSiteCategory(
    { mainCategory: "OEM & ÇEVRE BİRİMLERİ", midCategory: "İşlemciler" },
    tree
  );
  assert.equal(pair.siteParent, oem.slug);
  assert.equal(pair.siteChild, oem.children[0].slug);
});

test("merge keeps existing site categories and adds XML parents", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  const store = createCategoryStore(root);
  const merged = mergeCategoryTrees(store.list(), [
    {
      name: "OEM & ÇEVRE BİRİMLERİ",
      slug: "oem-cevre-birimleri",
      children: [{ name: "İşlemciler", slug: "islemciler" }],
    },
  ]);
  assert.ok(merged.some((row) => row.slug === "bilgisayar-tablet"));
  assert.ok(merged.some((row) => row.slug === "oem-cevre-birimleri"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("queryPublicCatalog pages and filters by site category", () => {
  const products = Array.from({ length: 60 }, (_, i) => ({
    id: "p-" + i,
    name: "Ürün " + i,
    brand: "PATYGO",
    price: 10 + i,
    category: i < 5 ? "bilgisayar-tablet" : "oem-cevre-birimleri",
    siteChild: i < 5 ? "notebook" : "islemciler",
    active: true,
  }));
  const page1 = queryPublicCatalog(products, { page: 1, limit: 48 });
  assert.equal(page1.products.length, 48);
  assert.equal(page1.total, 60);
  assert.equal(page1.totalPages, 2);
  const notebooks = queryPublicCatalog(products, {
    kategori: "bilgisayar-tablet",
    alt: "notebook",
  });
  assert.equal(notebooks.total, 5);
  const one = queryPublicCatalog(products, { id: "p-3" });
  assert.equal(one.products[0].id, "p-3");
});
