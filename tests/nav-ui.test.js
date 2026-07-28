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
