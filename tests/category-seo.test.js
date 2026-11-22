const test = require("node:test");
const assert = require("node:assert/strict");
const {
  categorySeoPathKey,
  resolveCategorySeo,
  categorySeoTitle,
  resetCategorySeoCache,
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
  assert.equal(categorySeoPathKey({ parent: "ofis-urunleri", mid: "", child: "" }), "ofis-urunleri");
});

test("curated notebook copy is unique and used in title", () => {
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
  assert.equal(seo.h1, "Notebooklar");
  assert.match(seo.lead, /notebook/i);
  assert.doesNotMatch(seo.lead, /Kategorilere göre ürünleri keşfedin/);
  assert.match(categorySeoTitle(seo), /^Notebooklar Fiyatları ve Modelleri/);
});

test("unknown leaf still gets a non-empty fallback lead", () => {
  resetCategorySeoCache();
  const seo = resolveCategorySeo(
    { parent: "bilgisayar-tablet", mid: "yok-boyle-mid", child: "" },
    ["Bilgisayar Tablet", "Uydurma Mid"]
  );
  assert.equal(seo.curated, false);
  assert.equal(seo.h1, "Uydurma Mid");
  assert.match(seo.lead, /Uydurma Mid/);
  assert.match(seo.lead, /Patygo Teknoloji/);
});

test("category-seo.json is publicly allowed next to categories.json", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /assets\/data\/category-seo\.json/);
  assert.match(serverJs, /writeCategorySeoBootstrapSnapshot/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "assets", "data", "category-seo.json")));
  const catalogJs = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "catalog.js"), "utf8");
  assert.match(catalogJs, /\/listing\/category-seo\.json/);
});
