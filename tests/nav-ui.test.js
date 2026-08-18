const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const navJs = fs.readFileSync(path.join(root, "assets", "js", "nav.js"), "utf8");
const navCss = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");

test("category mega menu does not render Tümü parent link", () => {
  assert.doesNotMatch(navJs, /Tümü:/);
  assert.doesNotMatch(navJs, /nav-mega-parent/);
});

test("mega menu keeps hover bridge for submenu access", () => {
  assert.match(navCss, /\.nav-mega-panel::before/);
  assert.match(navCss, /\.nav-mega:hover > \.nav-mega-panel/);
  assert.match(navJs, /panel\.addEventListener\("mouseenter"/);
});

test("nav hides unpublished category nodes", () => {
  assert.match(navJs, /function publishedCategories/);
  assert.match(navJs, /active !== false/);
  assert.match(navJs, /BroadcastChannel\("patygo-catalog"\)/);
});

test("nav shows each main category in the top bar instead of a single Ürünler dump", () => {
  assert.match(navJs, /function buildMegaItem/);
  assert.match(navJs, /function buildMegaGroup/);
  assert.match(navJs, /bindMegaGroupAccordion/);
  assert.match(navJs, /published\.forEach\(\(cat\) => root\.appendChild\(buildMegaItem\(cat\)\)\)/);
  assert.match(navJs, /nav-mega-heading/);
  assert.match(navJs, /mouseenter/);
  assert.doesNotMatch(navJs, /published\.length\s*>\s*4/);
  assert.doesNotMatch(navJs, /is-catalog/);
  assert.match(navJs, /nav-mega-groups/);
  assert.match(navJs, /nav-mega-group-title/);
  assert.match(navCss, /\.nav-links\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(navCss, /\.nav-links\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(navCss, /\.nav-links\s*\{[^}]*overflow:\s*visible/s);
  assert.match(navCss, /\.nav-mega-panel\s*\{[^}]*left:\s*0/s);
  assert.match(navCss, /\.nav-mega-panel\s*\{[^}]*right:\s*0/s);
  assert.match(navCss, /\.nav-mega-panel\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(navCss, /\.nav-mega-panel\s*\{[^}]*width:\s*max-content/s);
  assert.doesNotMatch(navCss, /\.nav-links\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(navCss, /--header-h:\s*72px/);
  assert.match(navCss, /\.nav-mega-groups\s*\{[^}]*overflow:\s*visible/s);
  assert.match(navCss, /\.nav-mega-groups\s*\{[^}]*column-width/s);
  assert.doesNotMatch(navCss, /\.nav-mega-groups\s*\{[^}]*overflow:\s*auto/s);
  assert.match(navCss, /\.nav-mega-group-title\s*\{[^}]*font-weight:\s*800/s);
  assert.match(navCss, /scrollbar-gutter:\s*stable/);
});

test("Teklif Al sits on the right viewport edge, not in the header nav", () => {
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const mainJs = fs.readFileSync(path.join(root, "assets", "js", "main.js"), "utf8");
  const navBlock = indexHtml.match(/<div class="nav-actions">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(navBlock, /Teklif Al/);
  assert.match(mainJs, /quote-rail/);
  assert.match(mainJs, /Teklif Al/);
});

test("main nav categories render as two-line labels", () => {
  assert.match(navJs, /function splitNavCategoryName/);
  assert.match(navJs, /function buildNavCategoryLabel/);
  assert.match(navJs, /function formatNavMobileName/);
  assert.match(navJs, /nav-mega-label-line/);
  assert.match(navJs, /nav-mega-mobile-label/);
  assert.match(navCss, /\.nav-mega-label\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(navCss, /\.nav-mega-mobile-label/);
});

test("mobile category tab opens sheet below header", () => {
  const mainJs = fs.readFileSync(path.join(root, "assets", "js", "main.js"), "utf8");
  assert.match(mainJs, /function initCategoryNav/);
  assert.match(mainJs, /nav-categories-btn/);
  assert.match(mainJs, /nav\.insertBefore\(catBtn,\s*brand\)/);
  assert.match(mainJs, /nav-sheet/);
  assert.match(mainJs, /document\.body\.appendChild\(links\)/);
  assert.match(navCss, /\.nav-categories-btn/);
  assert.match(
    navCss,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-links\.open[\s\S]*?transform:\s*translateY\(0\)/s
  );
});

test("nav reads category tree from disk listing snapshot first", () => {
  assert.match(navJs, /\/listing\/categories\.json/);
  assert.match(navJs, /NAV_SOURCE_FALLBACK/);
});
