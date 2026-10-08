const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { decideAlert, createPriceAlertStore, MAX_ACTIVE_PER_EMAIL } = require("../lib/price-alerts");
const { buildReceivedMail, buildNotifyMail } = require("../lib/price-alert-mail");
const { getDb, resetDbForTests } = require("../lib/db");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const DAY = 86400000;

test("decideAlert: price alerts mail only on a 2% drop; stock alerts mail when back on sale", () => {
  const active = { kind: "price", basePrice: 1000, available: true };
  assert.deepEqual(decideAlert(active, { priceIncl: 980 }), { kind: "drop", basePrice: 980, available: true });
  assert.deepEqual(decideAlert(active, { priceIncl: 985 }), { kind: null, basePrice: 1000, available: true });
  assert.deepEqual(decideAlert(active, { priceIncl: 1100 }), { kind: null, basePrice: 1000, available: true });
  assert.deepEqual(decideAlert(active, null), { kind: null, basePrice: 1000, available: false });
  const gone = { kind: "price", basePrice: 1000, available: false };
  assert.deepEqual(
    decideAlert(gone, { priceIncl: 1050 }),
    { kind: null, basePrice: 1000, available: true },
    "fiyat alarmı yeniden satışa girişte mail atmaz"
  );
  assert.deepEqual(decideAlert(gone, { priceIncl: 900 }), { kind: "drop", basePrice: 900, available: true });
  assert.deepEqual(decideAlert({ basePrice: 1000, available: false }, { priceIncl: 1050 }).kind, null, "eski satırlar fiyat alarmıdır");

  const waiting = { kind: "stock", basePrice: 1000, available: false };
  assert.deepEqual(decideAlert(waiting, null), { kind: null, basePrice: 1000, available: false });
  assert.deepEqual(decideAlert(waiting, { priceIncl: 1100 }), { kind: "back", basePrice: 1100, available: true });
});

