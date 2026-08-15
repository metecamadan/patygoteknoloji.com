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

test("Intel Alt kategori maps onto schema ANA/ARA/ALT leaves", () => {
  assert.equal(
    browseChildName({ mid: "İşlemciler", sub: "Intel İşlemciler" }),
    "İşlemciler"
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  const store = createCategoryStore(root);
  const pair = suggestSiteCategory(
    {
      mainCategory: "KİŞİSEL BİLGİSAYARLAR",
      midCategory: "Bilgisayar Bileşenleri",
      subCategory: "İşlemci",
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "İşlemciler",
      xmlSubCategory: "Intel İşlemciler",
    },
    store.list()
  );
  assert.equal(pair.siteParent, "bilgisayar-bilesenleri");
  assert.equal(pair.siteMid, "islemciler");
  assert.equal(pair.siteChild, "intel-islemciler");
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

test("merge aliases XML OEM parent onto curated Bilgisayar Bileşenleri", () => {
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
  assert.ok(merged.some((row) => row.slug === "bilgisayar-bilesenleri"));
  assert.ok(!merged.some((row) => row.slug === "oem-cevre-birimleri"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("sync maps XML products onto the curated schema without rebuilding the menu", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-"));
  const store = createCategoryStore(root);
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
          siteParent: "oem-cevre-birimleri",
          siteChild: "islemciler",
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
    assert.ok(tree.some((row) => row.slug === "bilgisayar-tablet"));
    assert.ok(tree.some((row) => row.slug === "bilgisayar-bilesenleri"));
    assert.ok(!tree.some((row) => row.slug === "kisisel-bilgisayarlar"));
    assert.ok(!tree.some((row) => row.slug === "oem-cevre-birimleri"));
    const notebook = updates.find((row) => row.supplierSku === "NB-1");
    assert.equal(notebook.siteParent, "bilgisayar-tablet");
    assert.equal(notebook.siteMid, "tasinabilir-bilgisayarlar");
    assert.equal(notebook.siteChild, "notebooklar");
    assert.equal(notebook.active, undefined);
    const cpu = updates.find((row) => row.supplierSku === "CPU-1");
    assert.equal(cpu.siteParent, "bilgisayar-bilesenleri");
    assert.equal(cpu.siteMid, "islemciler");
    assert.equal(cpu.siteChild, "intel-islemciler");
    assert.equal(cpu.active, undefined);
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

test("queryPublicCatalog sorts popular products by sales and views first", () => {
  const products = [
    {
      id: "quiet",
      name: "Sakin Ürün",
      brand: "NO-NAME",
      price: 50,
      category: "bilgisayar-tablet",
      active: true,
    },
    {
      id: "hot",
      name: "Popüler Ürün",
      brand: "NO-NAME",
      price: 50,
      category: "bilgisayar-tablet",
      active: true,
    },
    {
      id: "apple-box",
      name: "Apple Kutu",
      brand: "Apple",
      price: 200,
      category: "bilgisayar-tablet",
      image: "https://cdn.example/a.jpg",
      active: true,
    },
  ];
  const ranked = queryPublicCatalog(products, {
    kategori: "bilgisayar-tablet",
    sort: "popular",
    popularity: { hot: 80 },
    limit: 12,
  });
  assert.deepEqual(
    ranked.products.map((row) => row.id),
    ["hot", "apple-box", "quiet"]
  );
  assert.equal(ranked.products.length, 3);
});

test("homeFeaturedCatalog groups 12 popular products per ANA category", () => {
  const { homeFeaturedCatalog } = require("../lib/catalog");
  const parents = [
    "bilgisayar-tablet",
    "bilgisayar-bilesenleri",
    "kartus-toner",
    "baski-cozumleri",
    "yapi-gerecleri",
    "ofis-urunleri",
  ];
  const products = [];
  parents.forEach((slug) => {
    for (let i = 0; i < 15; i += 1) {
      products.push({
        id: slug + "-" + i,
        name: slug + " " + String(i).padStart(2, "0"),
        brand: "NO-NAME",
        price: 100,
        category: slug,
        active: true,
      });
    }
  });
  const featured = homeFeaturedCatalog(products, {
    popularity: { "bilgisayar-tablet-3": 500, "yapi-gerecleri-1": 400 },
    limit: 12,
  });
  assert.equal(featured.perCategory, 12);
  assert.equal(featured.byParent["bilgisayar-tablet"][0].id, "bilgisayar-tablet-3");
  assert.equal(featured.byParent["yapi-gerecleri"][0].id, "yapi-gerecleri-1");
  parents.forEach((slug) => {
    assert.equal(featured.byParent[slug].length, 12);
  });
  assert.equal(featured.products.length, 12);
  assert.equal(featured.products[0].id, "bilgisayar-tablet-3");
  assert.equal(featured.products[4].id, "yapi-gerecleri-1");
});

test("homeFeaturedCatalog mixes ALT types inside an ANA instead of filling with notebooks", () => {
  const { homeFeaturedCatalog } = require("../lib/catalog");
  const products = [];
  for (let i = 0; i < 20; i += 1) {
    products.push({
      id: "nb-" + i,
      name: "Notebook " + i,
      brand: "NO-NAME",
      price: 1000,
      category: "bilgisayar-tablet",
      siteChild: "notebooklar",
      active: true,
    });
  }
  [
    ["mouse-1", "Mouse", "mouse"],
    ["klavye-1", "Klavye", "klavye"],
    ["monitor-1", "Monitor", "monitorler"],
    ["combo-1", "Set", "klavye-ve-mouse"],
  ].forEach(([id, name, child]) => {
    products.push({
      id,
      name,
      brand: "NO-NAME",
      price: 200,
      category: "bilgisayar-tablet",
      siteChild: child,
      active: true,
    });
  });
  const popularity = {};
  for (let i = 0; i < 20; i += 1) popularity["nb-" + i] = 900 - i;
  popularity["mouse-1"] = 10;
  popularity["klavye-1"] = 9;
  popularity["monitor-1"] = 8;
  popularity["combo-1"] = 7;
  const featured = homeFeaturedCatalog(products, { popularity, limit: 12 });
  const computers = featured.byParent["bilgisayar-tablet"];
  const alts = computers.map((row) => row.alt);
  assert.equal(computers[0].id, "nb-0");
  assert.ok(alts.includes("mouse"));
  assert.ok(alts.includes("klavye"));
  assert.ok(alts.includes("monitorler"));
  assert.ok(alts.includes("klavye-ve-mouse"));
  assert.equal(alts.filter((alt) => alt === "notebooklar").length, 8);
  assert.equal(new Set(alts.slice(0, 5)).size, 5);
});
