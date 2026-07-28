const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "..", "assets", "css", "style.css"),
  "utf8"
);

test("product card images use absolute fill so SVG demos render", () => {
  assert.match(css, /\.product-card \.visual\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.product-card \.visual img\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.product-card \.visual img\s*\{[^}]*object-fit:\s*contain/s);
});