test("price alert store: active on request, per-address cap, retry until mailed, purge", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-alert-"));
  resetDbForTests();
  let clock = Date.parse("2026-10-04T09:00:00Z");
  const db = getDb(dir);
  const store = createPriceAlertStore(db, { now: () => clock });

  const first = store.subscribe({ email: " Ali@Example.com ", productId: "p1", productName: "Laptop", price: 1000 });
  assert.equal(first.state, "created");
  assert.equal(first.alert.email, "ali@example.com");
  assert.equal(first.alert.status, "active", "talep onay beklemeden başlar");
  assert.ok(first.alert.confirmedAt);
  assert.match(first.alert.token, /^[a-f0-9]{48}$/);
  assert.equal(store.subscribe({ email: "ali@example.com", productId: "p1", price: 990 }).state, "active");
  assert.equal(store.get(first.alert.token).basePrice, 1000, "tekrar talep taban fiyatı değiştirmez");
  assert.equal(first.alert.kind, "price", "tür verilmezse fiyat alarmı");
  assert.deepEqual(store.summary(), { pending: 0, active: 1, notified: 0 });

  db.prepare(
    "INSERT INTO price_alerts (token, email, product_id, base_price, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)"
  ).run("b".repeat(48), "eski-onay@example.com", "p1", 1200, new Date(clock).toISOString());
  const legacy = store.subscribe({ email: "eski-onay@example.com", productId: "p1", productName: "Laptop", price: 1000 });
  assert.equal(legacy.state, "created", "eski onay bekleyen talep yeniden istenince başlar");
  assert.equal(legacy.alert.status, "active");
  assert.equal(legacy.alert.basePrice, 1000);
  assert.equal(store.unsubscribe(legacy.alert.token).email, "eski-onay@example.com");

  let product = { priceIncl: 950, name: "Laptop", urlPath: "/bilgisayar/laptop" };
  let due = store.evaluate(() => product);
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "drop");
  assert.equal(due[0].previousPrice, 1000);
  assert.equal(store.evaluate(() => product).length, 1, "gönderilmeyen bildirim bir sonraki turda tekrar denenir");
  store.markNotified(due[0]);
  assert.equal(store.evaluate(() => product).length, 0);
  assert.equal(store.get(first.alert.token).basePrice, 950);
  assert.equal(store.get(first.alert.token).notifyCount, 1);

  assert.equal(store.evaluate(() => null).length, 0);
  assert.equal(store.get(first.alert.token).available, false, "stoktan düşmesi kaydedilir");
  assert.equal(store.evaluate(() => product).length, 0, "fiyat alarmı stoğa dönüşte mail atmaz");
  assert.equal(store.get(first.alert.token).available, true);

  const stock = store.subscribe({ email: "veli@example.com", productId: "p9", productName: "Tükenen", price: 500, kind: "stock" });
  assert.equal(stock.alert.kind, "stock");
  assert.equal(stock.alert.available, false);
  const lookup = (live) => (id) => (id === "p9" ? live : product);
  assert.equal(store.evaluate(lookup(null)).length, 0, "stok yokken bekler");
  due = store.evaluate(lookup({ priceIncl: 520, name: "Tükenen", urlPath: "/x/tukenen" }));
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "back");
  store.markNotified(due[0]);
  assert.equal(store.get(stock.alert.token).status, "notified", "stok bildirimi tek seferliktir");
  assert.equal(store.evaluate(lookup({ priceIncl: 520 })).length, 0);
  assert.deepEqual(store.adminCounts(), { price: 1, stock: 0 });
  assert.deepEqual(
    store.adminList("stock").map((alert) => [alert.productId, alert.status, alert.notifyCount]),
    [["p9", "notified", 1]],
    "panel bildirilen talebi de gösterir"
  );
  const again = store.subscribe({ email: "veli@example.com", productId: "p9", price: 520, kind: "stock" });
  assert.equal(again.state, "created", "kapanan stok talebi yeniden açılabilir");
  assert.equal(store.get(stock.alert.token).status, "active");
  assert.equal(store.get(stock.alert.token).notifyCount, 0);
  const switched = store.subscribe({ email: "veli@example.com", productId: "p9", price: 520, kind: "price" });
  assert.equal(switched.state, "created");
  assert.equal(switched.alert.kind, "price", "aynı ürün için tür değişebilir");
  assert.equal(store.remove(switched.alert.id).email, "veli@example.com");
  assert.equal(store.remove(switched.alert.id), null);

  for (let i = 0; i < MAX_ACTIVE_PER_EMAIL; i += 1) {
    store.subscribe({ email: "cok@example.com", productId: "x" + i, price: 10 });
  }
  assert.throws(
    () => store.subscribe({ email: "cok@example.com", productId: "fazla", price: 10 }),
    /en fazla 20 ürün/
  );

  db.prepare(
    "INSERT INTO price_alerts (token, email, product_id, base_price, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)"
  ).run("c".repeat(48), "eski@example.com", "p1", 10, new Date(clock).toISOString());
  clock += 8 * DAY;
  assert.equal(store.purge(), 1, "eski onay bekleyen talep 7 gün sonra silinir");
  assert.equal(store.get("c".repeat(48)), null);
  clock += 200 * DAY;
  assert.ok(store.purge() >= 21, "alarmlar 180 gün sonra silinir");

  const gone = store.subscribe({ email: "ali@example.com", productId: "p2", price: 10 });
  assert.equal(store.unsubscribe(gone.alert.token).productId, "p2");
  assert.equal(store.get(gone.alert.token), null);
  assert.equal(store.unsubscribe("yok"), null);
  resetDbForTests();
});

