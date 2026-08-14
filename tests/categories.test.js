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
