const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateManualFeedFields } = require("../lib/product-fields");

const products = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "assets", "data", "products.json"), "utf8")
);

test("demo products include bilgisayarim-style feed required fields", () => {
  products.forEach((product) => {
    const missing = validateManualFeedFields(product);
    assert.deepEqual(missing, [], product.id + " missing: " + missing.join(", "));
  });
});

test("admin product form exposes feed required fields", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
  [
    "pManufacturerCode",
    "pBarcode",
    "pGtip",
    "pStock",
    "pVat",
    "pCurrency",
    "pUnit",
    "pMainCategory",
    "pMidCategory",
    "pSubCategory",
  ].forEach((id) => assert.match(html, new RegExp('id="' + id + '"')));
});