test("price alert mails: received notice without confirmation step, one-click cancel on the domain", () => {
  const alert = {
    id: 1,
    token: "a".repeat(48),
    email: "ali@example.com",
    productName: "Lenovo Laptop",
    basePrice: 1000,
  };
  const env = { SITE_BASE_URL: "http://127.0.0.1:5173" };
  const received = buildReceivedMail(alert, { env, productPath: "/bilgisayar/lenovo-laptop" });
  assert.equal(received.to, "ali@example.com");
  assert.equal(received.subject, "Fiyat alarmı talebinizi aldık");
  assert.match(received.text, /Lenovo Laptop — Şu anki fiyat: ₺1\.000,00/);
  assert.match(received.text, /Fiyatı düştüğünde sizi e-postayla bilgilendireceğiz\./);
  assert.doesNotMatch(received.text + received.html, /satışa girdiğinde|stoğa/, "fiyat alarmı maili yalnızca fiyatı anlatır");
  assert.match(
    received.html,
    /text-align:right;white-space:nowrap;"><a href="https:\/\/patygoteknoloji\.com\/bilgisayar\/lenovo-laptop"[^>]*>Ürüne git<\/a><\/td><\/tr><\/table>/,
    "Ürüne git butonu ürün kartının sağında"
  );
  assert.equal((received.html.match(/>Ürüne git</g) || []).length, 1, "kartın altında ikinci buton yok");
  assert.match(received.text, /https:\/\/patygoteknoloji\.com\/bilgisayar\/lenovo-laptop/);
  assert.match(received.text, /https:\/\/patygoteknoloji\.com\/api\/price-alerts\/unsubscribe\?token=a{48}/);
  assert.doesNotMatch(received.text + received.html, /onaylay|confirm\?token/i, "onay istenmez");
  assert.match(received.html, /alarmı iptal edin/);
  const productImg = /<img[^>]+width="80" height="80"/;
  assert.doesNotMatch(received.html, productImg, "görsel verilmezse yer tutucu yok");

  const withImage = buildReceivedMail(alert, {
    env,
    productPath: "/bilgisayar/lenovo-laptop",
    productImage: "/media/catalog/abc.jpg",
  });
  assert.match(
    withImage.html,
    /<img src="https:\/\/patygoteknoloji\.com\/media\/catalog\/abc\.jpg" width="80" height="80" alt="Lenovo Laptop"/,
    "kullanıcı hangi ürüne alarm kurduğunu görselden tanır"
  );
  assert.match(withImage.html, /Şu anki fiyat: ₺1\.000,00/);
  const supplierImage = buildReceivedMail(alert, { env, productImage: "https://www.bilgisayarim.com.tr/img/x.jpg" });
  assert.doesNotMatch(supplierImage.html, productImg, "tedarikçi sunucusundaki görsel maile konmaz");

  const notify = buildNotifyMail(
    {
      alert,
      product: {
        priceIncl: 900,
        name: "Lenovo Laptop",
        urlPath: "/bilgisayar/lenovo-laptop",
        image: "https://patygoteknoloji.com/media/catalog/abc.jpg",
      },
      kind: "drop",
      previousPrice: 1000,
    },
    { env }
  );
  assert.match(notify.html, /<img src="https:\/\/patygoteknoloji\.com\/media\/catalog\/abc\.jpg"/);
  assert.equal(notify.subject, "Lenovo Laptop fiyatı düştü");
  assert.match(notify.text, /₺1\.000,00 → ₺900,00/);
  assert.match(notify.text, /https:\/\/patygoteknoloji\.com\/bilgisayar\/lenovo-laptop/);
  assert.match(notify.html, /api\/price-alerts\/unsubscribe\?token=a{48}/);
  const stockAlert = Object.assign({}, alert, { kind: "stock" });
  const stockReceived = buildReceivedMail(stockAlert, {
    env,
    productPath: "/bilgisayar/lenovo-laptop",
    productImage: "/media/catalog/abc.jpg",
  });
  assert.equal(stockReceived.subject, "Stok bildirimi talebinizi aldık");
  assert.match(stockReceived.html, /Şu anda tükendi/);
  assert.match(stockReceived.text, /yeniden stoğa girdiğinde sizi bir kez e-postayla bilgilendireceğiz/);
  assert.doesNotMatch(stockReceived.text, /Şu anki fiyat|Fiyatı düştüğünde/);
  assert.match(stockReceived.html, /talebi iptal edin/);
  assert.match(stockReceived.html, /<img src="https:\/\/patygoteknoloji\.com\/media\/catalog\/abc\.jpg"/);

  const back = buildNotifyMail(
    { alert: stockAlert, product: { priceIncl: 1000, name: "Lenovo Laptop", urlPath: "/x" }, kind: "back", previousPrice: 1000 },
    { env }
  );
  assert.equal(back.subject, "Lenovo Laptop yeniden stokta");
  assert.match(back.text, /Takip ettiğiniz ürün yeniden stokta\. Güncel fiyat: ₺1\.000,00\./);
  assert.match(back.text, /tek seferliktir; stok talebiniz kapatıldı/);
  assert.doesNotMatch(back.html, /unsubscribe/, "tek seferlik bildirimde durdurma bağlantısı gerekmez");
});

