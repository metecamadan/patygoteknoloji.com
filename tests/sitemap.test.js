const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildStorefrontSitemap,
  collectCategoryPaths,
  collectProductPaths,
  xmlEscape,
} = require("../lib/sitemap");

test("xmlEscape escapes markup characters", () => {
  assert.equal(xmlEscape(`a&b<"'>`), "a&amp;b&lt;&quot;&apos;&gt;");
});

test("collectCategoryPaths walks ANA / ARA / ALT", () => {
  const paths = collectCategoryPaths([
    {
      slug: "bilgisayar-tablet",
      children: [
        {
          slug: "tasinabilir-bilgisayarlar",
          children: [{ slug: "notebooklar" }],
        },
      ],
    },
  ]);
  assert.deepEqual(paths, [
    "/urunler/bilgisayar-tablet",
    "/urunler/bilgisayar-tablet/tasinabilir-bilgisayarlar",
    "/urunler/bilgisayar-tablet/tasinabilir-bilgisayarlar/notebooklar",
  ]);
});

test("buildStorefrontSitemap includes categories products and omits checkout", () => {
  const xml = buildStorefrontSitemap({
    baseUrl: "https://patygoteknoloji.com",
    now: new Date("2026-09-04T12:00:00Z"),
    categories: [{ slug: "kartus-toner", children: [] }],
    routeIndex: {
      byId: {
        a: "/intel-islemci/i3-ornek",
        b: "/notebook/lenovo-ornek",
      },
    },
  });
  assert.match(xml, /<loc>https:\/\/patygoteknoloji\.com\/<\/loc>/);
  assert.match(xml, /urunler\/kartus-toner/);
  assert.match(xml, /intel-islemci\/i3-ornek/);
  assert.match(xml, /notebook\/lenovo-ornek/);
  assert.doesNotMatch(xml, /\/sepet/);
  assert.doesNotMatch(xml, /\/odeme/);
  assert.doesNotMatch(xml, /\/admin/);
  assert.equal(collectProductPaths({ byId: { a: "/x/y" } }).length, 1);
});
