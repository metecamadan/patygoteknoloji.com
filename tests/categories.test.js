"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadCategories,
  findCategory,
  categoryHref,
  isValidCategoryPair,
  assignedSiteCategory,
  hasSiteCategory,
  dropRetiredParents,
  applyCategoryDrag,
  publicCategories,
  setPublicCategoryLeafKeysLoader,
} = require("../lib/categories");

const SAMPLE_TREE = [
  {
    name: "OEM & ÇEVRE BİRİMLERİ",
    slug: "oem-cevre-birimleri",
    active: true,
    children: [
      { name: "İşlemciler", slug: "islemciler", active: true },
      { name: "USB Bellekler", slug: "usb-bellek", active: true },
    ],
  },
];

test("seed category file falls back to the canonical ANA-ARA-ALT schema", () => {
  const cats = loadCategories();
  assert.equal(cats.length, 5);
  assert.deepEqual(
    cats.map((row) => row.slug),
    ["bilgisayar-tablet", "bilgisayar-bilesenleri", "baski-cozumleri", "yapi-gerecleri", "ofis-urunleri"]
  );
  const cpu = cats.find((row) => row.slug === "bilgisayar-bilesenleri");
  const processors = cpu.children.find((row) => row.slug === "islemciler");
  assert.ok(processors.children.some((row) => row.slug === "intel-islemciler"));
  const print = cats.find((row) => row.slug === "baski-cozumleri");
  assert.deepEqual(
    print.children.map((row) => row.slug),
    [
      "yazici-tarayici",
      "yazici-tuketim-urunleri-orj",
      "yazici-tuketim-urunleri-muadil",
      "fotokopi-tuketim",
      "faks-tuketim-urunleri",
      "barkod-urunleri",
      "ups-kesintisiz-guc-kaynagi",
    ]
  );
  assert.ok(print.xmlNames.includes("TÜKETİM ÜRÜNLERİ"));
});

function legacyTonerTree() {
  return [
    {
      name: "KARTUŞ TONER",
      slug: "kartus-toner",
      xmlNames: ["TÜKETİM ÜRÜNLERİ"],
      children: [
        {
          name: "Yazıcı Tüketim Ürünleri (Orj.)",
          slug: "yazici-tuketim-urunleri-orj",
          marginPercent: 4,
          children: [{ name: "Laser Tonerler", slug: "laser-tonerler", criticalStockQty: 2 }],
        },
        { name: "Faks Tüketim Ürünleri", slug: "faks-tuketim-urunleri", children: [{ name: "Faks Tonerler", slug: "faks-tonerler" }] },
      ],
    },
    {
      name: "BASKI ÇÖZÜMLERİ",
      slug: "baski-cozumleri",
      xmlNames: ["ÇEVRE & BASKI BİRİMLERİ"],
      marginPercent: 2,
      children: [
        { name: "Barkod Ürünleri", slug: "barkod-urunleri", children: [{ name: "Barkod Okuyucular", slug: "barkod-okuyucular" }] },
        { name: "Yazıcı - Tarayıcı", slug: "yazici-tarayici", children: [{ name: "Mono Laser", slug: "mono-laser" }] },
        { name: "Panelde eklenen", slug: "panel-ara", children: [{ name: "Yaprak", slug: "yaprak" }] },
        {
          name: "UPS (Kesintisiz Güç Kaynağı)",
          slug: "ups-kesintisiz-guc-kaynagi",
          children: [{ name: "Online UPS", slug: "online-ups" }],
        },
      ],
    },
  ];
}

test("foldMovedParents moves KARTUŞ TONER under BASKI ÇÖZÜMLERİ keeping panel values", () => {
  const { foldMovedParents } = require("../lib/categories");
  const folded = foldMovedParents(legacyTonerTree());
  assert.deepEqual(folded.map((row) => row.slug), ["baski-cozumleri"]);
  const print = folded[0];
  assert.equal(print.marginPercent, 2);
  assert.deepEqual(
    print.children.map((row) => row.slug),
    [
      "yazici-tarayici",
      "yazici-tuketim-urunleri-orj",
      "faks-tuketim-urunleri",
      "barkod-urunleri",
      "ups-kesintisiz-guc-kaynagi",
      "panel-ara",
    ]
  );
  assert.deepEqual(print.xmlNames, ["ÇEVRE & BASKI BİRİMLERİ", "TÜKETİM ÜRÜNLERİ", "KARTUŞ TONER"]);
  const orj = print.children[1];
  assert.equal(orj.marginPercent, 4);
  assert.equal(orj.children[0].criticalStockQty, 2);
  assert.deepEqual(foldMovedParents(folded), folded);
});

