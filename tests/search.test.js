const test = require("node:test");
const assert = require("node:assert/strict");
const { searchProducts, editDistance, parseSearchTerms } = require("../lib/search");
const { foldSearchText } = require("../lib/tr-text");

const catalog = [
  { id: "stand", name: "Ofispc Laptop Standı Alüminyum", brand: "OFİSPC", category: "Bilgisayar Aksesuarları", price: 450 },
  { id: "nb", name: "Lenovo V15 G4 Intel Core i5 16GB 512GB SSD Notebook", brand: "LENOVO", category: "Notebooklar", price: 28000 },
  { id: "cpu", name: "Intel Core i5-12400 İşlemci", brand: "INTEL", category: "İşlemciler", price: 6500 },
  { id: "printer", name: "HP LaserJet M111a Yazıcı", brand: "HP", category: "Yazıcılar", price: 4200 },
  { id: "toner", name: "HP 150A Siyah Toner", brand: "HP", category: "Toner", price: 1200 },
  { id: "tea", name: "Çaykur Rize Turist Çay 1 kg", brand: "ÇAYKUR", category: "Gıda", price: 300 },
];

const ids = (list) => list.map((item) => item.id);

test("foldSearchText removes Turkish diacritics and dotless i", () => {
  assert.equal(foldSearchText("İŞLEMCİ Yazıcı Çay Öğütücü"), "islemci yazici cay ogutucu");
});

test("search matches regardless of Turkish letters and case", () => {
  assert.deepEqual(ids(searchProducts(catalog, "ISLEMCI")), ["cpu"]);
  assert.deepEqual(ids(searchProducts(catalog, "işlemci")), ["cpu"]);
  assert.deepEqual(ids(searchProducts(catalog, "yazici")), ["printer"]);
  assert.deepEqual(ids(searchProducts(catalog, "caykur")), ["tea"]);
});

test("search tolerates small typos", () => {
  assert.deepEqual(ids(searchProducts(catalog, "lenova")), ["nb"]);
  assert.deepEqual(ids(searchProducts(catalog, "notbook")), ["nb"]);
  assert.deepEqual(ids(searchProducts(catalog, "tonr")), ["toner"]);
});

test("short and numeric terms are not fuzzy-matched", () => {
  assert.deepEqual(ids(searchProducts(catalog, "i9")), []);
  assert.deepEqual(ids(searchProducts(catalog, "151a")), []);
});

test("laptop query ranks a notebook above an accessory", () => {
  const result = ids(searchProducts(catalog, "laptop"));
  assert.equal(result[0], "nb");
  assert.ok(result.includes("stand"));
});

test("asking for the accessory itself keeps it first", () => {
  assert.equal(ids(searchProducts(catalog, "laptop standı"))[0], "stand");
});

test("every term must match", () => {
  assert.deepEqual(ids(searchProducts(catalog, "hp toner")), ["toner"]);
  assert.deepEqual(ids(searchProducts(catalog, "hp kahve")), []);
});

test("empty query returns list unchanged", () => {
  assert.deepEqual(ids(searchProducts(catalog, "  ")), ids(catalog));
});

test("editDistance handles transpositions and bails out above max", () => {
  assert.equal(editDistance("lenovo", "lenvoo", 2), 1);
  assert.equal(editDistance("monitor", "monitör".normalize("NFD").replace(/[\u0300-\u036f]/g, ""), 1), 0);
  assert.ok(editDistance("notebook", "keyboard", 2) > 2);
});

test("parseSearchTerms caps the number of terms", () => {
  assert.equal(parseSearchTerms("a b c d e f g h i j").terms.length, 8);
});
