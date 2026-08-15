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
  assert.match(navJs, /published\.forEach\(\(cat\) => root\.appendChild\(buildMegaItem\(cat\)\)\)/);
  assert.match(navJs, /nav-mega-heading/);
  assert.match(navJs, /mouseenter/);
  assert.doesNotMatch(navJs, /published\.length\s*>\s*4/);
  assert.doesNotMatch(navJs, /is-catalog/);
  assert.match(navJs, /nav-mega-groups/);
  assert.match(navJs, /nav-mega-group-title/);
  assert.match(navCss, /\.nav-links\s*\{[^}]*flex:\s*1 1 100%/s);
  assert.match(navCss, /\.nav-mega-heading/);
});