test("foldMovedParents merges a moved mid into a same-slug copy already under the target", () => {
  const { foldMovedParents } = require("../lib/categories");
  const tree = legacyTonerTree();
  tree[1].children.push({
    name: "Yazıcı Tüketim Ürünleri (Orj.)",
    slug: "yazici-tuketim-urunleri-orj",
    children: [{ name: "Inkjet Kartuşlar", slug: "inkjet-kartuslar" }],
  });
  const print = foldMovedParents(tree)[0];
  const orj = print.children.filter((row) => row.slug === "yazici-tuketim-urunleri-orj");
  assert.equal(orj.length, 1);
  assert.equal(orj[0].marginPercent, 4);
  assert.deepEqual(orj[0].children.map((row) => row.slug), ["inkjet-kartuslar", "laser-tonerler"]);
});

test("category store folds a live KARTUŞ TONER tree on read and on a stale panel save", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createCategoryStore, SCHEMA_VERSION } = require("../lib/categories");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-fold-"));
  try {
    fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
    const file = path.join(root, ".runtime", "categories.json");
    fs.writeFileSync(file, JSON.stringify({ version: SCHEMA_VERSION, categories: legacyTonerTree() }));
    const store = createCategoryStore(root);
    assert.deepEqual(store.list().map((row) => row.slug), ["baski-cozumleri"]);
    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(persisted.version, SCHEMA_VERSION);
    assert.deepEqual(persisted.categories.map((row) => row.slug), ["baski-cozumleri"]);
    assert.equal(persisted.categories[0].children[1].marginPercent, 4);
    const saved = store.save(legacyTonerTree());
    assert.deepEqual(saved.map((row) => row.slug), ["baski-cozumleri"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publicCategories leafKeys:null skips the product-index loader", () => {
  let loads = 0;
  setPublicCategoryLeafKeysLoader(() => {
    loads += 1;
    throw new Error("storefront index must not load for an explicit leafKeys:null");
  });
  try {
    const published = publicCategories(
      [
        {
          slug: "a",
          name: "A",
          active: true,
          children: [{ slug: "b", name: "B", active: true }],
        },
      ],
      { leafKeys: null }
    );
    assert.equal(loads, 0);
    assert.equal(published[0].children[0].slug, "b");
  } finally {
    setPublicCategoryLeafKeysLoader(null);
  }
});

test("findCategory and href helpers", () => {
  const found = findCategory(SAMPLE_TREE, "oem-cevre-birimleri", "islemciler");
  assert.equal(found.parent.name, "OEM & ÇEVRE BİRİMLERİ");
  assert.equal(found.child.name, "İşlemciler");
  assert.equal(
    categoryHref("oem-cevre-birimleri", "islemciler"),
    "/urunler/oem-cevre-birimleri/islemciler"
  );
  assert.equal(
    categoryHref("baski-cozumleri", "faks-tuketim-urunleri", "faks-tonerler"),
    "/urunler/baski-cozumleri/faks-tuketim-urunleri/faks-tonerler"
  );
  assert.equal(isValidCategoryPair(SAMPLE_TREE, "oem-cevre-birimleri", "usb-bellek"), true);
  assert.equal(isValidCategoryPair(SAMPLE_TREE, "oem-cevre-birimleri", "yok"), false);
});

test("hasSiteCategory requires ANA+ARA+ALT on a three-level tree", () => {
  const tree = [
    {
      slug: "bilgisayar-bilesenleri",
      name: "BİLGİSAYAR BİLEŞENLERİ",
      children: [
        {
          slug: "islemciler",
          name: "İşlemciler",
          children: [{ slug: "intel-islemciler", name: "Intel İşlemciler", active: true }],
        },
      ],
    },
  ];
  assert.equal(
    hasSiteCategory(
      { siteParent: "bilgisayar-bilesenleri", siteChild: "islemciler" },
      tree
    ),
    false
  );
  assert.equal(
    hasSiteCategory(
      {
        siteParent: "bilgisayar-bilesenleri",
        siteMid: "islemciler",
        siteChild: "intel-islemciler",
      },
      tree
    ),
    true
  );
  assert.equal(
    assignedSiteCategory(
      {
        siteParent: "bilgisayar-bilesenleri",
        siteMid: "islemciler",
        siteChild: "intel-islemciler",
      },
      tree
    ).label,
    "BİLGİSAYAR BİLEŞENLERİ › İşlemciler › Intel İşlemciler"
  );
});

test("retired seed parents are stripped from the live tree", () => {
  const pruned = dropRetiredParents([
    {
      slug: "bilgisayar-tablet",
      name: "Bilgisayar / Tablet",
      children: [{ slug: "notebook", name: "Notebook" }],
    },
    {
      slug: "oem-cevre-birimleri",
      name: "OEM & ÇEVRE BİRİMLERİ",
      children: [{ slug: "islemciler", name: "İşlemciler" }],
    },
    {
      slug: "cevre-birimleri",
      name: "Çevre Birimleri",
      children: [{ slug: "modem", name: "Modem" }],
    },
  ]);
  assert.deepEqual(
    pruned.map((row) => row.slug),
    ["bilgisayar-tablet", "oem-cevre-birimleri"]
  );
});

test("publicCategories hides leaf categories without storefront products", () => {
  const { publicCategories, leafProductKey } = require("../lib/categories");
  const tree = [
    {
      name: "Ana",
      slug: "ana",
      active: true,
      children: [
        {
          name: "Ara",
          slug: "ara",
          active: true,
          children: [
            { name: "Dolu", slug: "dolu", active: true },
            { name: "Bos", slug: "bos", active: true },
          ],
        },
        {
          name: "Tek",
          slug: "tek",
          active: true,
          children: [{ name: "Yalniz Bos", slug: "yalniz-bos", active: true }],
        },
        {
          name: "Terminal Bos",
          slug: "terminal-bos",
          active: true,
        },
        {
          name: "Terminal Dolu",
          slug: "terminal-dolu",
          active: true,
        },
      ],
    },
  ];
  const leafKeys = new Set([
    leafProductKey("ana", "ara", "dolu"),
    leafProductKey("ana", "terminal-dolu", ""),
  ]);
  const published = publicCategories(tree, { leafKeys });
  assert.equal(published.length, 1);
  assert.deepEqual(
    published[0].children.map((row) => row.slug),
    ["ara", "terminal-dolu"]
  );
  assert.deepEqual(
    published[0].children[0].children.map((row) => row.slug),
    ["dolu"]
  );
});

test("buildStorefrontLeafKeys maps compact catalog rows to leaf keys", () => {
  const { buildStorefrontLeafKeys } = require("../lib/catalog");
  const { leafProductKey } = require("../lib/categories");
  const keys = buildStorefrontLeafKeys({
    compactAll: [
      { category: "ana", mid: "ara", alt: "dolu" },
      { category: "ana", mid: "terminal-dolu" },
      { category: "ana", alt: "legacy-alt" },
    ],
  });
  assert.equal(keys.has(leafProductKey("ana", "ara", "dolu")), true);
  assert.equal(keys.has(leafProductKey("ana", "terminal-dolu", "")), true);
  assert.equal(keys.has(leafProductKey("ana", "", "legacy-alt")), true);
  assert.equal(keys.size, 3);
});

test("buildStorefrontCategoryProductCounts aggregates parent mid and leaf paths", () => {
  const { buildStorefrontCategoryProductCounts } = require("../lib/catalog");
  const counts = buildStorefrontCategoryProductCounts({
    compactAll: [
      { category: "ana", mid: "ara", alt: "dolu" },
      { category: "ana", mid: "ara", alt: "dolu" },
      { category: "ana", mid: "ara", alt: "baska" },
      { category: "ana", mid: "terminal" },
      { category: "ana", alt: "legacy" },
      { category: "diger", mid: "x", alt: "y" },
    ],
  });
  assert.equal(counts.ana, 5);
  assert.equal(counts["ana/ara"], 3);
  assert.equal(counts["ana/ara/dolu"], 2);
  assert.equal(counts["ana/ara/baska"], 1);
  assert.equal(counts["ana/terminal"], 1);
  assert.equal(counts["ana/legacy"], 1);
  assert.equal(counts.diger, 1);
  assert.equal(counts["diger/x/y"], 1);
});

test("slugifyCategory and publicCategories hide unpublished nodes", () => {
  const { slugifyCategory, publicCategories, normalizeTree } = require("../lib/categories");
  assert.equal(slugifyCategory("USB Bellekler"), "usb-bellekler");
  const tree = normalizeTree([
    {
      name: "Yayınlık",
      slug: "yayinlik",
      active: true,
      children: [
        { name: "Açık", slug: "acik", active: true },
        { name: "Taslak", slug: "taslak", active: false },
      ],
    },
    {
      name: "Gizli",
      slug: "gizli",
      active: false,
      children: [{ name: "İç", slug: "ic", active: true }],
    },
  ]);
  const published = publicCategories(tree);
  assert.deepEqual(
    published.map((row) => [row.slug, row.children.map((child) => child.slug)]),
    [["yayinlik", ["acik"]]]
  );
});

test("category store seeds from site tree and persists display-name edits", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createCategoryStore } = require("../lib/categories");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  try {
    const store = createCategoryStore(root);
    const seeded = store.list();
    assert.equal(seeded.length, 5);
    assert.ok(seeded.some((row) => row.slug === "baski-cozumleri"));
    const saved = store.save([
      {
        name: "Yeni Dal",
        slug: "yeni-dal",
        active: false,
        children: [{ name: "Yaprak", slug: "yaprak", active: true }],
      },
    ]);
    assert.equal(store.publicList().length, 0);
    saved[0].active = true;
    assert.equal(store.save(saved).length, 1);
    assert.equal(store.publicList()[0].children[0].name, "Yaprak");
    store.save([
      {
        name: "OEM",
        slug: "oem-cevre-birimleri",
        xmlNames: ["OEM & ÇEVRE BİRİMLERİ"],
        children: [{ name: "İşlemciler", slug: "islemciler" }],
      },
    ]);
    const listed = store.list();
    listed[0].name = "Bilgisayar Parçaları";
    const renamed = store.save(listed);
    assert.equal(renamed[0].slug, "oem-cevre-birimleri");
    assert.equal(renamed[0].name, "Bilgisayar Parçaları");
    assert.deepEqual(renamed[0].xmlNames, ["OEM & ÇEVRE BİRİMLERİ"]);
    assert.equal(store.publicList()[0].name, "Bilgisayar Parçaları");
    assert.equal(Object.prototype.hasOwnProperty.call(store.publicList()[0], "xmlNames"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("category margin and critical stock persist, inherit leaf → mid → parent and stay private", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createCategoryStore, resolveCategoryPricing } = require("../lib/categories");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  try {
    const store = createCategoryStore(root);
    const saved = store.save([
      {
        name: "Bilgisayar",
        slug: "bilgisayar",
        marginPercent: 8,
        criticalStockQty: 2,
        children: [
          {
            name: "Notebook",
            slug: "notebook",
            marginPercent: 12.5,
            children: [
              { name: "Oyun", slug: "oyun", criticalStockQty: 5 },
              { name: "İş", slug: "is", marginPercent: 0 },
            ],
          },
          { name: "Masaüstü", slug: "masaustu", children: [{ name: "Mini", slug: "mini" }] },
        ],
      },
    ]);
    assert.equal(saved[0].marginPercent, 8);
    assert.equal(store.list()[0].children[0].marginPercent, 12.5);
    assert.equal(store.list()[0].children[0].children[0].criticalStockQty, 5);
    assert.equal("marginPercent" in store.list()[0].children[1], false, "empty means inherit");

    const tree = store.list();
    const at = (mid, leaf) =>
      resolveCategoryPricing(assignedSiteCategory({ siteParent: "bilgisayar", siteMid: mid, siteChild: leaf }, tree));
    assert.deepEqual(at("notebook", "oyun"), {
      marginPercent: 12.5,
      marginCategory: "Notebook",
      criticalStockQty: 5,
      criticalCategory: "Oyun",
      basamak: null,
      basamakCategory: "",
    });
    assert.equal(at("notebook", "is").marginPercent, 0, "an explicit 0 stops inheritance");
    assert.equal(at("masaustu", "mini").marginPercent, 8);
    assert.equal(at("masaustu", "mini").criticalStockQty, 2);
    assert.deepEqual(resolveCategoryPricing(null), {
      marginPercent: null,
      marginCategory: "",
      criticalStockQty: null,
      criticalCategory: "",
      basamak: null,
      basamakCategory: "",
    });

    assert.throws(() => store.save([{ name: "X", slug: "x", marginPercent: -1 }]), /0 ile 500/);
    assert.throws(() => store.save([{ name: "X", slug: "x", criticalStockQty: 1.5 }]), /tam sayı/);
    assert.throws(() => store.save([{ name: "X", slug: "x", marginPercent: "abc" }]), /sayı olmalı/);
    assert.throws(() => store.save([{ name: "X", slug: "x", basamak: 10 }]), /0 ile 9/);
    assert.equal(store.list()[0].marginPercent, 8, "a rejected save leaves the tree untouched");

    const withBasamak = store.save([
      {
        name: "Bilgisayar",
        slug: "bilgisayar",
        marginPercent: 8,
        criticalStockQty: 2,
        basamak: 9,
        children: [
          {
            name: "Notebook",
            slug: "notebook",
            marginPercent: 12.5,
            children: [
              { name: "Oyun", slug: "oyun", criticalStockQty: 5, basamak: 7 },
              { name: "İş", slug: "is", marginPercent: 0 },
            ],
          },
          { name: "Masaüstü", slug: "masaustu", children: [{ name: "Mini", slug: "mini" }] },
        ],
      },
    ]);
    assert.equal(withBasamak[0].basamak, 9);
    const tree2 = store.list();
    const at2 = (mid, leaf) =>
      resolveCategoryPricing(assignedSiteCategory({ siteParent: "bilgisayar", siteMid: mid, siteChild: leaf }, tree2));
    assert.equal(at2("notebook", "oyun").basamak, 7, "leaf basamak wins");
    assert.equal(at2("masaustu", "mini").basamak, 9, "parent basamak is inherited");
    assert.equal(at2("notebook", "is").basamak, 9, "mid without own basamak inherits parent");

    const publicJson = JSON.stringify(store.publicList({ leafKeys: null }));
    assert.match(publicJson, /Bilgisayar/);
    assert.doesNotMatch(publicJson, /marginPercent|criticalStockQty|basamak/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("applyCategoryDrag reorders parents and sibling children", () => {
  const tree = [
    {
      slug: "a",
      name: "A",
      children: [
        { slug: "a1", name: "A1" },
        { slug: "a2", name: "A2" },
        { slug: "a3", name: "A3" },
      ],
    },
    { slug: "b", name: "B", children: [{ slug: "b1", name: "B1" }] },
  ];
  const parents = applyCategoryDrag(tree, { kind: "parent", index: 0 }, { kind: "parent", index: 1 });
  assert.deepEqual(
    parents.map((row) => row.slug),
    ["b", "a"]
  );
  const children = applyCategoryDrag(
    tree,
    { kind: "child", parentIndex: 0, childIndex: 2 },
    { kind: "child", parentIndex: 0, childIndex: 0 }
  );
  assert.deepEqual(
    children[0].children.map((row) => row.slug),
    ["a3", "a1", "a2"]
  );
  assert.equal(
    applyCategoryDrag(
      tree,
      { kind: "child", parentIndex: 0, childIndex: 0 },
      { kind: "child", parentIndex: 1, childIndex: 0 }
    ),
    null
  );
});
