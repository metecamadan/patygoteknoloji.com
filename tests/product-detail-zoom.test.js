const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const script = fs.readFileSync(path.join(root, "assets", "js", "urun-detay.js"), "utf8");

test("product detail uses desktop hover zoom pane like standard e-com", () => {
  assert.match(script, /function bindHoverZoom/);
  assert.match(script, /detail-zoom-pane/);
  assert.match(script, /detail-zoom-lens/);
  assert.match(script, /hover:\s*hover/);
  assert.match(script, /pointerdown.*hide|hide\(\).*blur/s);
  assert.match(script, /hoverZoom\.hide|hoverZoom && hoverZoom\.hide/);
  assert.match(css, /\.detail-zoom-pane\s*\{/);
  assert.match(css, /\.detail-zoom-pane\.is-active/);
  assert.match(css, /\.detail-zoom-lens\s*\{/);
  assert.match(css, /\.detail-zoom-lens\[hidden\]/);
});

test("product detail lightbox is fullscreen dark overlay not white card", () => {
  assert.match(script, /detail-lightbox-frame/);
  assert.match(css, /\.detail-lightbox\s*\{[^}]*background:\s*transparent/s);
  assert.match(css, /\.detail-lightbox::backdrop\s*\{[^}]*rgba\(0,\s*0,\s*0/s);
  assert.match(css, /\.detail-lightbox img\s*\{[^}]*max-height:\s*min\(88vh/s);
  assert.doesNotMatch(css, /\.detail-lightbox\s*\{[^}]*background:\s*#fff/s);
});
