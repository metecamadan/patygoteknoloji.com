const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const css = read("assets/css/style.css");
const nav = read("assets/js/nav.js");
const detail = read("assets/js/urun-detay.js");
const catalog = read("assets/js/catalog.js");

test("D43/D44: mobile menu has 'Tümünü gör' links plus pages and contact", () => {
  assert.match(nav, /allLi\.className = "nav-mega-all"/);
  assert.match(nav, /"Tümünü gör: " \+ category\.name/);
  assert.match(nav, /root\.appendChild\(buildMobileNavExtras\(\)\)/);
  for (const href of ["/markalar", "/kurumsal", "/iletisim", "tel:+905555070724", "https://wa.me/905555070724"]) {
    assert.ok(nav.includes('href="' + href + '"'), "mobile menu links " + href);
  }
  assert.match(css, /\.nav-mega-all,\s*\.nav-mega-all-parent,\s*\.nav-mobile-extras,[\s\S]*?\{\s*display:\s*none;\s*\}/);
});

test("D42: product page has a mobile sticky add-to-cart bar driven by the main button", () => {
  assert.match(detail, /function bindStickyBuyBar\(product, actions, add\)/);
  assert.match(detail, /bindStickyBuyBar\(product, actions, add\);/);
  assert.match(detail, /add\.click\(\)/);
  assert.match(css, /\.detail-sticky-bar:not\(\[hidden\]\)\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /body\.has-detail-bar \.fab/);
});

test("D48: product gallery switches images by swipe", () => {
  assert.match(detail, /function bindSwipe\(target, step\)/);
  assert.match(detail, /bindSwipe\(zoom, \(dir\) => showImage\(activeIndex \+ dir\)\)/);
  assert.match(detail, /passive: true/);
});

test("D45: mobile facets open as a bottom sheet with close and results buttons", () => {
  assert.match(catalog, /catalog-facets-sheet-head/);
  assert.match(catalog, /"Sonuçları göster"/);
  assert.match(catalog, /catalog-facets-backdrop/);
});

test("D46/D47/D49/D50: no rail overlap, compact hero, scrollable breadcrumb, 44px targets, no mobile fade", () => {
  assert.match(css, /@media \(max-width: 620px\)\s*\{\s*\.home \.hero-visual \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.breadcrumb\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.nav-search button\[type="submit"\] \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(css, /\.check-inline input\[type="checkbox"\] \{ width: 22px; height: 22px;/);
  assert.match(css, /\.reveal,\s*\.reveal\.d1,\s*\.reveal\.d2 \{ opacity: 1; transform: none; transition: none; \}/);
  assert.match(css, /\.nav-search\.open input\[type="search"\] \{ font-size: 16px; \}/);
});
