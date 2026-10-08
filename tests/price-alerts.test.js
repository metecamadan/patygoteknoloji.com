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

test("decideAlert mails on a 2% drop, on return to sale, and remembers unavailability", () => {
  const active = { basePrice: 1000, available: true };
  assert.deepEqual(decideAlert(active, { priceIncl: 980 }), { kind: "drop", basePrice: 980, available: true });
  assert.deepEqual(decideAlert(active, { priceIncl: 985 }), { kind: null, basePrice: 1000, available: true });
  assert.deepEqual(decideAlert(active, { priceIncl: 1100 }), { kind: null, basePrice: 1000, available: true });
  assert.deepEqual(decideAlert(active, null), { kind: null, basePrice: 1000, available: false });
  const gone = { basePrice: 1000, available: false };
  assert.deepEqual(decideAlert(gone, { priceIncl: 1050 }), { kind: "back", basePrice: 1000, available: true });
  assert.deepEqual(decideAlert(gone, { priceIncl: 900 }), { kind: "back", basePrice: 900, available: true });
  assert.deepEqual(decideAlert(gone, null), { kind: null, basePrice: 1000, available: false });
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
  assert.deepEqual(store.summary(), { pending: 0, active: 1 });

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
  due = store.evaluate(() => product);
  assert.equal(due[0].kind, "back");
  store.markNotified(due[0]);
  assert.equal(store.get(first.alert.token).available, true);

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
  assert.match(received.text, /talebinizi aldık\. Şu anki fiyat: ₺1\.000,00/);
  assert.match(received.text, /sizi e-postayla bilgilendireceğiz/);
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
  const back = buildNotifyMail(
    { alert, product: { priceIncl: 1000, name: "Lenovo Laptop", urlPath: "/x" }, kind: "back", previousPrice: 1000 },
    { env }
  );
  assert.equal(back.subject, "Lenovo Laptop yeniden satışta");
});

test("product page offers the alert form with consent; KVKK lists purpose and retention", () => {
  const detail = read("assets/js/urun-detay.js");
  const main = read("assets/js/main.js");
  const kvkk = read("kvkk.html");
  assert.match(detail, /buyRow\.appendChild\(buildPriceAlert\(product\)\)/);
  assert.match(detail, /fetch\("\/api\/price-alerts"/);
  assert.match(detail, /consent: true/);
  assert.match(detail, /name="consent" required/);
  assert.match(detail, /form\.replaceWith\(done\)/, "talep alınınca form kapanır");
  assert.match(detail, /Talebinizi aldık\. Fiyatı düştüğünde veya ürün yeniden satışa girdiğinde sizi e-postayla bilgilendireceğiz\./);
  assert.doesNotMatch(detail, /Onay e-postası gönderdik/);
  assert.match(main, /alarmParams\.get\("alarm"\)/);
  assert.match(kvkk, /fiyat alarmı; açık rızanıza dayanır/);
  assert.match(kvkk, /Fiyat alarmı \(e-posta, takip edilen ürün\)<\/td><td>En fazla 180 gün veya iptale kadar/);
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
  assert.deepEqual(createPriceAlertStore(getDb(dataRoot)).summary(), { pending: 0, active: 0 }, "maili gitmeyen alarm açık kalmaz");
  resetDbForTests();
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
