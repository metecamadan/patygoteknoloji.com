const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const logoPng = path.join(root, "assets", "img", "patygo-logo.png");

test("site and admin use the original PNG logo asset", () => {
  assert.ok(fs.existsSync(logoPng));
  assert.match(indexHtml, /class="brand"[\s\S]*patygo-logo\.png/);
  assert.match(adminHtml, /src="\/assets\/img\/patygo-logo\.png"/);
});

test("footer uses the same PNG logo as header with no CSS image override", () => {
  assert.match(indexHtml, /footer-brand[\s\S]*src="\/assets\/img\/patygo-logo\.png"/);
  assert.doesNotMatch(styleCss, /footer-brand img[\s\S]{0,160}content:\s*url\(/);
  assert.doesNotMatch(styleCss, /footer-brand img[\s\S]{0,220}filter:\s*brightness\(0\)\s*invert\(1\)/);
});
