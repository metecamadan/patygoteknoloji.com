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
  assert.match(css, /\.detail-spec-grid/);
  assert.match(css, /\.detail-spec-value\.is-highlight/);
  assert.match(html, /detail-specs\.js/);
});
