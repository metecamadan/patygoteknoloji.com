const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  createHomeSliderStore,
  normalizeConfig,
  MAX_SLIDES,
  MAX_DEALS,
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

const SLIDER_PRODUCTS = [
  {
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
  },
  {
    id: "slider-test-item-2",
    brand: "Asus",
    name: "Slider Test Desktop",
    price: 20000,
    vatPercent: 20,
    category: "bilgisayar-tablet",
    siteParent: "bilgisayar-tablet",
    siteMid: "masaustu-bilgisayarlar",
    siteChild: "hazir-sistemler",
    featured: false,
    active: true,
    image: "/assets/img/products/macbook-air-m3.svg",
    images: ["/assets/img/products/macbook-air-m3.svg"],
    stockQty: 3,
    barcode: "8690000000457",
    manufacturerCode: "SLIDER-TEST-2",
    gtipCode: "84.71.30.00.00.00",
    mainCategory: "KİŞİSEL BİLGİSAYARLAR",
    midCategory: "Masaüstü Bilgisayarlar",
    subCategory: "Hazır Sistemler",
    currency: "TRY",
    unit: "ADET",
  },
];

test("home slider store caps campaigns and deals separately", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-hs-"));
  const store = createHomeSliderStore(root);
  const manySlides = Array.from({ length: MAX_SLIDES + 2 }, (_, i) => ({
    linkHref: "/k" + i,
    imageDesktop: "/img/" + i + ".jpg",
    active: true,
  }));
  const manyDeals = Array.from({ length: MAX_DEALS + 2 }, (_, i) => ({
    productId: "p" + i,
    eyebrow: "Etiket " + i,
    active: true,
  }));
  const saved = store.setConfig({ slides: manySlides, deals: manyDeals });
  assert.equal(saved.slides.length, MAX_SLIDES);
  assert.equal(saved.deals.length, MAX_DEALS);
  assert.equal(saved.deals[0].productId, "p0");
});

test("normalizeConfig migrates product slides into deals", () => {
  const cfg = normalizeConfig({
    slides: [
      {
        productId: "a",
        imageDesktop: "/a.jpg",
        linkHref: "/notebook",
        categoryName: "Notebook",
        eyebrow: "Notebook",
      },
      {
        productId: "b",
        imageDesktop: "/b.jpg",
        linkHref: "/kampanya",
      },
    ],
  });
  assert.equal(cfg.slides.length, 2);
  assert.equal(cfg.deals.length, 2);
  assert.equal(cfg.deals[0].productId, "a");
  assert.equal(cfg.deals[1].productId, "b");
  assert.equal(cfg.slides[0].productId, "");
});

test("normalizeConfig keeps explicit deals and drops incomplete campaigns", () => {
  const cfg = normalizeConfig({
    slides: [
      { imageDesktop: "/a.jpg", linkHref: "/ok" },
      { imageDesktop: "/b.jpg" },
    ],
    deals: [
      { productId: "x", categoryName: "X" },
      { productId: "" },
    ],
  });
  assert.equal(cfg.slides.length, 1);
  assert.equal(cfg.deals.length, 1);
  assert.equal(cfg.deals[0].productId, "x");
});

test("public API returns separate slides and deals; deal auto uses products", async (t) => {
  const password = "test-admin-password";
  const { baseUrl } = await spawnTestServer(
    t,
    { ADMIN_PASSWORD: password },
    { products: SLIDER_PRODUCTS }
  );

  const headers = await adminHeaders(baseUrl, password);
  const put = await fetch(baseUrl + "/api/admin/home-slider", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      slides: [
        {
          linkHref: "/notebook",
          imageDesktop: "/assets/img/home-slider/desk-test.webp",
          imageMobile: "/assets/img/home-slider/mob-test.webp",
          eyebrow: "Notebooklar",
          tone: "blue",
          active: true,
        },
      ],
      deals: [
        {
          productId: "slider-test-item",
          categoryName: "Notebooklar",
          eyebrow: "Notebooklar",
          active: true,
        },
        {
          productId: "slider-test-item-2",
          categoryName: "Hazır Sistemler",
          eyebrow: "Hazır Sistemler",
          active: true,
        },
        {
          productId: "missing-xyz",
          eyebrow: "Yok",
          active: true,
        },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.slides.length, 1);
  assert.equal(putBody.deals.length, 3);
  assert.ok(putBody.deals[0].product);

  const pub = await fetch(baseUrl + "/api/home-slider");
  const pubBody = await pub.json();
  assert.equal(pubBody.ok, true);
  assert.equal(pubBody.slides.length, 1);
  assert.equal(pubBody.deals.length, 2);
  assert.equal(pubBody.deals[0].productId, "slider-test-item");
  assert.equal(pubBody.deals[1].productId, "slider-test-item-2");
  assert.ok(pubBody.deals[0].productUrlPath);
  assert.ok(pubBody.deals[0].priceIncl > 0);
  assert.equal(pubBody.slides[0].urlPath, "/notebook");
});

test("home-slider storefront: independent deals + 5s autoplay + pixel carousel", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "home-slider.js"), "utf8");
  assert.match(js, /DEAL_AUTO_MS\s*=\s*5000/);
  assert.match(js, /productUrlPath/);
  assert.match(js, /translateX\(-" \+ index \* w/);
  assert.match(js, /mountDuo\(lists\.slides,\s*lists\.deals\)/);
});

test("admin panel: separate campaign and deal lists max 4 deals", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "admin-panel.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
  assert.match(html, /id="homeDealList"/);
  assert.match(html, /id="homeDealAddBtn"/);
  assert.match(html, /id="homeDealAddSearch"/);
  assert.match(js, /homeDealMax/);
  assert.match(js, /appendHomeDealProduct/);
  assert.match(js, /collectHomeDealDraft/);
  assert.match(js, /deals:\s*homeDealDraft/);
  assert.match(js, /Kaydedildi:/);
  assert.match(js, /Listeye eklendi/);
});
