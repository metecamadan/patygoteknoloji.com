const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "..", "assets", "css", "style.css"),
  "utf8"
);
const navBlockMatch = css.match(/@media \(max-width:\s*1023px\)\s*\{([\s\S]*?)\n\}/);
const navBlock = navBlockMatch ? navBlockMatch[1] : "";

test("hamburger nav starts at 1023px so two-line tablet labels never overlap", () => {
  assert.ok(navBlock, "missing @media (max-width: 1023px) header/nav block");
  assert.match(navBlock, /\.nav-categories-btn\s*\{[^}]*display:\s*inline-flex/);
  assert.match(navBlock, /--header-h:\s*64px/);
  assert.match(css, /@media \(max-width:\s*1180px\) and \(min-width:\s*1024px\)/);
  assert.doesNotMatch(css, /min-width:\s*861px/);
  const root = path.join(__dirname, "..");
  const mainJs = fs.readFileSync(path.join(root, "assets", "js", "main.js"), "utf8");
  const navJs = fs.readFileSync(path.join(root, "assets", "js", "nav.js"), "utf8");
  assert.match(mainJs, /function isMobileNav\(\)\s*\{\s*return window\.matchMedia\("\(max-width: 1023px\)"\)/);
  assert.match(navJs, /function isMobileNav\(\)\s*\{\s*return window\.matchMedia\("\(max-width: 1023px\)"\)/);
  assert.match(navJs, /isDesktopNav = \(\) => window\.matchMedia\("\(min-width: 1024px\)"\)/);
});

test("mobile nav keeps cart visible and disables mega hover open", () => {
  assert.match(navBlock, /\.nav-actions \.btn-outline:not\(\.cart-link\)\s*\{\s*display:\s*none/);
  assert.match(navBlock, /\.nav-actions \.cart-link\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(navBlock, /\.nav-mega:hover > \.nav-mega-panel\s*\{\s*display:\s*none/);
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\) and \(min-width:\s*1024px\)/
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

test("mobile catalog: two column grid, bottom-sheet facets, no quote rail overlap", () => {
  assert.match(
    css,
    /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.catalog-facets\s*\{[^}]*position:\s*static/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.catalog-layout\.has-facets \.product-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*620px\)\s*\{[\s\S]*?\.product-grid,\s*\.catalog-layout\.has-facets \.product-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s
  );
  assert.match(
    css,
    /\.catalog-facets\.is-open \.catalog-facets-body\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/s
  );
  assert.match(css, /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.quote-rail\s*\{\s*display:\s*none/s);
  assert.match(
    css,
    /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.products-page \.quote-rail\s*\{\s*display:\s*none/s
  );
  assert.match(css, /\.fab \.top:not\(\.show\)\s*\{\s*display:\s*none/s);
});

test("mobile nav drawer aligns category labels to the left", () => {
  assert.match(navBlock, /\.nav-mega\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(navBlock, /\.nav-mega-group-title[\s\S]*?display:\s*none/s);
  assert.match(navBlock, /\.nav-toggle[\s\S]*?display:\s*none/s);
  assert.match(navBlock, /\.nav-links\s*\{[^}]*top:\s*var\(--header-h\)/s);
  assert.match(navBlock, /\.nav-links\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(navBlock, /\.nav-links\s*\{[^}]*width:\s*100%/s);
  assert.match(navBlock, /\.site-header\s*\{[^}]*backdrop-filter:\s*none/s);
  assert.match(navBlock, /body\.nav-open::before/s);
  assert.match(navBlock, /\.nav-mega\s*\{[^}]*width:\s*100%/s);
  assert.match(navBlock, /\.nav-mega-group:not\(\.open\) > \.nav-mega-list[\s\S]*?display:\s*none/s);
  assert.match(navBlock, /\.nav-mega-group-toggle[\s\S]*?display:\s*flex/s);
});

test("wide screens use a 1440px layout with two-line menu labels and 5-slot product grids", () => {
  assert.match(css, /--container:\s*1440px/);
  const wide = /@media \(min-width:\s*1400px\)\s*\{([\s\S]*?)\n\}/g;
  const blocks = [...css.matchAll(wide)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(blocks, /\.nav-mega-label\s*\{/);
  assert.match(blocks, /\.nav-links > \.nav-mega\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(blocks, /\.product-grid,\s*\.catalog-layout\.has-facets \.product-grid\s*\{[^}]*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(
    blocks,
    /\.product-grid\[data-catalog="featured"\] > \.product-card:nth-child\(n \+ 11\)\s*\{\s*display:\s*none/
  );
  assert.doesNotMatch(css, /repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(blocks, /\.detail-thumbs\s*\{[^}]*max-width:\s*560px/);
});
