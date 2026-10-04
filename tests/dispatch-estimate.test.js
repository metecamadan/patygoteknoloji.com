const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const {
  normalizeShippingSettings,
  createShippingSettingsStore,
} = require("../lib/shipping-settings");
const { buildAkakceXml } = require("../lib/akakce");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function loadShippingApi() {
  const window = {};
  vm.runInNewContext(read("assets/js/shipping.js"), { window, document: {}, fetch() {}, console });
  return window.PatygoShipping;
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

test("dispatch estimate skips weekends and counts from the next day", () => {
  const api = loadShippingApi();
  const sunday = Date.parse("2026-10-04T10:00:00Z");
  assert.equal(iso(api.estimateDispatchDate(sunday, { dispatchBusinessDays: 2 })), "2026-10-06");
  const friday = Date.parse("2026-10-09T08:00:00Z");
  assert.equal(iso(api.estimateDispatchDate(friday, { dispatchBusinessDays: 2 })), "2026-10-13");
  assert.equal(iso(api.estimateDispatchDate(friday, {})), "2026-10-13", "default is 2 business days");
});

test("dispatch estimate skips fixed public holidays and admin closed days", () => {
  const api = loadShippingApi();
  const beforeRepublicDay = Date.parse("2026-10-28T09:00:00Z");
  assert.equal(iso(api.estimateDispatchDate(beforeRepublicDay, { dispatchBusinessDays: 2 })), "2026-11-02");
  const withClosed = { dispatchBusinessDays: 2, closedDays: ["2026-10-06"] };
  assert.equal(iso(api.estimateDispatchDate(Date.parse("2026-10-04T10:00:00Z"), withClosed)), "2026-10-07");
});

test("dispatch estimate uses Istanbul calendar day", () => {
  const api = loadShippingApi();
  const lateSundayUtc = Date.parse("2026-10-04T22:30:00Z");
  assert.equal(iso(api.estimateDispatchDate(lateSundayUtc, { dispatchBusinessDays: 2 })), "2026-10-07");
  assert.match(api.formatDispatchDate(new Date("2026-10-06T00:00:00Z")), /6 Ekim/);
});

test("shipping settings validate dispatch days and closed dates", () => {
  const cfg = normalizeShippingSettings({
    dispatchBusinessDays: 99,
    closedDays: "2027-03-10\n2027-03-09, 2027-02-30 bozuk 2027-03-09",
  });
  assert.equal(cfg.dispatchBusinessDays, 10);
  assert.deepEqual(cfg.closedDays, ["2027-03-09", "2027-03-10"]);
  assert.equal(normalizeShippingSettings({}).dispatchBusinessDays, 2);
  assert.equal(normalizeShippingSettings({ dispatchBusinessDays: 0 }).dispatchBusinessDays, 1);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-ship-"));
  const store = createShippingSettingsStore(root);
  store.setSettings({ shippingFee: 100, dispatchBusinessDays: 3, closedDays: ["2020-01-02", "2099-05-05"] });
  const pub = store.getPublic();
  assert.equal(pub.dispatchBusinessDays, 3);
  assert.deepEqual(pub.closedDays, ["2099-05-05"], "past closed days are not published");
});

test("Akakçe dayOfDelivery follows the admin dispatch setting", () => {
  const product = {
    id: "a1",
    supplierSku: "A1",
    brand: "HP",
    name: "Notebook",
    price: 1000,
    vatPercent: 20,
    category: "bilgisayar-tablet",
    siteParent: "bilgisayar-tablet",
    siteMid: "tasinabilir-bilgisayarlar",
    siteChild: "notebooklar",
    description: "Kısa açıklama",
    image: "https://cdn.example/a.jpg",
    stockQty: 3,
    active: true,
    source: "supplier",
    manufacturerCode: "A1-MPN",
    barcode: "8690000000002",
    gtipCode: "84.71.30.00.00.00",
    mainCategory: "KİŞİSEL BİLGİSAYARLAR",
    midCategory: "Taşınabilir Bilgisayarlar",
    subCategory: "Notebooklar",
    currency: "TRY",
    unit: "ADET",
    lastSuccessfulFetchAt: new Date().toISOString(),
  };
  const xml = buildAkakceXml([product], {
    siteBaseUrl: "https://patygoteknoloji.com",
    shippingSettings: normalizeShippingSettings({ shippingFee: 100, dispatchBusinessDays: 3 }),
  });
  assert.match(xml, /<dayOfDelivery>3<\/dayOfDelivery>/);
});

test("product detail and cart show the estimated dispatch date", () => {
  const detail = read("assets/js/urun-detay.js");
  assert.match(detail, /createDispatchEl\(\)/);
  assert.match(detail, /dispatchDaysLabel\(\) \+ " kargoya verilir\."/);
  assert.match(read("assets/js/sepet.js"), /tahmini kargoya veriliş/);
  assert.match(read("sepet.html"), /id="cartDispatch"/);
  const admin = read("admin.html");
  assert.match(admin, /id="shippingDispatchDays"/);
  assert.match(admin, /id="shippingClosedDays"/);
});

test("dispatch estimate line is a quiet muted note, not a highlighted callout", () => {
  const css = read("assets/css/style.css");
  const rule = css.match(/\.product-dispatch,\s*\.cart-dispatch\s*\{([^}]*)\}/);
  assert.ok(rule, "shared dispatch rule");
  assert.match(rule[1], /color:\s*var\(--muted\)/);
  assert.match(rule[1], /font-weight:\s*500/);
});
