const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "urun-detay.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const script = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");

test("product detail caps image size and disables enlarge/drag", () => {
  assert.match(css, /\.detail-media\s*\{[^}]*max-width:\s*420px/s);
  assert.match(css, /\.detail-media img\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.detail-media img\s*\{[^}]*-webkit-user-drag:\s*none/s);
  assert.match(script, /protectMedia/);
  assert.match(script, /draggable["']?,\s*["']false/);
});

test("product detail allows copying name and description", () => {
  assert.match(html, /product-detail-page/);
  assert.doesNotMatch(html, /no-copy/);
  assert.doesNotMatch(script, /bindCopyGuard/);
  assert.doesNotMatch(script, /selectstart/);
  assert.doesNotMatch(css, /\.product-detail-page \.no-copy/);
  assert.doesNotMatch(css, /\.product-detail-page \.detail-info h1[\s\S]{0,200}user-select:\s*none/);
  assert.match(script, /meta\[name="description"\]|name\s*=\s*["']description["']/);
  assert.match(script, /textContent\s*=\s*product\.(description|details|name)/);
});
