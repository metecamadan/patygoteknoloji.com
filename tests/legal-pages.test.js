const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const legalPages = [
  "mesafeli-satis-sozlesmesi.html",
  "hizmet-sozlesmesi.html",
  "iade-ve-cayma.html",
  "on-bilgilendirme-formu.html",
  "kvkk.html",
  "gizlilik.html",
  "cerez.html",
  "kullanim-kosullari.html",
];

test("legal pages remove draft disclaimer notes", () => {
  for (const file of legalPages) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(
      text,
      /Not:\s*Bu metin|hukuk danışman|şablon amaçlı|genel bir taslak/i,
      file + " should not show draft disclaimer notes"
    );
  }
});

test("legal pages include company identity and substantive sections", () => {
  for (const file of legalPages) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(text, /Patygo Teknoloji ve Bilişim/);
    assert.match(text, /info@patygoteknoloji\.com/);
    assert.match(text, /Son güncelleme:\s*29 Temmuz 2026/);
    assert.match(text, /<h2>/);
    const headings = (text.match(/<h2>/g) || []).length;
    assert.ok(headings >= 6, file + " should have substantive headings, got " + headings);
  }
  const identityPages = [
    "mesafeli-satis-sozlesmesi.html",
    "hizmet-sozlesmesi.html",
    "on-bilgilendirme-formu.html",
    "kvkk.html",
  ];
  for (const file of identityPages) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(text, /7230922773/, file + " should include tax ID");
  }
});

test("footer links to published legal contracts", () => {
  const footer = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(footer, /href="\/mesafeli-satis-sozlesmesi"/);
  assert.match(footer, /href="\/hizmet-sozlesmesi"/);
  assert.match(footer, /href="\/iade-ve-cayma"/);
  assert.match(footer, /href="\/on-bilgilendirme-formu"/);
  assert.match(footer, /href="\/kvkk"/);
  assert.match(footer, /href="\/gizlilik"/);
  assert.match(footer, /href="\/cerez"/);
  assert.match(footer, /href="\/kullanim-kosullari"/);
});

test("commerce contracts state storefront prices include VAT", () => {
  const mesafeli = fs.readFileSync(path.join(root, "mesafeli-satis-sozlesmesi.html"), "utf8");
  const onBilgi = fs.readFileSync(path.join(root, "on-bilgilendirme-formu.html"), "utf8");
  assert.match(mesafeli, /KDV dahildir/);
  assert.match(onBilgi, /KDV dahil/);
});

test("return and distance sale contracts exclude cartridge toner battery returns", () => {
  const iade = fs.readFileSync(path.join(root, "iade-ve-cayma.html"), "utf8");
  const mesafeli = fs.readFileSync(path.join(root, "mesafeli-satis-sozlesmesi.html"), "utf8");
  for (const [label, text] of [
    ["iade-ve-cayma.html", iade],
    ["mesafeli-satis-sozlesmesi.html", mesafeli],
  ]) {
    assert.match(text, /kartuş/i, label);
    assert.match(text, /toner/i, label);
    assert.match(text, /pil/i, label);
    assert.match(text, /iade (kabul )?edilmez|iade edilmez/i, label);
  }
});

test("legal/prose pages use compact hero and section spacing", () => {
  const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
  assert.match(css, /\.page-hero:has\(\+\s*\.section\s+\.prose\)/);
  assert.match(css, /\.page-hero\s*\+\s*\.section:has\(\.prose\)/);
  assert.match(css, /\.page-hero\s*\+\s*\.section\s+\.prose[\s\S]{0,80}max-width:\s*min\(920px/);
});
