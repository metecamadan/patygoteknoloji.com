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

test("specValues understands common supplier title shorthands", () => {
  const dell = specValues({ name: "Dell Pro 15 Essential i5 1334 16GB 512SSD 15.6 FHD 120Hz Ubuntu Notebook" });
  assert.equal(dell.islemci, "Core i5");
  assert.equal(dell.ram, "16 GB");
  assert.equal(dell.depolama, "512 GB");
  const asus = specValues({ name: "Asus Expertbook B3402FVA Core U7-150U 16GB 512GB Touch FreeDOS 14\" Notebook" });
  assert.equal(asus.islemci, "Core Ultra 7");
  assert.equal(asus.depolama, "512 GB");
  assert.equal(specValues({ name: "Dell Pro Micro Ultra5 235T 16GB 512SSD FreeDOS Mini Pc" }).islemci, "Core Ultra 5");
  assert.equal(specValues({ name: "Quadro Diamond Ci7 10850H 16gb 512gb NVME SSD 16\" Notebook" }).islemci, "Core i7");
  assert.equal(specValues({ name: "Asus Vivobook 15 CORE 7-150U 8GB 512GB SSD 15.6\" Notebook" }).islemci, "Core 7");
  const tablet = specValues({ name: "Technopc Quantum Elise T80P 10.95\" IPS 8 Core 2GHz 8-256GB LTE Tablet" });
  assert.equal(tablet.ekran, "13\" ve altı");
  assert.equal(tablet.ram, "8 GB");
  assert.equal(tablet.depolama, "256 GB");
  assert.equal(specValues({ name: "Adata 2000Gb SC750 Taşınabilir Usb 3.2 Type-C Ssd Harici Disk" }).depolama, "2 TB");
  assert.equal(specValues({ name: "Adata 2000Gb SC750 Taşınabilir Usb 3.2 Type-C Ssd Harici Disk" }).ram, undefined);
  assert.equal(specValues({ name: "HP ZBook Ultra 7 155H 16 GB RAM 14\" 512GB 4GB RTX A500 Notebook" }).depolama, "512 GB");
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
  assert.deepEqual(buildSpecFacets(rows, "baski-cozumleri"), []);
  assert.deepEqual(buildSpecFacets(rows.slice(0, 3), "bilgisayar-tablet"), []);
  assert.ok(
    buildSpecFacets(rows, "bilgisayar-tablet", "tasinabilir-bilgisayarlar").some((group) => group.key === "ram")
  );
  assert.deepEqual(buildSpecFacets(rows, "bilgisayar-tablet", "kablolar-ve-donusturuculer"), []);
});

test("memory sticks expose RAM and DDR filters under Bellekler", () => {
  const sticks = [
    { id: "1", name: "Kingston 32GB DDR4 3200MHz Notebook Ram" },
    { id: "2", name: "Crucial 16GB DDR5 4800MHz Notebook Ram" },
    { id: "3", name: "HI-Level 8GB DDR4 3200Mhz Notebook Ram" },
    { id: "4", name: "Patriot 16GB DDR4 3200MHz SODIMM Notebook Ram" },
  ];
  assert.equal(specValues(sticks[0]).ram, "32 GB");
  assert.equal(specValues(sticks[0]).ddr, "DDR4");
  assert.equal(specValues(sticks[1]).ddr, "DDR5");
  const keys = buildSpecFacets(sticks, "bilgisayar-bilesenleri", "bellekler").map((group) => group.key).sort();
  assert.deepEqual(keys, ["ddr", "ram"]);
  assert.deepEqual(buildSpecFacets(sticks, "bilgisayar-bilesenleri", "ekran-kartlari"), []);
});

