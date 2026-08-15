const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildTreeFromSupplierProducts,
  mergeCategoryTrees,
  suggestSiteCategory,
  browseChildName,
  cleanCategoryName,
  syncXmlSiteCategories,
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

test("Intel Alt kategori folds into Ara İşlemciler, not seed İşlemci", () => {
  assert.equal(
    browseChildName({ mid: "İşlemciler", sub: "Intel İşlemciler" }),
    "İşlemciler"
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  const store = createCategoryStore(root);
  const cats = mergeCategoryTrees(store.list(), [
    {
      name: "KİŞİSEL BİLGİSAYARLAR",
      slug: "kisisel-bilgisayarlar",
      children: [{ name: "Bilgisayar Bileşenleri", slug: "bilgisayar-bilesenleri" }],
    },
    {
      name: "OEM & ÇEVRE BİRİMLERİ",
      slug: "oem-cevre-birimleri",
      children: [{ name: "İşlemciler", slug: "islemciler" }],
    },
  ]);
  const pair = suggestSiteCategory(
    {
      mainCategory: "KİŞİSEL BİLGİSAYARLAR",
      midCategory: "Bilgisayar Bileşenleri",
      subCategory: "İşlemci",
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "İşlemciler",
      xmlSubCategory: "Intel İşlemciler",
    },
    cats
  );
  assert.equal(pair.siteParent, "oem-cevre-birimleri");
  assert.equal(pair.siteChild, "islemciler");
  fs.rmSync(root, { recursive: true, force: true });
});

test("rename keeps slug so XML products stay on the same nav category", () => {
  const existing = [
    {
      slug: "oem-cevre-birimleri",
      name: "Bilgisayar Parçaları",
      xmlNames: ["OEM & ÇEVRE BİRİMLERİ"],
      children: [
        {
          slug: "islemciler",
          name: "İşlemci",
          xmlNames: ["İşlemciler"],
        },
      ],
    },
  ];
  const pair = suggestSiteCategory(
    {
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "İşlemciler",
      xmlSubCategory: "Intel İşlemciler",
    },
    existing
  );
  assert.equal(pair.siteParent, "oem-cevre-birimleri");
  assert.equal(pair.siteChild, "islemciler");
  const merged = mergeCategoryTrees(existing, [
    {
      name: "OEM & ÇEVRE BİRİMLERİ",
      slug: "oem-cevre-birimleri",
      children: [{ name: "İşlemciler", slug: "islemciler" }],
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].slug, "oem-cevre-birimleri");
  assert.equal(merged[0].name, "Bilgisayar Parçaları");
  assert.ok((merged[0].xmlNames || []).includes("OEM & ÇEVRE BİRİMLERİ"));
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
  assert.ok(!merged.some((row) => row.slug === "bilgisayar-tablet"));
  assert.ok(merged.some((row) => row.slug === "oem-cevre-birimleri"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("sync restores missing XML parent KİŞİSEL BİLGİSAYARLAR", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-"));
  const store = createCategoryStore(root);
  store.save([
    {
      slug: "oem-cevre-birimleri",
      name: "OEM & ÇEVRE BİRİMLERİ",
      children: [{ slug: "islemciler", name: "İşlemciler" }],
    },
    {
      slug: "kisisel-bakim-ve-kozmetik",
      name: "KİŞİSEL BAKIM VE KOZMETİK",
      children: [{ slug: "sampuan", name: "Şampuan" }],
    },
  ]);
  const updates = [];
  const manager = {
    listProducts() {
      return [
        {
          supplierSlot: "supplier-1",
          supplierSku: "NB-1",
          mainCategory: "KİŞİSEL BİLGİSAYARLAR",
          midCategory: "Taşınabilir Bilgisayarlar",
          subCategory: "Notebooklar",
        },
        {
          supplierSlot: "supplier-1",
          supplierSku: "CPU-1",
          mainCategory: "OEM & ÇEVRE BİRİMLERİ",
          midCategory: "İşlemciler",
          subCategory: "Intel İşlemciler",
        },
      ];
    },
    updateProducts(rows) {
      updates.push(...rows);
    },
  };
  try {
    const result = syncXmlSiteCategories({
      manager,
      categoryStore: store,
      slotId: "supplier-1",
    });
    const tree = store.list();
    assert.equal(result.empty, false);
    assert.ok(tree.some((row) => row.slug === "kisisel-bilgisayarlar"));
    assert.ok(tree.some((row) => row.slug === "oem-cevre-birimleri"));
    assert.ok(tree.some((row) => row.slug === "kisisel-bakim-ve-kozmetik"));
    const pc = tree.find((row) => row.slug === "kisisel-bilgisayarlar");
    assert.ok(pc.children.some((child) => child.slug === "notebooklar"));
    const notebook = updates.find((row) => row.supplierSku === "NB-1");
    assert.equal(notebook.siteParent, "kisisel-bilgisayarlar");
    assert.equal(notebook.siteChild, "notebooklar");
    assert.equal(notebook.active, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
