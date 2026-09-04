const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ALLOWED_VAT_RATES,
  normalizeVatPercent,
  isAllowedVatPercent,
  priceInclVat,
  vatAmountFromNet,
  validateManualFeedFields,
} = require("../lib/product-fields");

const root = path.resolve(__dirname, "..");

test("VAT rates are restricted to 1, 8, 10, 20", () => {
  assert.deepEqual(ALLOWED_VAT_RATES, [1, 8, 10, 20]);
  assert.equal(normalizeVatPercent(8), 8);
  assert.equal(normalizeVatPercent(18), 20);
  assert.equal(normalizeVatPercent(undefined), 20);
  assert.equal(isAllowedVatPercent(1), true);
  assert.equal(isAllowedVatPercent(18), false);
});

test("priceInclVat adds product VAT onto net price", () => {
  assert.equal(priceInclVat(100, 20), 120);
  assert.equal(priceInclVat(100, 8), 108);
  assert.equal(priceInclVat(1000, 1), 1010);
  assert.equal(vatAmountFromNet(100, 10), 10);
});

test("manual feed validation rejects invalid VAT", () => {
  const base = {
    id: "p1",
    name: "Ürün",
    brand: "PATYGO",
    price: 100,
    manufacturerCode: "M1",
    barcode: "869",
    gtipCode: "8471",
    mainCategory: "A",
    midCategory: "B",
    subCategory: "C",
    stockQty: 1,
    currency: "TRY",
    unit: "ADET",
    description: "Kısa açıklama metni yeterince uzun",
  };
  assert.deepEqual(validateManualFeedFields(Object.assign({}, base, { vatPercent: 20 })), []);
  assert.ok(validateManualFeedFields(Object.assign({}, base, { vatPercent: 18 })).includes("KDV"));
});

test("admin VAT field is a required 1/8/10/20 select", () => {
  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  assert.match(html, /id="pVat"/);
  assert.match(html, /<select id="pVat" required>/);
  assert.match(html, /value="" selected disabled>Seçiniz</);
  assert.match(html, /value="1"/);
  assert.match(html, /value="8"/);
  assert.match(html, /value="10"/);
  assert.match(html, /value="20"/);
  assert.doesNotMatch(html, /value="20" selected/);
});

test("admin client requires VAT before save", () => {
  const adminJs = fs.readFileSync(path.join(root, "assets", "js", "admin-panel.js"), "utf8");
  assert.match(adminJs, /KDV oranı zorunludur/);
  assert.match(adminJs, /fields\.vat\.value = ""/);
  assert.match(adminJs, /vatOk/);
});

test("admin products API rejects missing or invalid VAT before save", () => {
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverJs, /isAllowedVatPercent\(item && item\.vatPercent\)/);
  assert.match(serverJs, /KDV oranı zorunludur \(1, 8, 10 veya 20\)/);
});

test("storefront shows KDV dahil prices", () => {
  const catalogJs = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
  const detailJs = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");
  assert.match(catalogJs, /priceInclVat/);
  assert.match(catalogJs, /KDV dahil/);
  assert.doesNotMatch(catalogJs, /\+KDV/);
  assert.match(detailJs, /KDV dahil/);
  assert.doesNotMatch(detailJs, /\+KDV/);
});

test("storefront money format keeps kuruş instead of rounding to lira", () => {
  const catalogJs = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
  const checkoutJs = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");
  assert.match(catalogJs, /minimumFractionDigits:\s*2/);
  assert.match(catalogJs, /maximumFractionDigits:\s*2/);
  assert.doesNotMatch(catalogJs, /Math\.round\(Number\(amount\)/);
  assert.doesNotMatch(checkoutJs, /Math\.round\(amount\)\.toLocaleString/);
  assert.match(checkoutJs, /PatygoCatalog\.formatPrice/);
});
