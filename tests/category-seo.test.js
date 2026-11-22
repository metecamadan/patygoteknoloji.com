const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  categorySeoPathKey,
  categoryLevel,
  resolveCategorySeo,
  categorySeoTitle,
  categorySeoPayload,
  buildAllCategorySeoEntries,
  resetCategorySeoCache,
  BANNED,
} = require("../lib/category-seo");

const REPEATED_CLOSING =
  /KDV dahil güncel fiyatlarla inceleyebilir; güvenli ödeme ile Patygo Teknoloji üzerinden sipariş verebilirsiniz/;

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

test("categoryLevel maps root / mid / leaf", () => {
  assert.equal(categoryLevel({ parent: "a", mid: "", child: "" }), "root");
  assert.equal(categoryLevel({ parent: "a", mid: "b", child: "" }), "mid");
  assert.equal(categoryLevel({ parent: "a", mid: "b", child: "c" }), "leaf");
});

test("auto copy: leaf teaser differs from mid and root closings", () => {
  resetCategorySeoCache();
  const root = resolveCategorySeo({ parent: "demo-ana", mid: "", child: "" }, ["Demo Ana"]);
  const mid = resolveCategorySeo(
    { parent: "demo-ana", mid: "demo-ara", child: "" },
    ["Demo Ana", "Demo Ara"]
  );
  const leaf = resolveCategorySeo(
    { parent: "bilgisayar-tablet", mid: "yok-boyle-mid", child: "yeni-yaprak" },
    ["Bilgisayar Tablet", "Uydurma Mid", "Yeni Yaprak"]
  );
  assert.equal(leaf.curated, false);
  assert.equal(leaf.h1, "Yeni Yaprak");
  assert.match(root.teaser, /^Bu ana kategoride/);
  assert.match(mid.teaser, /^Bu ara kategorideki/);
  assert.match(leaf.teaser, /^Stoktaki modelleri/);
  assert.notEqual(root.teaser, mid.teaser);
  assert.notEqual(mid.teaser, leaf.teaser);
  assert.notEqual(root.teaser, leaf.teaser);
  assert.doesNotMatch(root.teaser, REPEATED_CLOSING);
  assert.doesNotMatch(mid.teaser, REPEATED_CLOSING);
  assert.doesNotMatch(leaf.teaser, REPEATED_CLOSING);
  assert.doesNotMatch(leaf.teaser, /Bu kategorideki Yeni Yaprak ürünlerini/);
  assert.doesNotMatch(leaf.teaser, /sipariş edilebilir|stoktakiler/);
  assert.doesNotMatch(leaf.teaser, /\n/);
  assert.ok(leaf.teaser.length < 280, "teaser stays one short sentence");
  assert.equal(leaf.detailParagraphs.length >= 2, true);
  assert.match(leaf.detailHeading, /hakkında/);
  assert.doesNotMatch(leaf.teaser, BANNED);
  leaf.detailParagraphs.forEach((p) => assert.doesNotMatch(p, BANNED));
});

test("mid category teaser does not echo H1 as ürünlerini", () => {
  resetCategorySeoCache();
  const seo = resolveCategorySeo(
    { parent: "bilgisayar-tablet", mid: "tasinabilir-bilgisayarlar", child: "" },
    ["Bilgisayar Tablet", "Taşınabilir Bilgisayarlar"]
  );
  assert.equal(seo.h1, "Taşınabilir Bilgisayarlar");
  assert.doesNotMatch(seo.teaser, /Taşınabilir Bilgisayarlar ürünlerini/);
  assert.match(seo.teaser, /^Bu ara kategorideki ürünleri/);
  assert.match(seo.teaser, /notebook|dizüstü|laptop/i);
  assert.doesNotMatch(seo.teaser, REPEATED_CLOSING);
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
  assert.match(seo.teaser, /^Stoktaki modelleri/);
  assert.doesNotMatch(seo.teaser, REPEATED_CLOSING);
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
  assert.match(entries["demo-ust"].teaser, /^Bu ana kategoride/);
  assert.match(entries["demo-ust/demo-mid"].teaser, /^Bu ara kategorideki/);
  assert.match(entries["demo-ust/demo-mid/demo-yaprak"].teaser, /^Stoktaki modelleri/);
  assert.doesNotMatch(entries["demo-ust/demo-mid/demo-yaprak"].teaser, /Demo Yaprak ürünlerini/);
  assert.match(entries["demo-ust/demo-mid/demo-yaprak"].detailParagraphs.join(" "), /Demo Yaprak/);
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
