const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildProductHighlights,
  stockLevelLabel,
  warrantyMonthsFromName,
  isElectronicCategory,
} = require("../lib/product-highlights");
const { toPublicProduct } = require("../lib/catalog");

const root = path.resolve(__dirname, "..");

test("stock level is a bucket, never the exact supplier count above 5", () => {
  assert.equal(stockLevelLabel(1), "Son 1 adet");
  assert.equal(stockLevelLabel(5), "Son 5 adet");
  assert.equal(stockLevelLabel(6), "10 adetten az");
  assert.equal(stockLevelLabel(9), "10 adetten az");
  assert.equal(stockLevelLabel(10), "50 adetten az");
  assert.equal(stockLevelLabel(49), "50 adetten az");
  assert.equal(stockLevelLabel(50), "50+ adet");
  assert.equal(stockLevelLabel(4200), "50+ adet");
  assert.equal(stockLevelLabel(0), "");
  assert.equal(stockLevelLabel(null), "");
  assert.equal(stockLevelLabel(undefined), "");
});

test("warranty duration written in the product name wins", () => {
  assert.equal(warrantyMonthsFromName("WD Purple 4TB Sata3 (3 Yıl Resmı Dıst Garantılı)"), 36);
  assert.equal(warrantyMonthsFromName("Seagate IronWolf 8TB NAS Diski (5 Yıl Garantili)"), 60);
  assert.equal(warrantyMonthsFromName("Ürün 24 Ay Garanti"), 24);
  assert.equal(warrantyMonthsFromName("Seagate Exos 12TB (Arena Garantili)"), 0);
});

test("default 24-month warranty only for listed electronic categories", () => {
  assert.equal(isElectronicCategory("tasinabilir-bilgisayarlar", "notebooklar"), true);
  assert.equal(isElectronicCategory("elektrik-urunleri", "prizler"), true);
  assert.equal(isElectronicCategory("monitorler-ve-aks", "monitorler"), true);
  assert.equal(isElectronicCategory("monitorler-ve-aks", "aski-ve-stand"), false);
  assert.equal(isElectronicCategory("yazici-tuketim-urunleri-orj", "laser-tonerler"), false);
  assert.equal(isElectronicCategory("yazilim-urunleri", "office"), false);
  assert.equal(isElectronicCategory("kagit-urunleri", "fotokopi-kagitlari"), false);
  assert.equal(isElectronicCategory("", ""), false);
});

test("notebook highlights: two spec rows, warranty, stock bucket", () => {
  const items = buildProductHighlights(
    {
      name: 'Lenovo V15 Intel Core I7 1355U 40gb Ram 512GB SSD 15.6" FreeDOS Notebook',
      details:
        "__SPEC_TABLE__\nEkran boyutu|15.6\"\nBellek|40 GB RAM\nDepolama|512 GB SSD\nÜretici kodu|83A100KXTR_40\nBarkod|8680679823852\nMarka|Lenovo",
      siteMid: "tasinabilir-bilgisayarlar",
      siteChild: "notebooklar",
      stockQty: 3,
    },
    { brand: "Lenovo" }
  );
  assert.deepEqual(items, [
    { label: "Ekran boyutu", value: '15.6"' },
    { label: "Bellek", value: "40 GB RAM" },
    { label: "Garanti Süresi", value: "24 Ay" },
    { label: "Stok Durumu", value: "Son 3 adet" },
  ]);
});

test("codes and filler rows never become tiles; brand fills a thin card", () => {
  const items = buildProductHighlights(
    {
      name: "Almera 3lü 2mt Topraklı Priz (9230102)",
      details:
        "__SPEC_TABLE__\nModel|9230102\nÜrün tipi|Ürün\nVitrin özeti|3lü 2mt\nKatalog notu|x\nEk bilgi 1|3lü 2mt\nÜretici kodu|400.70.20.0097\nBarkod|8697659140021\nMarka|Almera",
      siteMid: "elektrik-urunleri",
      siteChild: "prizler",
      stockQty: 120,
    },
    { brand: "Almera" }
  );
  assert.deepEqual(items, [
    { label: "Garanti Süresi", value: "24 Ay" },
    { label: "Stok Durumu", value: "50+ adet" },
    { label: "Marka", value: "Almera" },
  ]);
  const text = JSON.stringify(items);
  assert.doesNotMatch(text, /400\.70\.20\.0097|9230102|8697659140021/);
});

test("consumables and demo units get no default warranty tile", () => {
  const toner = buildProductHighlights({
    name: "HP 85A Orijinal Toner",
    details: "__SPEC_TABLE__\nTip|Orijinal toner",
    siteMid: "yazici-tuketim-urunleri-orj",
    siteChild: "laser-tonerler",
    stockQty: 20,
  });
  assert.equal(toner.some((item) => item.label === "Garanti Süresi"), false);
  const demo = buildProductHighlights({
    name: "Canon LBP6030BK Demo + 2 Orjınal Toner Hediyeli",
    siteMid: "yazici-tarayici",
    siteChild: "mono-laser",
    stockQty: 2,
  });
  assert.equal(demo.some((item) => item.label === "Garanti Süresi"), false);
});

test("public detail product carries highlights; compact list rows do not", () => {
  const product = {
    id: "sup-x",
    brand: "KINGSTON",
    name: "Kingston 16GB 3200MHz DDR4 NON-ECC DIMM CL22 Pc Ram KVR32N22D8-16",
    price: 1000,
    category: "bilgisayar-bilesenleri",
    siteParent: "bilgisayar-bilesenleri",
    siteMid: "bellekler",
    siteChild: "pc-bellegi-ddr4",
    source: "supplier",
    supplierSku: "100.10.10.0008",
    manufacturerCode: "KVR32N22D8-16",
    stockQty: 7,
    image: "https://cdn.example/a.jpg",
    images: ["https://cdn.example/a.jpg"],
  };
  const full = toPublicProduct(product);
  assert.ok(Array.isArray(full.highlights));
  assert.ok(full.highlights.some((item) => item.label === "Garanti Süresi" && item.value === "24 Ay"));
  assert.ok(full.highlights.some((item) => item.label === "Stok Durumu" && item.value === "10 adetten az"));
  assert.doesNotMatch(JSON.stringify(full), /100\.10\.10\.0008/);
  assert.equal(Object.prototype.hasOwnProperty.call(full, "stockQty"), false);
  const compact = toPublicProduct(product, { compact: true });
  assert.equal(Object.prototype.hasOwnProperty.call(compact, "highlights"), false);
});

test("detail page renders the hub card under the trust list and upgrades listing hits", () => {
  const script = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
  assert.match(script, /function buildHighlights\(product\)/);
  assert.match(script, /Ürün Bilgileri/);
  assert.match(script, /info\.appendChild\(trust\);\s*const hub = buildHighlights\(product\);\s*if \(hub\) info\.appendChild\(hub\);/);
  assert.match(script, /source: "listing", full: api/);
  assert.match(script, /won\.full/);
  assert.match(css, /\.detail-hub-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
