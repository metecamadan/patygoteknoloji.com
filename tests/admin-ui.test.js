const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const script = fs.readFileSync(path.join(root, "assets", "js", "admin.js"), "utf8");

test("admin markup has unique element IDs", () => {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test("products tab separates manual and XML product areas", () => {
  assert.match(html, /id="manualProductsSubtab"/);
  assert.match(html, /id="xmlProductsSubtab"/);
  assert.match(html, /id="manualProductsView"/);
  assert.match(html, /id="xmlProductsView"/);
  assert.match(script, /selectProductsView/);
});

test("admin exposes three XML connections and source-specific margins", () => {
  assert.equal((html.match(/data-supplier-card="supplier-/g) || []).length, 3);
  assert.match(html, /id="supplierSlotFilter"/);
  assert.match(html, /Özel kâr %/);
  assert.match(script, /marginPercent:\s*marginInput\.value/);
  assert.match(script, /supplierSlot:\s*item\.supplierSlot/);
});

test("admin overview exposes digital dashboard metrics", () => {
  assert.match(html, /id="dashFrom"/);
  assert.match(html, /id="dashTo"/);
  assert.match(html, /id="dashApplyPeriod"/);
  assert.match(html, /id="dashLeads"/);
  assert.match(html, /id="dashRevenue"/);
  assert.match(html, /id="dashAov"/);
  assert.match(html, /id="dashServerStatus"/);
  assert.match(script, /\/api\/admin\/dashboard/);
  assert.match(script, /loadDigitalDashboard/);
  assert.match(html, /id="dashTopViewed"/);
  assert.match(html, /id="dashTopPurchased"/);
  assert.match(script, /topViewedProducts/);
  assert.match(script, /topPurchasedProducts/);
});

test("admin never renders the default password as a login hint", () => {
  assert.doesNotMatch(html, /patygo-admin/);
  assert.match(html, /ADMIN_PASSWORD/);
});
