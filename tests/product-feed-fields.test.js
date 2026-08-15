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
  assert.match(html, /<select id="pMainCategory"/);
  assert.match(html, /<select id="pMidCategory"/);
  assert.match(html, /<select id="pSubCategory"/);
  assert.match(html, /<select id="sFeedMainCategory"/);
});

test("admin feed category fields cascade from a selectable tree", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "admin.js"), "utf8");
  assert.match(script, /FEED_CATEGORY_TREE/);
  assert.match(script, /bindFeedCategoryCascade/);
  assert.match(script, /setFeedCategorySelects/);
  assert.match(script, /KİŞİSEL BİLGİSAYARLAR/);
  assert.match(script, /OEM & ÇEVRE BİRİMLERİ/);
  assert.match(script, /xmlMainCategory \|\| item\.mainCategory/);
});
