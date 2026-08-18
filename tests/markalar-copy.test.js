const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "markalar.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "style.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("markalar why section uses left-aligned copy and spaced metrics", () => {
  assert.match(html, /section-head--start/);
  assert.match(html, /class="metrics"/);
  assert.match(html, /<strong>43\+<\/strong><span>Marka portföyü<\/span>/);
  assert.match(html, /<strong>%100<\/strong><span>Faturalı satış<\/span>/);
  assert.match(html, /<strong>B2B<\/strong><span>Kurumsal odak<\/span>/);
  assert.match(html, /<strong>TR<\/strong><span>Yerel tedarik<\/span>/);
  assert.doesNotMatch(html, /<strong>100%<\/strong>/);
  assert.doesNotMatch(html, /43\+Marka|100%Faturalı|B2BKurumsal|TRYerel/);
  assert.match(css, /\.metrics\s*\{/);
  assert.match(css, /\.metric\s*\{/);
  assert.match(css, /\.section-head--start/);
});

test("homepage dark stats use Turkish percent order", () => {
  assert.match(indexHtml, /<strong>%100<\/strong><span>Faturalı satış<\/span>/);
  assert.doesNotMatch(indexHtml, /<strong>100%<\/strong>/);
});
