const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  createHomeSliderStore,
  normalizeConfig,
  MAX_SLIDES,
} = require("../lib/home-slider");
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

const SLIDER_PRODUCT = {
  id: "slider-test-item",
  brand: "Lenovo",
  name: "Slider Test Notebook",
  price: 10000,
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
  barcode: "8690000000456",
  manufacturerCode: "SLIDER-TEST",
  gtipCode: "84.71.30.00.00.00",
  mainCategory: "KİŞİSEL BİLGİSAYARLAR",
  midCategory: "Taşınabilir Bilgisayarlar",
  subCategory: "Notebooklar",
  currency: "TRY",
  unit: "ADET",
};

test("home slider store normalizes and caps slides", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-hs-"));
  const store = createHomeSliderStore(root);
  const many = Array.from({ length: MAX_SLIDES + 3 }, (_, i) => ({
    productId: "p" + i,
    eyebrow: "Etiket " + i,
    tone: i % 2 ? "teal" : "navy",
    active: true,
  }));
  const saved = store.setConfig({ slides: many });
  assert.equal(saved.slides.length, MAX_SLIDES);
  assert.equal(saved.slides[0].productId, "p0");
  assert.equal(saved.slides[0].sort, 0);
  assert.ok(saved.updatedAt);
  assert.equal(store.getConfig().slides.length, MAX_SLIDES);
});

test("normalizeConfig drops slides without productId and defaults tone", () => {
  const cfg = normalizeConfig({
    slides: [
      { productId: "a", tone: "nope", active: false },
      { productId: "", eyebrow: "x" },
      { productId: "b" },
    ],
  });
  assert.equal(cfg.slides.length, 2);
  assert.equal(cfg.slides[0].tone, "navy");
  assert.equal(cfg.slides[0].active, false);
  assert.equal(cfg.slides[1].productId, "b");
  assert.equal(cfg.slides[1].active, true);
});

test("public home-slider empty by default; admin save enriches live product", async (t) => {
  const password = "test-admin-password";
  const { baseUrl } = await spawnTestServer(
    t,
    { ADMIN_PASSWORD: password },
    { products: [SLIDER_PRODUCT] }
  );

  const pub = await fetch(baseUrl + "/api/home-slider");
  assert.equal(pub.status, 200);
  const pubBody = await pub.json();
  assert.equal(pubBody.ok, true);
  assert.deepEqual(pubBody.slides, []);

  const headers = await adminHeaders(baseUrl, password);
  const put = await fetch(baseUrl + "/api/admin/home-slider", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      slides: [
        {
          productId: "slider-test-item",
          eyebrow: "Notebook fırsatları",
          tone: "blue",
          titleOverride: "Test başlık",
          active: true,
        },
        {
          productId: "missing-product-xyz",
          eyebrow: "Yok",
          active: true,
        },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.ok, true);
  assert.equal(putBody.slides.length, 2);

  const pub2 = await fetch(baseUrl + "/api/home-slider");
  const pub2Body = await pub2.json();
  assert.equal(pub2Body.slides.length, 1);
  assert.equal(pub2Body.slides[0].productId, "slider-test-item");
  assert.equal(pub2Body.slides[0].eyebrow, "Notebook fırsatları");
  assert.equal(pub2Body.slides[0].tone, "blue");
  assert.equal(pub2Body.slides[0].name, "Test başlık");
  assert.ok(pub2Body.slides[0].image);
  assert.ok(pub2Body.slides[0].urlPath);
  assert.ok(pub2Body.slides[0].priceIncl > 0);
});
