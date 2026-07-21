const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "assets", "js", "main.js"), "utf8");
const cart = fs.readFileSync(path.join(root, "assets", "js", "cart.js"), "utf8");
const checkout = fs.readFileSync(path.join(root, "assets", "js", "checkout.js"), "utf8");

test("public pages track anonymous page views and successful leads", () => {
  assert.match(main, /trackAnalytics\(\s*"page_view"/);
  assert.match(main, /productId/);
  assert.match(main, /trackAnalytics\("lead_submitted"\)/);
  assert.match(main, /navigator\.doNotTrack/);
  assert.match(main, /sessionStorage/);
  assert.doesNotMatch(main, /email.*analytics|tel.*analytics/i);
});

test("commerce funnel tracks cart, checkout and completed request events", () => {
  assert.match(cart, /track\("add_to_cart"\)/);
  assert.match(checkout, /track\("checkout_started"\)/);
  assert.match(checkout, /track\("order_submitted"\)/);
});
