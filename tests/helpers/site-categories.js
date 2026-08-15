"use strict";

const { createCategoryStore, setCategoryListLoader } = require("../../lib/categories");

const TEST_SITE_CATEGORIES = [
  {
    slug: "oem-cevre-birimleri",
    name: "OEM & ÇEVRE BİRİMLERİ",
    active: true,
    children: [
      { slug: "notebook", name: "Notebook", active: true },
      { slug: "islemciler", name: "İşlemciler", active: true },
      { slug: "usb-bellek", name: "USB Bellekler", active: true },
    ],
  },
];

function installTestSiteCategories(root) {
  const store = createCategoryStore(root);
  store.save(TEST_SITE_CATEGORIES);
  setCategoryListLoader(() => store.list());
  return store;
}

function clearTestSiteCategories() {
  setCategoryListLoader(null);
}

module.exports = {
  TEST_SITE_CATEGORIES,
  installTestSiteCategories,
  clearTestSiteCategories,
};
