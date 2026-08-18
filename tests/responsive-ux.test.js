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
    /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.detail-gallery,[\s\S]*?max-width:\s*100%/
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.product-card \.actions\s*\{\s*grid-template-columns:\s*1fr/
  );
  assert.match(css, /\.breadcrumb\s*\{[^}]*flex-wrap:\s*wrap/s);
});

test("mobile catalog: single column grid, static facets, no quote rail overlap", () => {
  assert.match(
    css,
    /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.catalog-facets\s*\{[^}]*position:\s*static/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.catalog-layout\.has-facets \.product-grid\s*\{[^}]*grid-template-columns:\s*1fr/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.products-page \.quote-rail\s*\{\s*display:\s*none/s
  );
  assert.match(css, /\.fab \.top:not\(\.show\)\s*\{\s*display:\s*none/s);
});

test("mobile nav drawer aligns category labels to the left", () => {
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-categories-btn[\s\S]*?display:\s*inline-flex/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-toggle[\s\S]*?display:\s*none/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-links\s*\{[^}]*top:\s*var\(--header-h\)/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-links\s*\{[^}]*justify-content:\s*flex-start/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-links\s*\{[^}]*width:\s*100%/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.site-header\s*\{[^}]*backdrop-filter:\s*none/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?body\.nav-open::before/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-mega\s*\{[^}]*width:\s*100%/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-mega-group:not\(\.open\) > \.nav-mega-list[\s\S]*?display:\s*none/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.nav-mega-group-toggle[\s\S]*?display:\s*flex/s
  );
});
