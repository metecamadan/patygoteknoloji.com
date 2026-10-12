const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  searchProducts,
  editDistance,
  parseSearchTerms,
  createSearchIndex,
  scoreSearchEntry,
  searchEntry,
} = require("../lib/search");
const { foldSearchText } = require("../lib/tr-text");
const { queryPublicCatalogIndexed, storefrontSearchIndex } = require("../lib/catalog");

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

const home = [
  { id: "iron", name: "Philips DST7030 Buharlı Ütü 2800W", brand: "PHILIPS", category: "Ev Aletleri", price: 2400 },
  { id: "grinder", name: "Arzum Kahve Öğütücü Siyah", brand: "ARZUM", category: "Mutfak", price: 900 },
  { id: "charger", name: "Anker 20W Şarj Adaptörü USB-C", brand: "ANKER", category: "Şarj Cihazları", price: 450 },
  { id: "bin", name: "Xerox Atık Toner Kutusu", brand: "XEROX", category: "Sarf", price: 700 },
  { id: "glass", name: "Lav Cam Çay Bardağı 6'lı", brand: "LAV", category: "Mutfak", price: 150 },
  { id: "coin", name: "Duracell CR2032 Lityum Pil 3V", brand: "DURACELL", category: "Piller", price: 60 },
  { id: "board", name: "MSI Pro B760M LGA1700 Anakart", brand: "MSI", category: "Anakartlar", price: 4500 },
];

test("letters-only terms match from the start of a word; terms with digits may sit inside a model code", () => {
  assert.deepEqual(ids(searchProducts(home, "utu")), ["iron"], "utu, 'Kutusu' içinde eşleşmez");
  assert.equal(ids(searchProducts(home, "kutu"))[0], "bin", "ütü yalnızca tek harf hatası toleransıyla arkada kalır");
  assert.deepEqual(ids(searchProducts(home, "arj")), [], "kelime ortası harf dizisi eşleşmez");
  assert.deepEqual(ids(searchProducts(home, "2032")), ["coin"], "CR2032");
  assert.deepEqual(ids(searchProducts(home, "1700")), ["board"], "LGA1700");
  assert.deepEqual(ids(searchProducts(home, "cr2032")), ["coin"]);
  assert.deepEqual(ids(searchProducts(home, "pil")), ["coin"], "kategori kelime başından eşleşir");
  assert.deepEqual(ids(searchProducts(home, "ller")), [], "kategori ortası eşleşmez");
});

test("Turkish letters typed or not find the same products (ütü = utu = ÜTÜ)", () => {
  const same = [
    ["ütü", "utu", "ÜTÜ", "Ütü"],
    ["buharlı ütü", "buharli utu", "BUHARLI ÜTÜ"],
    ["öğütücü", "ogutucu", "ÖĞÜTÜCÜ"],
    ["şarj", "sarj", "ŞARJ"],
    ["çay bardağı", "cay bardagi", "ÇAY BARDAĞI"],
  ];
  for (const group of same) {
    const expected = ids(searchProducts(home, group[0]));
    assert.ok(expected.length, group[0] + " sonuç vermeli");
    for (const query of group.slice(1)) assert.deepEqual(ids(searchProducts(home, query)), expected, query);
  }
  assert.equal(ids(searchProducts(home, "utu"))[0], "iron", "ütü, kelime içinde 'utu' geçen kutudan önce gelir");
  assert.equal(ids(searchProducts(home, "ogutcu"))[0], "grinder", "harf eksik + Türkçe harfsiz yazım");
});

/** Row-by-row ranking, the behaviour the token index must reproduce. */
function rankOneByOne(list, query, tieBreak) {
  const parsed = parseSearchTerms(query);
  if (!parsed.terms.length) return list;
  return list
    .map((item, index) => ({ item, index, score: scoreSearchEntry(searchEntry(item), parsed) }))
    .filter((row) => row.score !== null)
    .map((row) => Object.assign(row, {
      score: row.score + Math.min(Math.log10((Number(row.item.price) || 0) + 1), 5),
      tie: tieBreak(row.item),
    }))
    .sort((a, b) => b.score - a.score || b.tie - a.tie || a.index - b.index)
    .map((row) => row.item);
}

