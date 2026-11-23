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
    categoryKey: "cat/" + i,
    categoryName: "Kategori " + i,
    eyebrow: "Etiket " + i,
    linkHref: "/kategori-" + i,
    imageDesktop: "/assets/img/home-slider/d" + i + ".jpg",
    tone: i % 2 ? "teal" : "navy",
    active: true,
  }));
  const saved = store.setConfig({ slides: many });
  assert.equal(saved.slides.length, MAX_SLIDES);
  assert.equal(saved.slides[0].productId, "p0");
  assert.equal(saved.slides[0].linkHref, "/kategori-0");
  assert.equal(saved.slides[0].sort, 0);
  assert.ok(saved.updatedAt);
  assert.equal(store.getConfig().slides.length, MAX_SLIDES);
});

test("normalizeConfig requires productId + image + linkHref", () => {
  const cfg = normalizeConfig({
    slides: [
      {
        productId: "a",
        imageDesktop: "/a.jpg",
        linkHref: "/notebook",
        tone: "nope",
        active: false,
        categoryName: "Notebook",
      },
      { productId: "only-product", eyebrow: "x" },
      {
        imageDesktop: "/b.jpg",
        linkHref: "kampanya",
        categoryKey: "bilgisayar-tablet",
      },
      {
        productId: "b",
        imageDesktop: "/c.jpg",
        linkHref: "kampanya-2",
      },
    ],
  });
  assert.equal(cfg.slides.length, 2);
  assert.equal(cfg.slides[0].tone, "navy");
  assert.equal(cfg.slides[0].active, false);
  assert.equal(cfg.slides[0].eyebrow, "Notebook");
  assert.equal(cfg.slides[1].productId, "b");
  assert.equal(cfg.slides[1].linkHref, "/kampanya-2");
  assert.equal(cfg.slides[1].active, true);
});

test("normalizeSlide maps legacy imageOverride to imageDesktop and keeps imageMobile", () => {
  const cfg = normalizeConfig({
    slides: [
      {
        productId: "legacy",
        linkHref: "/eski",
        imageOverride: "/assets/img/home-slider/old-desk.jpg",
        imageMobile: "/assets/img/home-slider/old-mob.jpg",
      },
      {
        productId: "new",
        linkHref: "/yeni",
        imageDesktop: "/assets/img/home-slider/desk.jpg",
        imageMobile: "",
      },
    ],
  });
  assert.equal(cfg.slides[0].imageDesktop, "/assets/img/home-slider/old-desk.jpg");
  assert.equal(cfg.slides[0].imageOverride, "/assets/img/home-slider/old-desk.jpg");
  assert.equal(cfg.slides[0].imageMobile, "/assets/img/home-slider/old-mob.jpg");
  assert.equal(cfg.slides[1].imageDesktop, "/assets/img/home-slider/desk.jpg");
  assert.equal(cfg.slides[1].imageMobile, "");
});

test("public home-slider needs in-stock product + image + link; deal uses product url", async (t) => {
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
  const adminGet = await fetch(baseUrl + "/api/admin/home-slider", { headers });
  assert.equal(adminGet.status, 200);
  const adminBody = await adminGet.json();
  assert.ok(Array.isArray(adminBody.categories));
  assert.ok(adminBody.categories.length > 0);

  const put = await fetch(baseUrl + "/api/admin/home-slider", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      slides: [
        {
          productId: "slider-test-item",
          categoryKey: "bilgisayar-tablet/tasinabilir-bilgisayarlar/notebooklar",
          categoryName: "Notebooklar",
          eyebrow: "Notebooklar",
          titleOverride: "Test başlık",
          linkHref: "/bilgisayar-tablet/tasinabilir-bilgisayarlar/notebooklar",
          imageDesktop: "/assets/img/home-slider/desk-test.webp",
          imageMobile: "/assets/img/home-slider/mob-test.webp",
          tone: "blue",
          active: true,
        },
        {
          productId: "missing-product-xyz",
          linkHref: "/yok",
          imageDesktop: "/assets/img/home-slider/gone.webp",
          eyebrow: "Yok",
          active: true,
        },
        {
          categoryName: "Ürünsüz",
          linkHref: "/kampanya",
          imageDesktop: "/assets/img/home-slider/no-product.webp",
          active: true,
        },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.ok, true);
  assert.equal(putBody.slides.length, 2);
  assert.ok(putBody.slides[0].product);
  assert.match(String(putBody.slides[0].product.name || ""), /Slider Test Notebook/);

  const pub2 = await fetch(baseUrl + "/api/home-slider");
  const pub2Body = await pub2.json();
  assert.equal(pub2Body.slides.length, 1);
  const slide = pub2Body.slides[0];
  assert.equal(slide.productId, "slider-test-item");
  assert.equal(slide.eyebrow, "Notebooklar");
  assert.equal(slide.tone, "blue");
  assert.equal(slide.name, "Test başlık");
  assert.equal(slide.imageDesktop, "/assets/img/home-slider/desk-test.webp");
  assert.equal(slide.imageMobile, "/assets/img/home-slider/mob-test.webp");
  assert.equal(slide.urlPath, "/bilgisayar-tablet/tasinabilir-bilgisayarlar/notebooklar");
  assert.ok(slide.productUrlPath);
  assert.ok(slide.priceIncl > 0);
  assert.ok(slide.productImage);
  assert.equal(slide.campaignOnly, false);
});

test("home-slider storefront uses picture and product deal link", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "home-slider.js"), "utf8");
  assert.match(js, /<picture>/);
  assert.match(js, /max-width:\s*900px/);
  assert.match(js, /imageDesktop/);
  assert.match(js, /imageMobile/);
  assert.match(js, /productUrlPath/);
  assert.match(js, /Ürüne git/);
});

test("admin panel home-slider UX: fırsat ürünü + kategori + linkHref + kaydet", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "admin-panel.js"), "utf8");
  assert.match(js, /data-field="categoryKey"/);
  assert.match(js, /data-field="linkHref"/);
  assert.match(js, /data-field="productSearch"/);
  assert.match(js, /Fırsat ürünü/);
  assert.match(js, /data-eyebrow-preview/);
  assert.match(js, /Kaydedildi:/);
});
