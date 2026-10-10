const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { analyzeAkakceProducts } = require("../lib/akakce");
const { mergeCatalogProducts } = require("../lib/catalog");
const { hmacSha512Base64 } = require("../lib/akbank-pos");
const { resetDbForTests } = require("../lib/db");
const { createManualStock, findStockShortage, reversalReturnQty } = require("../lib/manual-stock");
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

function reversal(items, amount) {
  return { kind: "bank_reversal", success: true, amount, items };
}

test("manual stock ledger: a sale moves stock once, refunds return only what that order took", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-manual-stock-"));
  t.after(() => {
    resetDbForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let products = [
    { id: "m-a", name: "Test A", stockQty: 3 },
    { id: "m-b", name: "Test B", stockQty: 1 },
    { id: "m-x", name: "Test X" },
  ];
  let saves = 0;
  const stock = createManualStock(root, {
    loadProducts: () => products.map((p) => Object.assign({}, p)),
    saveProducts: (list) => {
      saves += 1;
      products = list;
    },
    stampRestock: (next, previous, nowIso) =>
      Object.assign(next, { restockedAt: previous.stockQty <= 0 && next.stockQty > 0 ? nowIso : undefined }),
  });
  const qty = (id) => products.find((p) => p.id === id).stockQty;

  const order = {
    id: "PTY-1",
    items: [
      { productId: "m-a", qty: 2 },
      { productId: "m-b", qty: 2 },
      { productId: "m-x", qty: 1 },
      { productId: "supplier-1", qty: 1 },
    ],
  };
  const sold = stock.recordSale(order);
  assert.deepEqual(sold.map((c) => [c.productId, c.before, c.after, c.shortBy]), [
    ["m-a", 3, 1, 0],
    ["m-b", 1, 0, 1],
  ]);
  assert.equal(qty("m-a"), 1);
  assert.equal(qty("m-b"), 0, "stok sıfırın altına inmez");
  assert.equal(products.find((p) => p.id === "m-x").stockQty, undefined, "stok bilgisi olmayan ürün takip edilmez");
  assert.deepEqual(stock.recordSale(order), [], "aynı sipariş ikinci kez stok düşmez");
  assert.equal(saves, 1);

  const paid = Object.assign({}, order, { paymentStatus: "paid", paymentEvents: [] });
  const partial = Object.assign({}, paid, { paymentEvents: [reversal([{ index: 0, qty: 1 }], 100)] });
  assert.deepEqual([...reversalReturnQty(paid, partial)], [["m-a", 1]]);
  stock.recordReturn(paid, partial, "refund:1");
  assert.equal(qty("m-a"), 2, "kalem iadesi yalnızca iade edilen adedi geri ekler");
  stock.recordReturn(paid, partial, "refund:1");
  assert.equal(qty("m-a"), 2, "aynı iade olayı iki kez eklemez");

  const amountOnly = Object.assign({}, partial, {
    paymentEvents: partial.paymentEvents.concat(reversal(undefined, 50)),
  });
  assert.equal(reversalReturnQty(partial, amountOnly).size, 0, "yalnızca tutar iadesi stoğa dokunmaz");

  const full = Object.assign({}, amountOnly, {
    paymentStatus: "refunded",
    paymentEvents: amountOnly.paymentEvents.concat(reversal(undefined, 900)),
  });
  const returned = stock.recordReturn(amountOnly, full, "refund:2");
  assert.deepEqual(returned.map((c) => [c.productId, c.qty]), [
    ["m-a", 1],
    ["m-b", 1],
  ]);
  assert.equal(qty("m-a"), 3, "tam iadede kalan adet geri gelir");
  assert.equal(qty("m-b"), 1, "fazla satılan siparişte yalnızca gerçekten düşülen adet geri gelir");
  assert.ok(products.find((p) => p.id === "m-b").restockedAt, "sıfırdan stoğa dönen ürün öne alınır");
  assert.deepEqual(stock.recordReturn(full, full, "refund:3"), [], "tamamı iade edilmiş sipariş tekrar eklemez");

  const legacy = { id: "PTY-OLD", paymentStatus: "paid", items: [{ productId: "m-a", qty: 1 }] };
  const legacyRefunded = Object.assign({}, legacy, { paymentStatus: "refunded", paymentEvents: [reversal(undefined, 100)] });
  assert.deepEqual(stock.recordReturn(legacy, legacyRefunded, "refund:old"), [], "takip başlamadan satılan sipariş stoğa eklenmez");
  assert.equal(qty("m-a"), 3);
});

test("checkout stock gate sums quantities per manual product", () => {
  const manuals = [{ id: "m-a", name: "Test A", stockQty: 2 }, { id: "m-x", name: "Test X" }];
  assert.equal(findStockShortage([{ productId: "m-a", qty: 2 }, { productId: "m-x", qty: 50 }], manuals), null);
  assert.deepEqual(findStockShortage([{ productId: "m-a", qty: 1 }, { productId: "m-a", qty: 2 }], manuals), {
    productId: "m-a",
    name: "Test A",
    requested: 3,
    available: 2,
  });
});

test("manual product stock: checkout is capped at stock, a paid order takes units once, an open panel keeps sales", async (t) => {
  const password = "test-admin-password";
  const secret = "test-akbank-secret";
  const { baseUrl } = await spawnTestServer(
    t,
    {
      ADMIN_PASSWORD: password,
      AKBANK_MERCHANT_SAFE_ID: "merchant-safe",
      AKBANK_TERMINAL_SAFE_ID: "terminal-safe",
      AKBANK_SECRET_KEY: secret,
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
  const put = async (products) => {
    const res = await fetch(baseUrl + "/api/admin/products", { method: "PUT", headers, body: JSON.stringify({ products }) });
    assert.equal(res.status, 200, await res.clone().text());
  };
  const stockOf = async (id) => {
    const body = await (await fetch(baseUrl + "/api/admin/products", { headers })).json();
    return body.products.find((item) => item.id === id).stockQty;
  };
  await put([manual("m-s", "Stok Test", 500, 3)]);

  const start = (qty) =>
    fetch(baseUrl + "/api/payment/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ productId: "m-s", qty }],
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
  const tooMany = await start(4);
  assert.equal(tooMany.status, 422);
  assert.match((await tooMany.json()).error, /Stok Test: stokta yalnızca 3 adet var/);

  const started = await (await start(2)).json();
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(await stockOf("m-s"), 3, "ödeme başlatmak stoğu düşürmez");
  const callback = () => {
    const payload = {
      orderId: started.orderId,
      responseCode: "VPS-0000",
      responseMessage: "Success",
      amount: started.fields.amount,
      hashParams: "orderId+responseCode+amount",
    };
    payload.hash = hmacSha512Base64(payload.orderId + payload.responseCode + payload.amount, secret);
    return fetch(baseUrl + "/api/payment/callback", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload).toString(),
      redirect: "manual",
    });
  };
  assert.match((await callback()).headers.get("location") || "", /payment=success/);
  await callback();
  assert.equal(await stockOf("m-s"), 1, "ödeme onayında bir kez düşer; tekrarlanan banka cevabı düşmez");

  await put([Object.assign(manual("m-s", "Stok Test", 550, 3), { stockQtyLoaded: 3 })]);
  assert.equal(await stockOf("m-s"), 1, "panelde stok alanına dokunulmadan yapılan kayıt satışı geri almaz");
  await put([Object.assign(manual("m-s", "Stok Test", 550, 10), { stockQtyLoaded: 3 })]);
  assert.equal(await stockOf("m-s"), 10, "panelde stok değiştirilirse yazılan sayı geçerli olur");
});

test("refunds return manual stock and the panel sends the stock it loaded", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /if \(updated && event && event\.success\) \{\s*recordManualStockMoves\(updated\.id, "refund"/);
  const panel = fs.readFileSync(path.join(root, "assets", "js", "admin-panel.js"), "utf8");
  assert.match(panel, /stockQtyLoaded: loadedStockById\.get\(String\(p\.id\)\)/);
});