function sampleCatalog() {
  const brands = ["HP", "Lenovo", "Logitech", "Samsung", "Çaykur", "Western Digital", "Tunçmatik", "Kingston"];
  const words = [
    "Notebook", "Laptop Standı", "Kablosuz Mouse", "Klavye", "Kulaklık", "Toner", "Yazıcı", "Şarj Cihazı",
    "Çanta", "SSD 1TB", "DDR5 16GB", "Monitör 27\"", "Hoparlör", "Router", "Ütü", "Öğütücü", "Kutusu", "Çay 1 kg",
  ];
  const categories = ["Notebooklar", "Bilgisayar Aksesuarları", "Yazıcılar", "Gıda", "Ev Aletleri", "Ağ Ürünleri"];
  const items = [];
  for (let i = 0; i < 240; i += 1) {
    items.push({
      id: "p" + i,
      brand: brands[i % brands.length],
      name: brands[i % brands.length] + " " + words[(i * 7) % words.length] + " " + words[(i * 3 + 1) % words.length] + " M" + (100 + i),
      category: categories[(i * 5) % categories.length],
      price: 100 + ((i * 7919) % 50000),
      featured: i % 11 === 0,
    });
  }
  return items;
}

test("the token index ranks exactly like row-by-row scoring, for whole lists and subsets", () => {
  const items = sampleCatalog();
  const tieBreak = (item) => (item.featured ? 1 : 0);
  const index = createSearchIndex(items);
  const subset = items.filter((_, i) => i % 3 === 0);
  const queries = [
    "laptop", "notebook", "notbook", "lenova", "lenvoo", "logitec mouse", "kablosuz fare", "kulaklik", "kulaklık",
    "toner", "tonr", "yazici", "printer", "şarj", "sarj", "canta", "laptop çantası", "laptop standı", "ssd 1tb",
    "ddr5", "monitor", "hoparlor", "speaker", "modem", "utu", "ütü", "ogutucu", "kutu", "cay", "western digital",
    "wd", "m101", "m10", "33", "1tb", "tb", "i9", "hp toner", "hp kahve", "bilgisayar", "aksesuar", "ev aletleri",
    "a", "ab", "lar", "utu kutu",
  ];
  for (const query of queries) {
    const expected = ids(rankOneByOne(items, query, tieBreak));
    assert.deepEqual(ids(searchProducts(items, query, { tieBreak })), expected, query);
    assert.deepEqual(ids(searchProducts(items, query, { tieBreak, index })), expected, query + " (paylaşılan dizin)");
    assert.deepEqual(ids(searchProducts(items, query, { tieBreak, index })), expected, query + " (tekrar)");
    assert.deepEqual(
      ids(searchProducts(subset, query, { tieBreak, index })),
      ids(rankOneByOne(subset, query, tieBreak)),
      query + " (alt küme)"
    );
  }
  const stranger = { id: "x", name: "Lenovo Ütü Standı", brand: "LENOVO", category: "Ev Aletleri", price: 10 };
  assert.ok(ids(searchProducts(items.concat(stranger), "utu", { index })).includes("x"), "dizinde olmayan satır da puanlanır");
});

test("storefront search builds its word index once per catalog index and the server warms it", () => {
  const items = sampleCatalog();
  const index = { compactAll: items, byParent: Object.create(null) };
  const first = queryPublicCatalogIndexed(index, { q: "ütü", limit: 48 });
  const built = index.searchIndex;
  assert.ok(built, "ilk aramada dizin kurulur");
  assert.deepEqual(ids(queryPublicCatalogIndexed(index, { q: "utu", limit: 48 }).products), ids(first.products));
  assert.equal(storefrontSearchIndex(index), built, "dizin yeniden kurulmaz");

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const body = (name) => server.slice(server.indexOf("function " + name + "("), server.indexOf("\n}\n", server.indexOf("function " + name + "(")));
  assert.match(body("storefrontIndex"), /warmSearchIndex\(memo\.index\)/);
  assert.match(body("soldOutIndex"), /warmSearchIndex\(index\)/);
  assert.match(body("warmSearchIndex"), /setImmediate[\s\S]*storefrontSearchIndex\(index\)/);
});
