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
  assert.equal(cats.length, 6);
  assert.deepEqual(
    cats.map((row) => row.slug),
    [
      "bilgisayar-tablet",
      "bilgisayar-bilesenleri",
      "kartus-toner",
      "baski-cozumleri",
      "yapi-gerecleri",
      "ofis-urunleri",
    ]
  );
  const cpu = cats.find((row) => row.slug === "bilgisayar-bilesenleri");
  const processors = cpu.children.find((row) => row.slug === "islemciler");
  assert.ok(processors.children.some((row) => row.slug === "intel-islemciler"));
});

test("findCategory and href helpers", () => {
  const found = findCategory(SAMPLE_TREE, "oem-cevre-birimleri", "islemciler");
  assert.equal(found.parent.name, "OEM & ÇEVRE BİRİMLERİ");
  assert.equal(found.child.name, "İşlemciler");
  assert.equal(
    categoryHref("oem-cevre-birimleri", "islemciler"),
    "/urunler?kategori=oem-cevre-birimleri&alt=islemciler"
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
    assert.equal(seeded.length, 6);
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