test("USB flash, GPU, socket, input and printer extractors feed mid-scoped facets", () => {
  assert.equal(specValues({ name: "Acer 128GB USB 3.2 Flash Bellek" }).depolama, "128 GB");
  assert.equal(specValues({ name: "Asus Dual GeForce RTX3050 OC 6GB GDDR6" }).gpu, "RTX 30xx");
  assert.equal(specValues({ name: "Asus Dual GeForce RTX3050 OC 6GB GDDR6" }).vram, "6 GB");
  assert.equal(specValues({ name: "Asus Prime B850M Soket AM5 Anakart" }).soket, "AM5");
  assert.equal(specValues({ name: "Logitech M280 Kablosuz Siyah Mouse" }).baglanti, "Kablosuz");
  assert.equal(specValues({ name: "Logitech M90 Kablolu USB Optik Mouse" }).baglanti, "Kablolu");
  assert.equal(specValues({ name: "Brother HL-L1232W Mono Lazer Yazıcı" }).baski, "Mono");
  assert.equal(specValues({ name: "Brother HL-L1232W Mono Lazer Yazıcı" }).teknoloji, "Lazer");
  assert.equal(specValues({ name: "Epson EcoTank Renkli Tanklı Yazıcı" }).baski, "Renkli");
  assert.equal(specValues({ name: "Epson EcoTank Renkli Tanklı Yazıcı" }).teknoloji, "Tanklı");

  const flash = [
    { id: "a", name: "Acer 16GB USB Flash Bellek" },
    { id: "b", name: "Acer 32GB USB Flash Bellek" },
    { id: "c", name: "Acer 64GB USB Flash Bellek" },
    { id: "d", name: "Acer 128GB USB Flash Bellek" },
  ];
  assert.ok(
    buildSpecFacets(flash, "bilgisayar-bilesenleri", "usb-ve-kart-bellek-urunleri").some(
      (group) => group.key === "depolama"
    )
  );

  const gpus = [
    { id: "g1", name: "Asus RTX3050 6GB GDDR6 Ekran Kartı" },
    { id: "g2", name: "MSI RTX4060 8GB GDDR6 Ekran Kartı" },
    { id: "g3", name: "Asus RTX5060 8GB GDDR7 Ekran Kartı" },
    { id: "g4", name: "Asus GT730 2GB DDR5 Ekran Kartı" },
  ];
  const gpuKeys = buildSpecFacets(gpus, "bilgisayar-bilesenleri", "ekran-kartlari").map((g) => g.key).sort();
  assert.ok(gpuKeys.includes("gpu"));
  assert.ok(gpuKeys.includes("vram"));
});

test("toner filters follow the toner mids under BASKI ÇÖZÜMLERİ", () => {
  const toners = [
    { id: "t1", name: "HP 85A Orijinal Siyah Toner" },
    { id: "t2", name: "Canon 737 Muadil Siyah Toner" },
    { id: "t3", name: "Epson T6641 Orijinal Cyan Mürekkep" },
    { id: "t4", name: "Brother TN-2456 Muadil Toner Siyah" },
  ];
  const keys = (groups) => groups.map((group) => group.key).sort();
  assert.deepEqual(keys(buildSpecFacets(toners, "baski-cozumleri")), ["renk", "tur"]);
  assert.deepEqual(keys(buildSpecFacets(toners, "baski-cozumleri", "yazici-tuketim-urunleri-orj")), ["renk", "tur"]);
  assert.deepEqual(keys(buildSpecFacets(toners, "baski-cozumleri", "fotokopi-tuketim")), ["renk", "tur"]);
  assert.deepEqual(buildSpecFacets(toners, "baski-cozumleri", "yazici-tarayici"), []);
  assert.deepEqual(buildSpecFacets(toners, "kartus-toner"), []);
  const result = queryPublicCatalog(
    toners.map((row) => Object.assign({ category: "baski-cozumleri", mid: "yazici-tuketim-urunleri-muadil", price: 100, active: true }, row)),
    { kategori: "baski-cozumleri", ara: "yazici-tuketim-urunleri-muadil", limit: 48 }
  );
  assert.ok(result.facets.specs.some((group) => group.key === "tur"));
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
