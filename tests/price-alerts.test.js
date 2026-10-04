const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { decideAlert, createPriceAlertStore, MAX_ACTIVE_PER_EMAIL } = require("../lib/price-alerts");
const { buildConfirmMail, buildNotifyMail } = require("../lib/price-alert-mail");
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

test("price alert store: double opt-in, per-address cap, retry until mailed, purge", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-alert-"));
  resetDbForTests();
  let clock = Date.parse("2026-10-04T09:00:00Z");
  const store = createPriceAlertStore(getDb(dir), { now: () => clock });

  const first = store.subscribe({ email: " Ali@Example.com ", productId: "p1", productName: "Laptop", price: 1000 });
  assert.equal(first.state, "created");
  assert.equal(first.alert.email, "ali@example.com");
  assert.equal(first.alert.status, "pending");
  assert.match(first.alert.token, /^[a-f0-9]{48}$/);
  assert.equal(store.subscribe({ email: "ali@example.com", productId: "p1", price: 990 }).state, "pending");
  assert.equal(store.evaluate(() => ({ priceIncl: 500 })).length, 0, "onaysız alarm bildirim almaz");

  assert.equal(store.confirm(first.alert.token).status, "active");
  assert.equal(store.subscribe({ email: "ali@example.com", productId: "p1", price: 990 }).state, "active");
  assert.deepEqual(store.summary(), { pending: 0, active: 1 });

  let product = { priceIncl: 950, name: "Laptop", urlPath: "/bilgisayar/laptop" };
  let due = store.evaluate(() => product);
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "drop");
  assert.equal(due[0].previousPrice, 990);
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
    const sub = store.subscribe({ email: "cok@example.com", productId: "x" + i, price: 10 });
    store.confirm(sub.alert.token);
  }
  assert.throws(
    () => store.subscribe({ email: "cok@example.com", productId: "fazla", price: 10 }),
    /en fazla 20 ürün/
  );

  const stale = store.subscribe({ email: "eski@example.com", productId: "p1", price: 10 });
  clock += 8 * DAY;
  assert.equal(store.purge(), 1, "onaylanmayan talep 7 gün sonra silinir");
  assert.equal(store.get(stale.alert.token), null);
  clock += 200 * DAY;
  assert.ok(store.purge() >= 21, "onaylı alarmlar 180 gün sonra silinir");

  const gone = store.subscribe({ email: "ali@example.com", productId: "p2", price: 10 });
  assert.equal(store.unsubscribe(gone.alert.token).productId, "p2");
  assert.equal(store.get(gone.alert.token), null);
  assert.equal(store.unsubscribe("yok"), null);
  resetDbForTests();
});

test("price alert mails link the domain, confirm token and one-click unsubscribe", () => {
  const alert = {
    id: 1,
    token: "a".repeat(48),
    email: "ali@example.com",
    productName: "Lenovo Laptop",
    basePrice: 1000,
  };
  const env = { SITE_BASE_URL: "http://127.0.0.1:5173" };
  const confirm = buildConfirmMail(alert, { env });
  assert.equal(confirm.to, "ali@example.com");
  assert.match(confirm.text, /https:\/\/patygoteknoloji\.com\/api\/price-alerts\/confirm\?token=a{48}/);
  assert.match(confirm.text, /₺1\.000,00/);
  assert.match(confirm.html, /Alarmı onayla/);

  const notify = buildNotifyMail(
    { alert, product: { priceIncl: 900, name: "Lenovo Laptop", urlPath: "/bilgisayar/lenovo-laptop" }, kind: "drop", previousPrice: 1000 },
    { env }
  );
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
  assert.match(detail, /info\.appendChild\(buildPriceAlert\(product\)\)/);
  assert.match(detail, /fetch\("\/api\/price-alerts"/);
  assert.match(detail, /consent: true/);
  assert.match(detail, /name="consent" required/);
  assert.match(main, /alarmParams\.get\("alarm"\)/);
  assert.match(kvkk, /fiyat alarmı; açık rızanıza dayanır/);
  assert.match(kvkk, /Fiyat alarmı \(e-posta, takip edilen ürün\)/);
});

test("price alert API validates input, needs SMTP, and confirm/unsubscribe links redirect to the product", async (t) => {
  const { baseUrl, dataRoot } = await spawnTestServer(
    t,
    {},
    {
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

  resetDbForTests();
  const store = createPriceAlertStore(getDb(dataRoot));
  const { alert } = store.subscribe({ email: "ali@example.com", productId: "alert-test-item", price: 1200 });
  const confirm = await fetch(baseUrl + "/api/price-alerts/confirm?token=" + alert.token, { redirect: "manual" });
  assert.equal(confirm.status, 303);
  assert.equal(confirm.headers.get("location"), baseUrl + urlPath + "?alarm=onay");
  assert.equal(store.get(alert.token).status, "active");

  const stop = await fetch(baseUrl + "/api/price-alerts/unsubscribe?token=" + alert.token, { redirect: "manual" });
  assert.equal(stop.headers.get("location"), baseUrl + urlPath + "?alarm=iptal");
  assert.equal(store.get(alert.token), null);
  const invalid = await fetch(baseUrl + "/api/price-alerts/confirm?token=yok", { redirect: "manual" });
  assert.equal(invalid.headers.get("location"), baseUrl + "/urunler?alarm=gecersiz");
  resetDbForTests();
});
