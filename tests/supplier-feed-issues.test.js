const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { analyzeSupplierFeedIssues } = require("../lib/akakce");
const { createCategoryStore, setCategoryListLoader, loadCategories } = require("../lib/categories");
const { TEST_SITE_CATEGORIES, clearTestSiteCategories } = require("./helpers/site-categories");

function supplierProduct(overrides) {
  return Object.assign(
    {
      supplierSku: "SKU-1",
      id: "sup-sku-1",
      name: "Lenovo ThinkPad E14",
      brand: "LENOVO",
      salePrice: 25000,
      stockQty: 5,
      active: true,
      image: "https://cdn.example/sku-1.jpg",
      barcode: "8690000000001",
      vatPercent: 20,
      manufacturerCode: "21JK",
      gtipCode: "84.71.30.00.00.00",
      mainCategory: "BİLGİSAYAR",
      midCategory: "Taşınabilir",
      subCategory: "Notebook",
      currency: "TRY",
      unit: "ADET",
      siteParent: "oem-cevre-birimleri",
      siteChild: "notebook",
      lastSuccessfulFetchAt: new Date().toISOString(),
    },
    overrides || {}
  );
}

test("supplier feed check reuses a passed category tree instead of reloading it per product", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-feed-issues-"));
  const store = createCategoryStore(root);
  store.save(TEST_SITE_CATEGORIES);
  let loads = 0;
  setCategoryListLoader(
    () => {
      loads += 1;
      return store.list();
    },
    () => store.stamp()
  );
  try {
    const options = { siteBaseUrl: "https://patygoteknoloji.com" };
    const products = [
      supplierProduct(),
      supplierProduct({ supplierSku: "SKU-2", id: "sup-sku-2", barcode: "" }),
      supplierProduct({ supplierSku: "SKU-3", id: "sup-sku-3", siteChild: "yok" }),
    ];
    const withoutTree = products.map((product) => analyzeSupplierFeedIssues(product, options));
    assert.deepEqual(withoutTree[0], []);
    assert.ok(withoutTree[1].includes("Barkod eksik"));
    assert.ok(withoutTree[2].includes("Site kategorisi eksik"));

    const categories = loadCategories();
    loads = 0;
    const withTree = products.map((product) =>
      analyzeSupplierFeedIssues(product, Object.assign({ categories }, options))
    );
    assert.deepEqual(withTree, withoutTree, "same verdicts with a shared tree");
    assert.equal(loads, 0, "category tree is not reloaded per product");
  } finally {
    clearTestSiteCategories();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
