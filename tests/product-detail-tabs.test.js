const test = require("node:test");
const assert = require("node:assert/strict");
const { parseProductSpecChips, parseProductDetailSpecTable } = require("../lib/product-detail-specs");

const LENOVO_V15 =
  'Lenovo V15 83A100KXTR_40 Intel Core I7 1355U 40gb Ram 512GB SSD 15.6" FreeDOS Notebook (Upg)';

test("parseProductSpecChips extracts notebook specs from Lenovo V15 title", () => {
  const chips = parseProductSpecChips(LENOVO_V15);
  assert.ok(chips.includes('15.6" Ekran'));
  assert.ok(chips.includes("40 GB RAM"));
  assert.ok(chips.includes("512 GB SSD"));
  assert.ok(chips.some((chip) => /Intel Core i7-1355U/i.test(chip)));
  assert.ok(chips.includes("FreeDOS"));
});

test("parseProductDetailSpecTable reads pipe rows for spec table UI", () => {
  const rows = parseProductDetailSpecTable(
    "__SPEC_TABLE__\nEkran|15,6\" FHD\nBellek|40 GB RAM\nİşlemci|Intel Core i7-1355U"
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].label, "Ekran");
  assert.equal(rows[1].value, "40 GB RAM");
});

test("product detail tabs and spec chips are rendered in JS", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const script = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
  const html = fs.readFileSync(path.join(root, "urun-detay.html"), "utf8");
  assert.match(script, /detail-tabs/);
  assert.match(script, /buildDetailTabs/);
  assert.match(script, /detail-spec-grid/);
  assert.match(script, /detail-spec-title/);
  assert.match(script, /buildSpecTableFromRows/);
  assert.doesNotMatch(script, /detail-empty/);
  assert.match(script, /İade ve Cayma/);
  assert.doesNotMatch(script, /<li>Faturalı satış<\/li>/);
  assert.match(script, /<li>2 iş gününde kargoda<\/li>/);
  assert.match(script, /<li>3D Secure güvenli ödeme · kart bilgileriniz saklanmaz<\/li>/);
  assert.match(script, /href="https:\/\/wa\.me\/905555070724"[^>]*>WhatsApp<\/a> · <a href="tel:\+905555070724">0555 507 07 24<\/a>/);
  assert.match(script, /if \(isOriginalProduct\(product\)\) trustItems\.push\("<li>Orijinal ürün<\/li>"\);/);
  assert.match(script, /"Siparişiniz 2 iş gününde kargoya verilir\."/);
  assert.doesNotMatch(script, /Teslimat süresi sipariş onayından sonra size bildirilir/);
  assert.match(css, /\.detail-spec-grid/);
  assert.match(css, /\.detail-spec-value\.is-highlight/);
  assert.match(css, /\.detail-trust a \{/);
  assert.match(html, /detail-specs\.js/);
});

test("'Orijinal ürün' is withheld from muadil / compatible consumables", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const script = fs.readFileSync(path.resolve(__dirname, "..", "assets", "js", "urun-detay.js"), "utf8");
  const src = script.match(/function isOriginalProduct\(product\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "isOriginalProduct bulunamadı");
  const isOriginalProduct = new Function(src[0] + "\nreturn isOriginalProduct;")();
  assert.equal(isOriginalProduct({ mid: "yazici-tuketim-urunleri-orj", name: "HP 85A Orijinal Toner" }), true);
  assert.equal(isOriginalProduct({ mid: "yazici-tuketim-urunleri-muadil", name: "HP 85A Toner" }), false);
  assert.equal(isOriginalProduct({ mid: "fotokopi-tuketim", name: "Canon C-EXV33 Muadil Toner" }), false);
  assert.equal(isOriginalProduct({ mid: "fotokopi-tuketim", name: "Samsung MLT-D111S Uyumlu Toner" }), false);
  assert.equal(isOriginalProduct({ mid: "tasinabilir-bilgisayarlar", name: "Lenovo V15 Notebook" }), true);
});
