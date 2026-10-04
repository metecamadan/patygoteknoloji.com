const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createReviewStore,
  normalizeReviewInput,
  reviewEligibility,
  abbreviateName,
  ANONYMOUS_AUTHOR,
} = require("../lib/reviews");
const { renderProductHtml, reviewJsonLd } = require("../lib/product-ssr");
const { getDb, resetDbForTests } = require("../lib/db");
const { hmacSha512Base64 } = require("../lib/akbank-pos");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const deliveredOrder = {
  id: "PTY-REV-1",
  status: "delivered",
  customer: { name: "Ayşe Nur Yılmaz", email: "ayse@example.com" },
  items: [
    { productId: "p1", name: "Lenovo Laptop", qty: 1 },
    { productId: "p2", name: "Mouse", qty: 2 },
  ],
};

test("review input: rating 1-5, body length, no links; names are shortened", () => {
  assert.match(normalizeReviewInput({ rating: 0, body: "Çok iyi bir ürün" }).error, /1 ile 5/);
  assert.match(normalizeReviewInput({ rating: 4.5, body: "Çok iyi bir ürün" }).error, /1 ile 5/);
  assert.match(normalizeReviewInput({ rating: 5, body: "kısa" }).error, /en az 10/);
  assert.match(normalizeReviewInput({ rating: 5, body: "Bakın https://spam.example" }).error, /bağlantı/);
  assert.match(normalizeReviewInput({ rating: 5, title: "www.spam.com", body: "Gayet güzel ürün" }).error, /bağlantı/);
  const ok = normalizeReviewInput({ rating: 5, title: " Harika\nürün ", body: "  Hızlı geldi,\n\n\n\nsağlam paket.  " });
  assert.deepEqual(ok.value, { rating: 5, title: "Harika ürün", body: "Hızlı geldi,\n\nsağlam paket.", hideName: false });

  assert.equal(abbreviateName("Ayşe Nur Yılmaz"), "Ayşe Y.");
  assert.equal(abbreviateName("ömer şahin"), "ömer Ş.");
  assert.equal(abbreviateName("Mehmet"), "Mehmet");
  assert.equal(abbreviateName("  "), ANONYMOUS_AUTHOR);
});

test("only delivered orders containing the product are eligible", () => {
  assert.equal(reviewEligibility(deliveredOrder, "p1").ok, true);
  assert.match(reviewEligibility(deliveredOrder, "p9").error, /siparişinizde yok/);
  assert.match(reviewEligibility(Object.assign({}, deliveredOrder, { status: "shipped" }), "p1").error, /teslim edildikten sonra/);
  assert.match(reviewEligibility(Object.assign({}, deliveredOrder, { anonymizedAt: "2026-10-01" }), "p1").error, /yapılamaz/);
  assert.match(reviewEligibility(null, "p1").error, /bulunamadı/);
});

test("review store: one review per order line, only approved ones are public", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-review-"));
  resetDbForTests();
  const store = createReviewStore(getDb(dir), { now: () => Date.parse("2026-10-04T09:00:00Z") });

  const first = store.submit(deliveredOrder, "p1", { rating: 5, title: "Harika", body: "Çok hızlı ve sorunsuz." });
  assert.equal(first.status, "pending");
  assert.equal(first.author, "Ayşe Y.");
  assert.equal(first.productName, "Lenovo Laptop");
  assert.throws(() => store.submit(deliveredOrder, "p1", { rating: 4, body: "İkinci kez yazıyorum." }), /zaten alındı/);
  const hidden = store.submit(deliveredOrder, "p2", { rating: 3, body: "Fena değil, idare eder.", hideName: true });
  assert.equal(hidden.author, ANONYMOUS_AUTHOR);
  assert.deepEqual(store.forOrder("PTY-REV-1"), {
    p1: { status: "pending", rating: 5 },
    p2: { status: "pending", rating: 3 },
  });

  assert.equal(store.summary("p1").count, 0, "onaysız yorum sayılmaz");
  assert.deepEqual(store.publicList("p1"), []);
  store.moderate(first.id, "approved");
  const other = Object.assign({}, deliveredOrder, { id: "PTY-REV-2", customer: { name: "Can Demir" } });
  store.moderate(store.submit(other, "p1", { rating: 4, body: "Beklentimi karşıladı." }).id, "approved");
  assert.deepEqual(store.summary("p1"), {
    count: 2,
    average: 4.5,
    distribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
  });
  const listed = store.publicList("p1");
  assert.equal(listed.length, 2);
  assert.deepEqual(Object.keys(listed[0]).sort(), ["author", "body", "createdAt", "id", "rating", "title"]);
  assert.ok(!JSON.stringify(listed).includes("PTY-REV"), "sipariş numarası yayına çıkmaz");

  store.moderate(hidden.id, "rejected");
  assert.equal(store.summary("p2").count, 0);
  assert.throws(() => store.moderate(hidden.id, "pending"), /Geçersiz/);
  assert.deepEqual(store.statusCounts(), { pending: 0, approved: 2, rejected: 1 });
  assert.equal(store.adminList({ status: "rejected" }).length, 1);
  assert.equal(store.remove(hidden.id).id, hidden.id);
  assert.equal(store.remove(hidden.id), null);
  assert.equal(store.moderate(9999, "approved"), null);
  resetDbForTests();
});

