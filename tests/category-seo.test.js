const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  categorySeoPathKey,
  resolveCategorySeo,
  categorySeoTitle,
  categorySeoPayload,
  buildAllCategorySeoEntries,
  resetCategorySeoCache,
  BANNED,
} = require("../lib/category-seo");

test("category SEO path key joins parent/mid/child", () => {
  assert.equal(
    categorySeoPathKey({
      parent: "bilgisayar-tablet",
      mid: "tasinabilir-bilgisayarlar",
      child: "notebooklar",
    }),
    "bilgisayar-tablet/tasinabilir-bilgisayarlar/notebooklar"
  );
});

test("auto copy: one-line teaser + multi-paragraph detail for any new leaf", () => {
  resetCategorySeoCache();
  const seo = resolveCategorySeo(
    { parent: "bilgisayar-tablet", mid: "yok-boyle-mid", child: "yeni-yaprak" },
    ["Bilgisayar Tablet", "Uydurma Mid", "Yeni Yaprak"]
  );
  assert.equal(seo.curated, false);
  assert.equal(seo.h1, "Yeni Yaprak");
  assert.match(seo.teaser, /^Bu kategorideki Yeni Yaprak/);
  assert.match(seo.teaser, /inceleyebilir ve güvenli ödeme ile Patygo Teknoloji üzerinden sipariş verebilirsiniz\.$/);
  assert.doesNotMatch(seo.teaser, /sipariş edilebilir|stoktakiler/);
  assert.doesNotMatch(seo.teaser, /\n/);
  assert.ok(seo.teaser.length < 260, "teaser stays one short sentence");
  assert.equal(seo.detailParagraphs.length >= 2, true);
  assert.match(seo.detailHeading, /hakkında/);
  assert.doesNotMatch(seo.teaser, BANNED);
  seo.detailParagraphs.forEach((p) => assert.doesNotMatch(p, BANNED));
});

test("curated notebook keeps alt keywords without spam", () => {
  resetCategorySeoCache();
  const seo = resolveCategorySeo(
    {
      parent: "bilgisayar-tablet",
      mid: "tasinabilir-bilgisayarlar",
      child: "notebooklar",
    },
    ["Bilgisayar Tablet", "Taşınabilir Bilgisayarlar", "Notebooklar"]
  );
  assert.equal(seo.curated, true);
  assert.match(seo.teaser, /^Bu kategorideki/);
  assert.match(seo.teaser, /dizüstü bilgisayar ve laptop/);
  assert.doesNotMatch(seo.teaser, /sipariş edilebilir/);
  assert.match(seo.detailParagraphs.join(" "), /dizüstü|laptop/i);
  assert.match(categorySeoTitle(seo), /^Notebooklar Fiyatları/);
});

test("buildAllCategorySeoEntries covers every tree node automatically", () => {
  resetCategorySeoCache();
  const tree = [
    {
      slug: "demo-ust",
      name: "DEMO ÜST",
      children: [
        {
          slug: "demo-mid",
          name: "Demo Mid",
          children: [{ slug: "demo-yaprak", name: "Demo Yaprak" }],
        },
      ],
    },
  ];
  const entries = buildAllCategorySeoEntries(tree);
  assert.ok(entries["demo-ust"]);
  assert.ok(entries["demo-ust/demo-mid"]);
  assert.ok(entries["demo-ust/demo-mid/demo-yaprak"]);
  assert.match(entries["demo-ust/demo-mid/demo-yaprak"].teaser, /Demo Yaprak/);
  const payload = categorySeoPayload(tree);
  assert.equal(payload.version, 2);
  assert.equal(Object.keys(payload.entries).length, 3);
});

test("category-seo bootstrap path and client fetch listing JSON", () => {
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /writeCategorySeoBootstrapSnapshot/);
  assert.match(serverJs, /categorySeoPayload/);
  const catalogJs = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "catalog.js"), "utf8");
  assert.match(catalogJs, /\/listing\/category-seo\.json/);
  assert.match(catalogJs, /data-catalog-seo-detail/);
  const urunler = fs.readFileSync(path.join(__dirname, "..", "urunler.html"), "utf8");
  assert.match(urunler, /data-catalog-seo-detail/);
});
