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

test("seed category file starts empty so XML tree is the storefront menu", () => {
  const cats = loadCategories();
  assert.equal(cats.length, 0);
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

test("hasSiteCategory requires a valid parent and child slug pair", () => {
  assert.equal(hasSiteCategory({}, SAMPLE_TREE), false);
  assert.equal(hasSiteCategory({ siteParent: "oem-cevre-birimleri" }, SAMPLE_TREE), false);
  assert.equal(
    hasSiteCategory({ siteParent: "oem-cevre-birimleri", siteChild: "yok" }, SAMPLE_TREE),
    false
  );
  const assigned = assignedSiteCategory(
    { siteParent: "oem-cevre-birimleri", siteChild: "usb-bellek" },
    SAMPLE_TREE
  );
  assert.equal(assigned.label, "OEM & ÇEVRE BİRİMLERİ › USB Bellekler");
  assert.equal(
    hasSiteCategory({ siteParent: "oem-cevre-birimleri", siteChild: "usb-bellek" }, SAMPLE_TREE),
    true
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
    ["oem-cevre-birimleri"]
  );
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
    assert.equal(seeded.length, 0);
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