test("product page offers the alert form with consent; KVKK lists purpose and retention", () => {
  const detail = read("assets/js/urun-detay.js");
  const main = read("assets/js/main.js");
  const kvkk = read("kvkk.html");
  assert.match(detail, /buyRow\.appendChild\(buildPriceAlert\(product, "price"\)\)/);
  assert.match(detail, /stockRow\.appendChild\(buildPriceAlert\(product, "stock"\)\)/, "tükenen üründe stok formu");
  assert.match(detail, /fetch\("\/api\/price-alerts"/);
  assert.match(detail, /consent: true, kind: alertKind/);
  assert.match(detail, /name="consent" required/);
  assert.match(detail, /form\.replaceWith\(done\)/, "talep alınınca form kapanır");
  assert.match(detail, /"Talebinizi aldık\. Fiyatı düştüğünde sizi e-postayla bilgilendireceğiz\."/);
  assert.match(detail, /"Talebinizi aldık\. Ürün yeniden stoğa girdiğinde sizi e-postayla bilgilendireceğiz\."/);
  assert.match(detail, /summary: "Stoğa gelince haber ver"/);
  assert.match(detail, /setRobotsNoindex\(soldOut\)/);
  assert.match(detail, /price\.textContent = "Tükendi"/);
  assert.doesNotMatch(detail, /Onay e-postası gönderdik/);
  assert.match(main, /alarmParams\.get\("alarm"\)/);
  assert.match(kvkk, /\(stok bildirimi\) e-posta gönderilmesi \(açık rızanıza dayanır/);
  assert.match(kvkk, /Fiyat alarmı \/ stok bildirimi \(e-posta, takip edilen ürün\)<\/td><td>En fazla 180 gün veya iptale kadar/);
  assert.doesNotMatch(kvkk, /e-posta onayınızla/);
});

test("price alert API removes the alert again when the received mail cannot be sent", async (t) => {
  const net = require("node:net");
  const closedPort = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const { baseUrl, dataRoot, stop } = await spawnTestServer(
    t,
    { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(closedPort), SMTP_USER: "u@example.com", SMTP_PASS: "x", SMTP_SECURE: "false" },
    {
      products: [
        {
          id: "alert-mail-fail",
          brand: "TEST",
          name: "Alarm Mail Ürünü",
          price: 1000,
          vatPercent: 20,
          category: "bilgisayar-tablet",
          siteParent: "bilgisayar-tablet",
          siteMid: "tasinabilir-bilgisayarlar",
          siteChild: "notebooklar",
          active: true,
          image: "/assets/img/products/macbook-air-m3.svg",
          images: ["/assets/img/products/macbook-air-m3.svg"],
          stockQty: 5,
          currency: "TRY",
          unit: "ADET",
        },
      ],
    }
  );
  const res = await fetch(baseUrl + "/api/price-alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: "alert-mail-fail", email: "ali@example.com", consent: true }),
  });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Bilgilendirme e-postası gönderilemedi/);
  await stop();
  resetDbForTests();
  assert.deepEqual(createPriceAlertStore(getDb(dataRoot)).summary(), { pending: 0, active: 0, notified: 0 }, "maili gitmeyen alarm açık kalmaz");
  resetDbForTests();
});

test("legacy price_alerts table without kind column is migrated in place", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-alert-legacy-"));
  resetDbForTests();
  const db = getDb(dir);
  db.exec(`CREATE TABLE price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
    product_id TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT '', base_price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', available INTEGER NOT NULL DEFAULT 1,
    notify_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, confirmed_at TEXT,
    last_notified_at TEXT, UNIQUE (email, product_id))`);
  db.prepare(
    "INSERT INTO price_alerts (token, email, product_id, base_price, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)"
  ).run("d".repeat(48), "eski@example.com", "p1", 100, new Date().toISOString());
  const store = createPriceAlertStore(db);
  assert.equal(store.get("d".repeat(48)).kind, "price");
  assert.equal(store.subscribe({ email: "yeni@example.com", productId: "p2", price: 10, kind: "stock" }).alert.kind, "stock");
  resetDbForTests();
});

