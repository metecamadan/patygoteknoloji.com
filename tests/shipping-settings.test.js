const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  computeShippingFee,
  normalizeShippingSettings,
  createShippingSettingsStore,
} = require("../lib/shipping-settings");
const { buildAkakceXml, resolveAkakceShipPrice } = require("../lib/akakce");
const { spawnTestServer } = require("./helpers/spawn-server");

async function adminHeaders(baseUrl, password) {
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  return {
    Authorization: "Bearer " + session.token,
    "Content-Type": "application/json",
  };
}

test("computeShippingFee applies flat fee below threshold and free above", () => {
  const settings = normalizeShippingSettings({ freeShippingThreshold: 500, shippingFee: 149 });
  assert.equal(computeShippingFee(499.99, settings), 149);
  assert.equal(computeShippingFee(500, settings), 0);
  assert.equal(computeShippingFee(1200, settings), 0);
});

test("computeShippingFee returns zero when shipping fee unset", () => {
  assert.equal(computeShippingFee(1000, normalizeShippingSettings({})), 0);
});

test("shipping settings store persists admin values", () => {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "patygo-ship-"));
  const store = createShippingSettingsStore(root);
  const saved = store.setSettings({ freeShippingThreshold: 3000, shippingFee: 99 });
  assert.equal(saved.freeShippingThreshold, 3000);
  assert.equal(saved.shippingFee, 99);
  assert.equal(store.getPublic().enabled, true);
});

test("resolveAkakceShipPrice uses panel shipping rules per product gross price", () => {
  const shippingSettings = { freeShippingThreshold: 5000, shippingFee: 149 };
  const cheap = { price: 100, vatPercent: 20 };
  const expensive = { price: 5000, vatPercent: 20 };
  assert.equal(resolveAkakceShipPrice(cheap, { shippingSettings }), 149);
  assert.equal(resolveAkakceShipPrice(expensive, { shippingSettings }), 0);
});

test("Akakce XML shipPrice reflects shipping settings on eligible products", () => {
  const product = {
    id: "akakce-ship-1",
    supplierSku: "AK-SHIP-1",
    name: "Kargo Test Notebook",
    brand: "Patygo",
    category: "bilgisayar-tablet",
    siteParent: "bilgisayar-tablet",
    siteMid: "tasinabilir-bilgisayarlar",
    siteChild: "notebooklar",
    description: "Test",
    price: 100,
    image: "https://patygoteknoloji.com/assets/img/products/macbook-air-m3.svg",
    stockQty: 2,
    active: true,
    source: "manual",
    manufacturerCode: "AK-SHIP-1",
    barcode: "8690000000999",
    gtipCode: "84.71.30.00.00.00",
    mainCategory: "KİŞİSEL BİLGİSAYARLAR",
    midCategory: "Taşınabilir Bilgisayarlar",
    subCategory: "Notebooklar",
    vatPercent: 20,
    currency: "TRY",
    unit: "ADET",
    lastSuccessfulFetchAt: new Date().toISOString(),
  };
  const xml = buildAkakceXml([product], {
    siteBaseUrl: "https://patygoteknoloji.com",
    shippingSettings: { freeShippingThreshold: 5000, shippingFee: 75 },
    dayOfDelivery: 3,
  });
  assert.match(xml, /<price>120\.00<\/price>/);
  assert.match(xml, /<shipPrice>75\.00<\/shipPrice>/);
  assert.match(xml, /<dayOfDelivery>3<\/dayOfDelivery>/);
});

test("admin shipping API and payment total include kargo bedeli", async (t) => {
  const password = "test-admin-password";
  const { baseUrl, dataRoot } = await spawnTestServer(
    t,
    {
      ADMIN_PASSWORD: password,
      AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
      AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
      AKBANK_SECRET_KEY: "test-akbank-secret",
      AKBANK_TEST_MODE: "true",
    },
    {
      products: [
        {
          id: "ship-test-item",
          brand: "TEST",
          name: "Kargo Test Ürünü",
          price: 100,
          vatPercent: 20,
          category: "bilgisayar-tablet",
          siteParent: "bilgisayar-tablet",
          siteMid: "tasinabilir-bilgisayarlar",
          siteChild: "notebooklar",
          featured: false,
          active: true,
          image: "/assets/img/products/macbook-air-m3.svg",
          images: ["/assets/img/products/macbook-air-m3.svg"],
          stockQty: 5,
          barcode: "8690000000123",
          manufacturerCode: "SHIP-TEST",
          gtipCode: "84.71.30.00.00.00",
          mainCategory: "KİŞİSEL BİLGİSAYARLAR",
          midCategory: "Taşınabilir Bilgisayarlar",
          subCategory: "Notebooklar",
          currency: "TRY",
          unit: "ADET",
        },
      ],
    }
  );

  const headers = await adminHeaders(baseUrl, password);
  const put = await fetch(baseUrl + "/api/admin/shipping/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({ freeShippingThreshold: 5000, shippingFee: 75 }),
  });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.ok, true);
  assert.equal(putBody.settings.shippingFee, 75);

  const pub = await fetch(baseUrl + "/api/shipping");
  assert.equal(pub.status, 200);
  const pubBody = await pub.json();
  assert.equal(pubBody.shippingFee, 75);
  assert.equal(pubBody.enabled, true);

  const start = await fetch(baseUrl + "/api/payment/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ productId: "ship-test-item", qty: 1 }],
      customer: {
        name: "Kargo Test",
        email: "ship@example.com",
        phone: "05555555555",
        billingAddress: "Test Mah. No:1 İstanbul",
        shippingAddress: "Test Mah. No:1 İstanbul",
      },
      contractsAccepted: true,
      kvkkAccepted: true,
    }),
  });
  assert.equal(start.status, 200);
  const startBody = await start.json();
  assert.equal(startBody.ok, true);
  // 100 net + 20 KDV = 120 KDV dahil + 75 kargo
  assert.equal(Number(startBody.fields.amount), 195);

  const order = await fetch(
    baseUrl +
      "/api/payment/order?orderId=" +
      encodeURIComponent(startBody.orderId) +
      "&token=" +
      encodeURIComponent(startBody.orderAccessToken)
  );
  const orderBody = await order.json();
  assert.equal(orderBody.order.shippingFee, 75);
  assert.equal(orderBody.order.total, 195);

  const feed = await fetch(baseUrl + "/api/feeds/akakce.xml");
  assert.equal(feed.status, 200);
  const feedXml = await feed.text();
  assert.match(feedXml, /<shipPrice>75\.00<\/shipPrice>/);
});
