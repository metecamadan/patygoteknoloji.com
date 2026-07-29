const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const logoPng = path.join(root, "assets", "img", "patygo-logo.png");
const logoSvg = path.join(root, "assets", "img", "patygo-logo.svg");

test("site and admin use the original PNG logo asset", () => {
  assert.ok(fs.existsSync(logoPng));
  assert.ok(fs.existsSync(logoSvg));
  assert.match(indexHtml, /class="brand"[\s\S]*patygo-logo\.png/);
  assert.match(adminHtml, /admin-logo[\s\S]*patygo-logo\.png|patygo-logo\.png[\s\S]*admin-logo/);
  assert.match(adminHtml, /src="\/assets\/img\/patygo-logo\.png"/);
  assert.doesNotMatch(indexHtml, /patygo-logo-on-dark\.svg/);
});

test("footer uses same PNG logo as header with white invert", () => {
  assert.match(indexHtml, /footer-brand[\s\S]*patygo-logo\.png/);
  assert.match(styleCss, /footer-brand img[\s\S]{0,220}filter:\s*brightness\(0\)\s*invert\(1\)/);
  assert.doesNotMatch(styleCss, /footer-brand img[\s\S]{0,120}content:\s*url\(/);
});