test("product SSR adds aggregateRating and visible reviews only when approved reviews exist", () => {
  const shell =
    '<html><head><title>x</title></head><body><div class="container product-detail" id="detailRoot"></div></body></html>';
  const product = { id: "p1", name: "Lenovo Laptop", price: 1000, vatPercent: 20, urlPath: "/notebook/lenovo" };
  assert.equal(reviewJsonLd(null), null);
  const plain = renderProductHtml(shell, product, null);
  assert.ok(!plain.includes("aggregateRating"));
  assert.ok(!plain.includes("detail-ssr-reviews"));

  const data = {
    summary: { count: 2, average: 4.5 },
    reviews: [{ rating: 5, title: "Harika", body: "Çok iyi <b>", author: "Ayşe Y.", createdAt: "2026-10-04T09:00:00Z" }],
  };
  const html = renderProductHtml(shell, product, data);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json" id="product-jsonld">(.*?)<\/script>/)[1]);
  assert.deepEqual(ld.aggregateRating, {
    "@type": "AggregateRating",
    ratingValue: "4.5",
    reviewCount: 2,
    bestRating: "5",
    worstRating: "1",
  });
  assert.equal(ld.review[0].author.name, "Ayşe Y.");
  assert.equal(ld.review[0].datePublished, "2026-10-04");
  assert.match(html, /<section class="detail-ssr-reviews">/);
  assert.match(html, /Çok iyi &lt;b&gt;/);
});