test("sold-out product keeps a noindex page with a stock alert form; panel lists requests by product", async (t) => {
  const { writeCachedRates } = require("../lib/fx");
  const password = "test-admin-password";
  const { baseUrl, dataRoot } = await spawnTestServer(
    t,
    { ADMIN_PASSWORD: password, SUPPLIER_ALLOWED_HOSTS: "supplier.example" },
    {
      seed: (root) => {
        const store = createPriceAlertStore(getDb(root));
        store.subscribe({ email: "ali@example.com", productId: "sup-cpu-2", productName: "Intel Core CPU-2", price: 3220, kind: "stock" });
        store.subscribe({ email: "veli@example.com", productId: "sup-cpu-2", price: 3220, kind: "stock" });
        store.subscribe({ email: "ali@example.com", productId: "sup-cpu-1", price: 3220 });
      },
    }
  );
  const runtime = path.join(dataRoot, ".runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const cpu = (sku, stockQty) => ({
    supplierSku: sku,
    id: "sup-" + sku.toLowerCase(),
    name: "Intel Core " + sku,
    brand: "INTEL",
    costPrice: 70,
    stockQty,
    image: "https://cdn.example/" + sku + ".jpg",
    barcode: "869000000000" + sku.slice(-1),
    manufacturerCode: "I3-" + sku,
    mainCategory: "OEM &amp; ÇEVRE BİRİMLERİ",
    midCategory: "İşlemciler",
    subCategory: "Intel İşlemciler",
    currency: "USD",
    vatPercent: 20,
    unit: "ADET",
    category: "bilgisayar",
  });
  fs.writeFileSync(path.join(runtime, "supplier-cache.json"), JSON.stringify([cpu("CPU-1", 4), cpu("CPU-2", 0)]));
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({ globalMarginPercent: 15, lastFetchStatus: "ok", lastSuccessfulFetchAt: new Date().toISOString(), itemCount: 2 })
  );
  writeCachedRates(dataRoot, { USD: 40, EUR: 46, fetchedAt: new Date().toISOString(), source: "test" });
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const headers = { Authorization: "Bearer " + (await login.json()).token, "Content-Type": "application/json" };
  const published = await fetch(baseUrl + "/api/admin/supplier/publish", {
    method: "POST",
    headers,
    body: JSON.stringify({ slotId: "supplier-1" }),
  });
  assert.equal(published.status, 200);

  const anon = await fetch(baseUrl + "/api/admin/price-alerts?kind=stock");
  assert.equal(anon.status, 401, "talep listesi yalnızca panelde");
  const stockList = await (await fetch(baseUrl + "/api/admin/price-alerts?kind=stock", { headers })).json();
  assert.deepEqual(stockList.counts, { price: 1, stock: 2 });
  assert.equal(stockList.products.length, 1);
  const soldOut = stockList.products[0];
  assert.equal(soldOut.productId, "sup-cpu-2");
  assert.equal(soldOut.state, "soldout");
  assert.ok(soldOut.urlPath);
  assert.deepEqual(soldOut.requests.map((r) => r.email).sort(), ["ali@example.com", "veli@example.com"]);
  const priceList = await (await fetch(baseUrl + "/api/admin/price-alerts?kind=price", { headers })).json();
  assert.equal(priceList.products[0].productId, "sup-cpu-1");
  assert.equal(priceList.products[0].state, "live");
  assert.ok(priceList.products[0].priceIncl > 0);

  const byPath = await (await fetch(baseUrl + "/api/products?path=" + encodeURIComponent(soldOut.urlPath.slice(1)))).json();
  assert.equal(byPath.products[0].id, "sup-cpu-2");
  assert.equal(byPath.products[0].soldOut, true);
  const listing = await (await fetch(baseUrl + "/api/products?page=1&limit=48")).json();
  assert.ok(listing.products.some((p) => p.id === "sup-cpu-1"));
  assert.ok(!listing.products.some((p) => p.id === "sup-cpu-2"), "tükenen ürün listede yok");
  const byIds = await (await fetch(baseUrl + "/api/products?ids=sup-cpu-2")).json();
  assert.equal(byIds.products.length, 0, "sepet/favori tükenen ürünü çözmez");
  const sitemap = await (await fetch(baseUrl + "/sitemap.xml")).text();
  assert.ok(!sitemap.includes(soldOut.urlPath), "tükenen ürün sitemap'te yok");
  const similar = await (await fetch(baseUrl + "/api/products/similar?id=sup-cpu-2")).json();
  assert.deepEqual(similar.products.map((p) => p.id), ["sup-cpu-1"], "tükenen sayfada stoktaki benzerler");

  const page = await fetch(baseUrl + soldOut.urlPath, { headers: { Accept: "text/html" } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<meta name="robots" content="noindex"/);
  assert.match(html, /detail-soldout-label">Tükendi</);
  assert.doesNotMatch(html, /id="product-jsonld"/, "tükenen üründe Offer işaretlemesi yok");

  const post = (body) =>
    fetch(baseUrl + "/api/price-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ email: "yeni@example.com", consent: true }, body)),
    });
  assert.equal((await post({ productId: "sup-cpu-2", kind: "stock" })).status, 503, "ürün bulundu; yalnızca SMTP yok");
  assert.equal((await post({ productId: "sup-cpu-2" })).status, 404, "tükenen ürüne fiyat alarmı kurulmaz");
  const inStock = await post({ productId: "sup-cpu-1", kind: "stock" });
  assert.equal(inStock.status, 409);
  assert.match((await inStock.json()).error, /şu anda stokta/);

  const removed = await fetch(baseUrl + "/api/admin/price-alerts/" + soldOut.requests[0].id, { method: "DELETE", headers });
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).counts, { price: 1, stock: 1 });
  const counts = await (await fetch(baseUrl + "/api/admin/price-alerts?countsOnly=1", { headers })).json();
  assert.deepEqual(counts.counts, { price: 1, stock: 1 });
});

