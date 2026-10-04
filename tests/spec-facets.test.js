const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { specValues, parseSpecFilter, matchesSpecFilter, buildSpecFacets } = require("../lib/spec-facets");
const { queryPublicCatalog } = require("../lib/catalog");

const root = path.resolve(__dirname, "..");

function laptop(id, name, price) {
  return {
    id,
    name,
    brand: "Lenovo",
    price: price || 20000,
    vatPercent: 20,
    category: "bilgisayar-tablet",
    active: true,
  };
}

test("specValues reads CPU, RAM, storage, screen and refresh rate from titles", () => {
  const row = specValues({ name: 'Lenovo IdeaPad Slim 3 Intel Core i5-1235U 16GB RAM 512GB SSD 15.6" FHD 144Hz' });
  assert.equal(row.islemci, "Core i5");
  assert.equal(row.ram, "16 GB");
  assert.equal(row.depolama, "512 GB");
  assert.equal(row.ekran, "15–16\"");
  assert.equal(row.tazeleme, "144–180 Hz");

  assert.equal(specValues({ name: "Asus Vivobook AMD Ryzen 7 7730U 8GB 1TB SSD 14\"" }).islemci, "Ryzen 7");
  assert.equal(specValues({ name: "Asus Vivobook AMD Ryzen 7 7730U 8GB 1TB SSD 14\"" }).ram, "8 GB");
  assert.equal(specValues({ name: "Asus Vivobook AMD Ryzen 7 7730U 8GB 1TB SSD 14\"" }).depolama, "1 TB");
  assert.equal(specValues({ name: "MSI Prestige Core Ultra 7 155H 32GB DDR5" }).islemci, "Core Ultra 7");
});

test("specValues ignores storage sizes as RAM and keeps unknown fields empty", () => {
  const row = specValues({ name: "Kingston 512GB NVMe SSD" });
  assert.equal(row.ram, undefined);
  assert.equal(row.islemci, undefined);
  assert.equal(specValues({ name: "Samsung 27\" 75Hz Monitor" }).ekran, "27\"");
  assert.equal(specValues({ name: "Samsung 27\" 75Hz Monitor" }).tazeleme, "60–75 Hz");
});

test("specValues reads toner colour and original/compatible from titles", () => {
  assert.deepEqual(specValues({ name: "HP 207A Orijinal Siyah Toner" }), { renk: "Siyah", tur: "Orijinal" });
  assert.equal(specValues({ name: "Canon 055 Muadil Toner Cyan" }).tur, "Muadil");
  assert.equal(specValues({ name: "Canon 055 Muadil Toner Cyan" }).renk, "Mavi (Cyan)");
  assert.equal(specValues({ name: "Brother TN-2456 SARI TONER" }).renk, "Sarı (Yellow)");
});

test("parseSpecFilter keeps known keys only and splits values on pipes", () => {
  const filter = parseSpecFilter("ram:16 GB|32 GB, islemci:Core i5 ,bilinmeyen:x,ekran:");
  assert.deepEqual(Object.keys(filter).sort(), ["islemci", "ram"]);
  assert.deepEqual(Array.from(filter.ram), ["16 GB", "32 GB"]);
  assert.equal(matchesSpecFilter({ name: "Lenovo Core i5-1335U 16GB RAM 512GB SSD" }, filter), true);
  assert.equal(matchesSpecFilter({ name: "Lenovo Core i7-1355U 16GB RAM 512GB SSD" }, filter), false);
  assert.equal(matchesSpecFilter({ name: "Lenovo 16GB RAM" }, filter), false);
  assert.equal(matchesSpecFilter({ name: "anything" }, parseSpecFilter("")), true);
});

test("buildSpecFacets only lists groups relevant to the category with enough coverage", () => {
  const rows = [
    laptop("a", "Core i5-1235U 8GB RAM 256GB SSD"),
    laptop("b", "Core i5-1335U 16GB RAM 512GB SSD"),
    laptop("c", "Core i7-1355U 16GB RAM 512GB SSD"),
    laptop("d", "Ryzen 5 7530U 16GB RAM 512GB SSD"),
  ];
  const groups = buildSpecFacets(rows, "bilgisayar-tablet");
  const ram = groups.find((group) => group.key === "ram");
  assert.deepEqual(ram.values, [
    { value: "16 GB", count: 3 },
    { value: "8 GB", count: 1 },
  ]);
  assert.ok(groups.some((group) => group.key === "islemci"));
  assert.equal(groups.some((group) => group.key === "renk"), false);
  assert.deepEqual(buildSpecFacets(rows, "kartus-toner"), []);
  assert.deepEqual(buildSpecFacets(rows.slice(0, 3), "bilgisayar-tablet"), []);
});

test("queryPublicCatalog filters by ozellik and keeps spec facets from the unfiltered list", () => {
  const products = [
    laptop("a", "Lenovo Core i5-1235U 8GB RAM 256GB SSD"),
    laptop("b", "Lenovo Core i5-1335U 16GB RAM 512GB SSD"),
    laptop("c", "Lenovo Core i7-1355U 16GB RAM 512GB SSD"),
    laptop("d", "Lenovo Ryzen 5 7530U 16GB RAM 512GB SSD"),
  ];
  const result = queryPublicCatalog(products, {
    kategori: "bilgisayar-tablet",
    ozellik: "ram:16 GB,islemci:Core i5|Ryzen 5",
    limit: 48,
  });
  assert.deepEqual(result.products.map((row) => row.id).sort(), ["b", "d"]);
  const ram = result.facets.specs.find((group) => group.key === "ram");
  assert.equal(ram.values.length, 2);
});

test("catalog UI renders spec filter groups and sends ozellik to the API", () => {
  const js = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
  assert.match(js, /parseSpecParam\(params\.get\("ozellik"\)\)/);
  assert.match(js, /ozellik: serializeSpecParam\(facets\.specs\)/);
  assert.match(js, /"maxFiyat", "ozellik", "sort"/);
  assert.match(js, /specs: \{\} \}\)/);
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /ozellik/);
});

test("header search offers live suggestions from the product API", () => {
  const js = fs.readFileSync(path.join(root, "assets", "js", "main.js"), "utf8");
  assert.match(js, /function attachSearchSuggest\(form, input\)/);
  assert.match(js, /\/api\/products\?q=.*limit=6|limit=6/);
  assert.match(js, /role", "listbox"|role="listbox"|setAttribute\("role", "listbox"\)/);
  assert.match(js, /aria-activedescendant|aria-expanded/);
  const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
  assert.match(css, /\.search-suggest\b/);
});
