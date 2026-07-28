const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "..", "assets", "css", "style.css"),
  "utf8"
);

test("mobile nav keeps cart visible and disables mega hover open", () => {
  assert.match(css, /\.nav-actions \.btn-outline:not\(\.cart-link\)\s*\{\s*display:\s*none/);
  assert.match(css, /\.nav-actions \.cart-link\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-mega:hover > \.nav-mega-panel\s*\{\s*display:\s*none/
  );
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\) and \(min-width:\s*861px\)/
  );
});

test("responsive UX: scroll padding, detail gallery cap, detail price, card actions", () => {
  assert.match(css, /html\s*\{[^}]*scroll-padding-top:\s*calc\(var\(--header-h\) \+ 12px\)/s);
  assert.match(css, /\.detail-info \.price\s*\{[^}]*font-weight:\s*800/s);
  assert.match(
    css,
    /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.detail-gallery,[\s\S]*?max-width:\s*min\(100%,\s*420px\)/
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.product-card \.actions\s*\{\s*grid-template-columns:\s*1fr/
  );
  assert.match(css, /\.breadcrumb\s*\{[^}]*flex-wrap:\s*wrap/s);
});