test("admin panel lists price and stock alert requests under Ürünler", () => {
  const html = read("admin.html");
  const js = read("assets/js/admin-panel.js");
  assert.match(html, /data-products-view="alerts-price">Fiyat Alarm Talepleri/);
  assert.match(html, /data-products-view="alerts-stock">Stoğu Biten Ürün Talepleri/);
  assert.match(html, /id="alertRequestsView"/);
  assert.match(js, /api\("\/api\/admin\/price-alerts\?kind=" \+ kind\)/);
  assert.match(js, /data-alert-request-delete/);
});

test("price alert API validates input, needs SMTP, and confirm/unsubscribe links redirect to the product", async (t) => {
  const tokens = {};
  const { baseUrl, dataRoot, stop } = await spawnTestServer(
    t,
    {},
    {
      seed: (root) => {
        const store = createPriceAlertStore(getDb(root));
        const sub = (email) => store.subscribe({ email, productId: "alert-test-item", price: 1200 }).alert.token;
        tokens.kept = sub("ali@example.com");
        tokens.stopped = sub("veli@example.com");
      },
      products: [
        {
          id: "alert-test-item",
          brand: "TEST",
          name: "Alarm Test Ürünü",
          price: 1000,
          vatPercent: 20,
          category: "bilgisayar-tablet",
          siteParent: "bilgisayar-tablet",
          siteMid: "tasinabilir-bilgisayarlar",
          siteChild: "notebooklar",
          active: true,
          image: "/assets/img/products/macbook-air-m3.svg",
          images: ["/assets/img/products/macbook-air-m3.svg"],
          stockQty: 5,
          currency: "TRY",
          unit: "ADET",
        },
      ],
    }
  );
  const post = (body) =>
    fetch(baseUrl + "/api/price-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const badEmail = await post({ productId: "alert-test-item", email: "yanlis", consent: true });
  assert.equal(badEmail.status, 422);
  const noConsent = await post({ productId: "alert-test-item", email: "ali@example.com" });
  assert.equal(noConsent.status, 422);
  assert.match((await noConsent.json()).error, /onay kutusunu/);
  const unknown = await post({ productId: "yok", email: "ali@example.com", consent: true });
  assert.equal(unknown.status, 404);
  const noSmtp = await post({ productId: "alert-test-item", email: "ali@example.com", consent: true });
  assert.equal(noSmtp.status, 503);
  assert.match((await noSmtp.json()).error, /E-posta bildirimi şu anda kullanılamıyor/);

  const listed = await (await fetch(baseUrl + "/api/products?ids=alert-test-item")).json();
  const urlPath = listed.products[0].urlPath;
  assert.ok(urlPath);

  const confirmUrl = (token) => baseUrl + "/api/price-alerts/confirm?token=" + token;
  const confirm = await fetch(confirmUrl(tokens.kept), { redirect: "manual" });
  assert.equal(confirm.status, 303);
  assert.equal(confirm.headers.get("location"), baseUrl + urlPath + "?alarm=onay");

  await fetch(confirmUrl(tokens.stopped), { redirect: "manual" });
  const unsub = await fetch(baseUrl + "/api/price-alerts/unsubscribe?token=" + tokens.stopped, { redirect: "manual" });
  assert.equal(unsub.headers.get("location"), baseUrl + urlPath + "?alarm=iptal");
  const invalid = await fetch(confirmUrl("yok"), { redirect: "manual" });
  assert.equal(invalid.headers.get("location"), baseUrl + "/urunler?alarm=gecersiz");

  await stop();
  resetDbForTests();
  const store = createPriceAlertStore(getDb(dataRoot));
  assert.equal(store.get(tokens.kept).status, "active");
  assert.equal(store.get(tokens.stopped), null);
  resetDbForTests();
});
