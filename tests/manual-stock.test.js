const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeAkakceProducts } = require("../lib/akakce");
const { mergeCatalogProducts } = require("../lib/catalog");
const { spawnTestServer } = require("./helpers/spawn-server");

const CATEGORY = { siteParent: "bilgisayar-tablet", siteMid: "tasinabilir-bilgisayarlar", siteChild: "notebooklar" };
const gallery = Array.from({ length: 5 }, (_, index) => `/assets/img/products/macbook-air-m3.svg?v=${index}`);

function manual(id, name, price, stockQty) {
  return Object.assign(
    {
      id,
      brand: "TEST",
      name,
      price,
      vatPercent: 20,
      category: "bilgisayar-tablet",
      stockQty,
      currency: "TRY",
      unit: "ADET",
      manufacturerCode: "MFG-" + id,
      barcode: "8690000000" + String(price).slice(0, 3),
      gtipCode: "84713000",
      mainCategory: "TEST ANA",
      midCategory: "TEST ARA",
      subCategory: "TEST ALT",
      description: "Manuel test ürünü kısa açıklama.",
      images: gallery,
      active: true,
    },
    CATEGORY
  );
}

test("manual product at zero stock is sold out and never reaches Akakçe; missing stock is not sold out", () => {
  const merged = mergeCatalogProducts(
    [manual("m-a", "Test A", 500, 0), manual("m-b", "Test B", 900, 3), Object.assign(manual("m-x", "Test X", 700, 1), { stockQty: undefined })],
    []
  );
  const byId = Object.fromEntries(merged.map((item) => [item.id, item]));
  assert.equal(byId["m-a"].soldOut, true);
  assert.equal(byId["m-b"].soldOut, undefined);
  assert.equal(byId["m-x"].soldOut, undefined, "stok bilgisi olmayan eski kayıt tükendi sayılmaz");
  const analysis = analyzeAkakceProducts([byId["m-a"]], { siteBaseUrl: "https://patygoteknoloji.com" });
  assert.equal(analysis.eligible.length, 0);
  assert.ok(analysis.excluded[0].reasons.includes("Stok yok"), "tükenen manuel ürün Akakçe'ye gitmez");
});

test("sold-out manual product stays last in its category; back in stock it leads the category", async (t) => {
  const password = "test-admin-password";
  const { baseUrl } = await spawnTestServer(
    t,
    {
      ADMIN_PASSWORD: password,
      AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
      AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
      AKBANK_SECRET_KEY: "test-akbank-secret",
      AKBANK_TEST_MODE: "true",
    },
    { products: [] }
  );
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const headers = { Authorization: "Bearer " + (await login.json()).token, "Content-Type": "application/json" };
  const save = async (stockA) => {
    const res = await fetch(baseUrl + "/api/admin/products", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        products: [manual("m-a", "Test A", 500, stockA), manual("m-b", "Test B", 900, 3), manual("m-c", "Test C", 800, 2)],
      }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()).products.find((item) => item.id === "m-a");
  };
  const listing = async (extra) => {
    const query = "kategori=bilgisayar-tablet&ara=tasinabilir-bilgisayarlar&alt=notebooklar" + (extra || "");
    const body = await (await fetch(baseUrl + "/api/products?" + query)).json();
    return body.products.map((item) => item.id);
  };

  const soldOutSaved = await save(0);
  assert.equal(soldOutSaved.restockedAt, undefined);
  assert.deepEqual(await listing(), ["m-b", "m-c", "m-a"], "tükenen manuel ürün kategoride en altta");
  assert.deepEqual(await listing("&sort=price-asc"), ["m-c", "m-b", "m-a"], "fiyat sıralamasında da en altta");
  const search = await (await fetch(baseUrl + "/api/products?q=Test")).json();
  assert.equal(search.products[search.products.length - 1].id, "m-a", "aramada da en sonda");

  const byIds = await (await fetch(baseUrl + "/api/products?ids=m-a,m-b")).json();
  assert.deepEqual(byIds.products.map((item) => item.id), ["m-b"], "sepet/favori tükenen ürünü çözmez");
  const single = await (await fetch(baseUrl + "/api/products?id=m-a")).json();
  assert.equal(single.products[0].soldOut, true);
  const urlPath = single.products[0].urlPath;
  assert.ok(urlPath);
  const html = await (await fetch(baseUrl + urlPath, { headers: { Accept: "text/html" } })).text();
  assert.match(html, /detail-soldout-label">Tükendi</);
  assert.match(html, /schema\.org\/OutOfStock/);
  const similar = await (await fetch(baseUrl + "/api/products/similar?id=m-b")).json();
  assert.ok(!similar.products.some((item) => item.id === "m-a"), "benzer ürünlerde tükenen yok");

  const alert = (body) =>
    fetch(baseUrl + "/api/price-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ email: "yeni@example.com", consent: true, productId: "m-a" }, body)),
    });
  assert.equal((await alert({ kind: "stock" })).status, 503, "stok talebi kabul edilir; yalnızca SMTP yok");
  assert.equal((await alert({ targetPrice: 100 })).status, 404, "tükenen ürüne fiyat alarmı kurulmaz");

  const start = await fetch(baseUrl + "/api/payment/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ productId: "m-a", qty: 1 }],
      customer: {
        name: "Test Musteri",
        email: "test@example.com",
        phone: "05555555555",
        billingAddress: "Mevlana Mah. Test Sk. No:1 Gaziosmanpaşa / İstanbul",
      },
      contractsAccepted: true,
      kvkkAccepted: true,
    }),
  });
  assert.notEqual(start.status, 200);
  assert.match((await start.json()).error, /Test A tükendi/, "tükenen manuel ürün ödemeye giremez");

  const restocked = await save(4);
  assert.ok(Number.isFinite(Date.parse(restocked.restockedAt)), "stoğa giriş zamanı sunucuda damgalanır");
  assert.deepEqual(await listing(), ["m-a", "m-b", "m-c"], "stoğa gelen manuel ürün kategoride ilk sırada");
  assert.deepEqual(await listing("&sort=price-asc"), ["m-a", "m-c", "m-b"], "seçilen sıralama korunur");
  const resaved = await save(4);
  assert.equal(resaved.restockedAt, restocked.restockedAt, "stok değişmeden kayıt öne alma zamanını yenilemez");
  assert.equal((await alert({ kind: "stock" })).status, 409, "stoktaki ürüne stok talebi açılmaz");

  const soldAgain = await save(0);
  assert.equal(soldAgain.restockedAt, undefined);
  assert.deepEqual(await listing(), ["m-b", "m-c", "m-a"]);
});