test("storefront, admin and KVKK wire verified reviews", () => {
  const detail = read("assets/js/urun-detay.js");
  const page = read("degerlendir.html");
  const pageJs = read("assets/js/degerlendir.js");
  const admin = read("admin.html");
  const panel = read("assets/js/admin-panel.js");
  const kvkk = read("kvkk.html");
  assert.match(detail, /root\.appendChild\(buildReviewSection\(product\)\)/);
  assert.match(detail, /fetch\("\/api\/reviews\?productId="/);
  assert.match(detail, /reviewJsonLd\(data\)/);
  const verifiedLabel = detail.match(/const VERIFIED_BUYER_LABEL = "([^"]+)";/);
  assert.ok(verifiedLabel);
  assert.equal(verifiedLabel[1], ANONYMOUS_AUTHOR);
  assert.match(detail, /if \(item\.author !== VERIFIED_BUYER_LABEL\)/);
  assert.match(page, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(page, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(pageJs, /history\.replaceState/);
  assert.match(pageJs, /fetch\("\/api\/reviews"/);
  assert.match(admin, /data-admin-tab="reviews"/);
  assert.match(admin, /id="adminReviewList"/);
  assert.match(admin, /<option value="delivered">Teslim edildi<\/option>/);
  assert.match(panel, /api\("\/api\/admin\/reviews"/);
  assert.match(panel, /\["preparing", "delivered", "cancelled"\]/);
  assert.match(kvkk, /kısaltılmış adınızla/);
  assert.match(kvkk, /Ürün değerlendirmesi \(puan, yorum, kısaltılmış ad\)/);
});

test("review API: delivered order owner reviews, admin approves, product page shows the rating", async (t) => {
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
    {
      products: [
        {
          id: "rev-test-item",
          brand: "TEST",
          name: "Yorum Test Ürünü",
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
  const send = (method, url, body, headers) =>
    fetch(baseUrl + url, {
      method,
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const started = await (
    await send("POST", "/api/payment/start", {
      items: [{ productId: "rev-test-item", qty: 1 }],
      customer: {
        name: "Yorum Yazan Kişi",
        email: "rev@example.com",
        phone: "05555555555",
        billingAddress: "Test Mah. No:1 İstanbul",
        shippingAddress: "Test Mah. No:1 İstanbul",
      },
      contractsAccepted: true,
      kvkkAccepted: true,
    })
  ).json();
  assert.equal(started.ok, true);
  const orderId = started.orderId;
  const token = started.orderAccessToken;
  const cb = { orderId, responseCode: "VPS-0000", responseMessage: "Success", amount: started.fields.amount, hashParams: "orderId+responseCode+amount" };
  cb.hash = hmacSha512Base64(cb.orderId + cb.responseCode + cb.amount, secret);
  await fetch(baseUrl + "/api/payment/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(cb).toString(),
    redirect: "manual",
  });

  const orderQuery = "/api/reviews/order?siparis=" + encodeURIComponent(orderId) + "&token=";
  assert.equal((await fetch(baseUrl + orderQuery + "yanlis")).status, 403);
  const early = await fetch(baseUrl + orderQuery + token);
  assert.equal(early.status, 409, "teslim edilmeden değerlendirme açılmaz");
  const review = { orderId, token, productId: "rev-test-item", rating: 5, title: "Süper", body: "Kargo hızlıydı, ürün sağlam." };
  assert.equal((await send("POST", "/api/reviews", review)).status, 422);

  const login = await send("POST", "/api/admin/login", { password });
  const auth = { Authorization: "Bearer " + (await login.json()).token };
  const adminOrder = "/api/admin/orders/" + encodeURIComponent(orderId);
  const tooEarly = await send("PATCH", adminOrder, { status: "delivered" }, auth);
  assert.equal(tooEarly.status, 400);
  assert.match((await tooEarly.json()).error, /kargoya verilmiş/);
  await send("PATCH", adminOrder, { shippingCarrier: "Yurtiçi Kargo", trackingCode: "YK1" }, auth);
  const delivered = await (await send("PATCH", adminOrder, { status: "delivered" }, auth)).json();
  assert.equal(delivered.order.status, "delivered");
  assert.equal(delivered.mailSent, false);
  assert.equal(delivered.mailReason, "smtp_not_configured");

  const items = await (await fetch(baseUrl + orderQuery + token)).json();
  assert.deepEqual(
    items.items.map((row) => [row.productId, row.review]),
    [["rev-test-item", null]]
  );
  assert.ok(items.items[0].urlPath);

  assert.equal((await send("POST", "/api/reviews", Object.assign({}, review, { token: "x" }))).status, 403);
  const saved = await send("POST", "/api/reviews", review);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).status, "pending");
  const dup = await send("POST", "/api/reviews", review);
  assert.equal(dup.status, 422);
  assert.match((await dup.json()).error, /zaten alındı/);

  const publicBefore = await (await fetch(baseUrl + "/api/reviews?productId=rev-test-item")).json();
  assert.equal(publicBefore.summary.count, 0);

  assert.equal((await fetch(baseUrl + "/api/admin/reviews")).status, 401);
  const pending = await (await fetch(baseUrl + "/api/admin/reviews?status=pending", { headers: auth })).json();
  assert.equal(pending.counts.pending, 1);
  assert.equal(pending.reviews[0].author, "Yorum K.");
  const approved = await send("PATCH", "/api/admin/reviews/" + pending.reviews[0].id, { status: "approved" }, auth);
  assert.equal((await approved.json()).counts.approved, 1);

  const publicAfter = await (await fetch(baseUrl + "/api/reviews?productId=rev-test-item")).json();
  assert.equal(publicAfter.summary.count, 1);
  assert.equal(publicAfter.summary.average, 5);
  assert.equal(publicAfter.reviews[0].body, "Kargo hızlıydı, ürün sağlam.");
  const page = await (await fetch(baseUrl + items.items[0].urlPath)).text();
  assert.match(page, /"aggregateRating":\{"@type":"AggregateRating","ratingValue":"5","reviewCount":1/);
  const reviewed = await (await fetch(baseUrl + orderQuery + token)).json();
  assert.equal(reviewed.items[0].review.status, "approved");

  const del = await send("DELETE", "/api/admin/reviews/" + pending.reviews[0].id, undefined, auth);
  assert.equal(del.status, 200);
  const pageAfterDelete = await (await fetch(baseUrl + items.items[0].urlPath)).text();
  assert.ok(!pageAfterDelete.includes("aggregateRating"), "silinen yorum SSR önbelleğinden düşer");
});
