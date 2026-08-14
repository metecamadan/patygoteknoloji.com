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
} = require("../lib/categories");

test("loadCategories exposes two parents with expected children", () => {
  const cats = loadCategories();
  assert.equal(cats.length, 2);
  assert.equal(cats[0].slug, "bilgisayar-tablet");
  assert.equal(cats[1].slug, "cevre-birimleri");
  assert.ok(cats[0].children.some((c) => c.slug === "notebook"));
  assert.ok(cats[1].children.some((c) => c.slug === "usb-bellek"));
});

test("findCategory and href helpers", () => {
  const cats = loadCategories();
  const found = findCategory(cats, "bilgisayar-tablet", "monitor");
  assert.equal(found.parent.name, "Bilgisayar / Tablet");
  assert.equal(found.child.name, "Monitör");
  assert.equal(
    categoryHref("bilgisayar-tablet", "notebook"),
    "/urunler?kategori=bilgisayar-tablet&alt=notebook"
  );
  assert.equal(isValidCategoryPair(cats, "cevre-birimleri", "modem"), true);
  assert.equal(isValidCategoryPair(cats, "cevre-birimleri", "yok"), false);
});

test("hasSiteCategory requires a valid parent and child slug pair", () => {
  const cats = loadCategories();
  assert.equal(hasSiteCategory({}, cats), false);
  assert.equal(hasSiteCategory({ siteParent: "bilgisayar-tablet" }, cats), false);
  assert.equal(
    hasSiteCategory({ siteParent: "bilgisayar-tablet", siteChild: "yok" }, cats),
    false
  );
  const assigned = assignedSiteCategory(
    { siteParent: "cevre-birimleri", siteChild: "usb-bellek" },
    cats
  );
  assert.equal(assigned.label, "Çevre Birimleri › USB Bellekler");
  assert.equal(
    hasSiteCategory({ siteParent: "cevre-birimleri", siteChild: "usb-bellek" }, cats),
    true
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

test("category store seeds from site tree and persists edits", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createCategoryStore } = require("../lib/categories");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  try {
    const store = createCategoryStore(root);
    const seeded = store.list();
    assert.equal(seeded.length, 2);
    assert.equal(seeded[0].active, true);
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
