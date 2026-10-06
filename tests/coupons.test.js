const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeCode,
  normalizeCouponInput,
  evaluateCoupon,
  createCouponStore,
} = require("../lib/coupons");
const { getDb, resetDbForTests } = require("../lib/db");
const { buildSalesInvoicePayload } = require("../lib/bizimhesap");
const { buildOrderMail } = require("../lib/order-mail");
const { createOrderStore } = require("../lib/orders");
const { hmacSha512Base64 } = require("../lib/akbank-pos");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const money = (v) => Number(String(v).replace(/,/g, ""));
const DAY = 86400000;
const NOW = Date.parse("2026-10-04T09:00:00Z");

function coupon(overrides) {
  return Object.assign(
    {
      code: "HOSGELDIN10",
      type: "percent",
      value: 10,
      minOrder: 0,
      maxDiscount: 0,
      startsAt: "",
      endsAt: "",
      usageLimit: 0,
      usedCount: 0,
      active: true,
    },
    overrides
  );
}

test("normalizeCode uppercases Turkish input and normalizeCouponInput rejects bad admin input", () => {
  assert.equal(normalizeCode(" hoşgeldin 10 "), "HOŞGELDIN10");
  assert.equal(normalizeCode("indirim"), "INDIRIM");
  assert.throws(() => normalizeCouponInput({ code: "AB", value: 5 }), /3–24 karakter/);
  assert.throws(() => normalizeCouponInput({ code: "YAZ_25", value: 5 }), /harf, rakam ve tire/);
  assert.throws(() => normalizeCouponInput({ code: "YAZ25", value: 0 }), /sıfırdan büyük/);
  assert.throws(() => normalizeCouponInput({ code: "YAZ25", value: 95 }), /en fazla %90/);
  assert.throws(
    () => normalizeCouponInput({ code: "YAZ25", value: 5, startsAt: "2026-10-10", endsAt: "2026-10-01" }),
    /Bitiş tarihi/
  );
  assert.throws(() => normalizeCouponInput({ code: "YAZ25", value: 5, endsAt: "2026-02-30" }), /Geçersiz tarih/);
  const amount = normalizeCouponInput({ code: "kis-100", type: "amount", value: 100, maxDiscount: 50 });
  assert.equal(amount.code, "KIS-100");
  assert.equal(amount.maxDiscount, 0, "tutar kuponunda üst sınır anlamsız");
  assert.equal(amount.active, true);
});

test("evaluateCoupon applies percent with cap, fixed amount, limits and Istanbul-day windows", () => {
  assert.deepEqual(evaluateCoupon(coupon(), 1200, NOW), { ok: true, discount: 120 });
  assert.deepEqual(evaluateCoupon(coupon({ maxDiscount: 75 }), 1200, NOW), { ok: true, discount: 75 });
  assert.deepEqual(evaluateCoupon(coupon({ type: "amount", value: 250 }), 1200, NOW), { ok: true, discount: 250 });
  assert.deepEqual(
    evaluateCoupon(coupon({ type: "amount", value: 500 }), 300, NOW),
    { ok: true, discount: 299 },
    "en az 1 TL ödeme kalır"
  );
  assert.match(evaluateCoupon(null, 1200, NOW).error, /geçersiz/);
  assert.match(evaluateCoupon(coupon({ active: false }), 1200, NOW).error, /artık geçerli değil/);
  assert.match(evaluateCoupon(coupon({ minOrder: 1500 }), 1200, NOW).error, /1\.500,00 ₺ ve üzeri/);
  assert.match(evaluateCoupon(coupon({ usageLimit: 3, usedCount: 3 }), 1200, NOW).error, /limiti doldu/);
  assert.match(evaluateCoupon(coupon({ startsAt: "2026-10-05" }), 1200, NOW).error, /henüz başlamadı/);
  assert.match(evaluateCoupon(coupon({ endsAt: "2026-10-03" }), 1200, NOW).error, /süresi doldu/);
  // 2026-10-04 21:30 UTC is already 5 Ekim in Istanbul.
  const lateNight = Date.parse("2026-10-04T21:30:00Z");
  assert.match(evaluateCoupon(coupon({ endsAt: "2026-10-04" }), 1200, lateNight).error, /süresi doldu/);
  assert.equal(evaluateCoupon(coupon({ startsAt: "2026-10-05" }), 1200, lateNight).ok, true);
  assert.equal(evaluateCoupon(coupon({ endsAt: "2026-10-04" }), 1200, NOW + DAY / 4).ok, true);
});

test("coupon release on full refund gives usage back once and never recounts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-coupon-rel-"));
  resetDbForTests(dir);
  const store = createCouponStore(getDb(dir));
  store.save({ code: "IADE10", type: "percent", value: 10, usageLimit: 1 });
  assert.equal(store.redeem("PTY-R1", "IADE10"), true);
  assert.equal(store.get("IADE10").usedCount, 1);
  assert.equal(store.release("PTY-R1"), true);
  assert.equal(store.get("IADE10").usedCount, 0);
  assert.equal(store.release("PTY-R1"), false, "ikinci release sayacı düşürmez");
  assert.equal(store.redeem("PTY-R1", "IADE10"), false, "iade sonrası tekrar gelen callback yeniden saymaz");
  assert.equal(store.get("IADE10").usedCount, 0);
  assert.equal(store.release("PTY-YOK"), false);
});

test("coupon store upserts without resetting usage and counts each paid order once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-coupon-"));
  resetDbForTests(dir);
  const store = createCouponStore(getDb(dir));
  store.save({ code: "yaz25", type: "percent", value: 25, usageLimit: 2 });
  assert.equal(store.get("YAZ25").value, 25);
  assert.equal(store.redeem("PTY-1", "yaz25"), true);
  assert.equal(store.redeem("PTY-1", "YAZ25"), false, "aynı sipariş tekrar sayılmaz");
  assert.equal(store.redeem("PTY-2", "YAZ25"), true);
  assert.equal(store.get("YAZ25").usedCount, 2);
  assert.match(evaluateCoupon(store.get("YAZ25"), 1000, Date.now()).error, /limiti doldu/);

  store.save({ code: "YAZ25", type: "amount", value: 100, usageLimit: 5 });
  const updated = store.get("YAZ25");
  assert.equal(updated.type, "amount");
  assert.equal(updated.usedCount, 2, "güncelleme kullanım sayısını korur");

  assert.equal(store.setActive("YAZ25", false).active, false);
  assert.equal(store.list().length, 1);
  assert.equal(store.remove("YAZ25"), true);
  assert.equal(store.get("YAZ25"), null);
  assert.equal(store.setActive("YOK", true), null);
  resetDbForTests(dir);
});

test("BizimHesap invoice bakes the coupon into product lines and still sums to the charged total", () => {
  const order = {
    id: "PTY-CPN-1",
    subtotal: 1100,
    vat: 210,
    shippingFee: 149,
    coupon: { code: "YAZ25", type: "amount", value: 131, discount: 131 },
    total: 1328,
    customer: { name: "Kupon Test", email: "k@example.com" },
    items: [
      { productId: "a", name: "Monitör", qty: 2, line: 1000, lineVat: 200, vatPercent: 20 },
      { productId: "b", name: "Kitap", qty: 1, line: 100, lineVat: 10, vatPercent: 10 },
    ],
  };
  const payload = buildSalesInvoicePayload(order, { BIZIMHESAP_FIRM_ID: "F" });
  const [monitor, book, shipping] = payload.details;
  assert.equal(money(monitor.total), 1080, "1200 brütün payı 120");
  assert.equal(money(book.total), 99, "110 brütün payı 11");
  assert.equal(money(monitor.net), 900);
  assert.equal(money(monitor.unitPrice), 450);
  assert.equal(money(book.net) + money(book.tax), 99);
  assert.equal(shipping.productId, "shipping");
  assert.equal(money(shipping.total), 149, "kargo satırı indirimden etkilenmez");
  assert.ok(payload.details.every((row) => row.discount === "0.00"));
  assert.match(payload.note, /YAZ25 kuponu ile 131\.00 TL indirim/);
  const sum = payload.details.reduce((acc, row) => acc + money(row.total), 0);
  assert.equal(Math.round(sum * 100) / 100, 1328);
  assert.equal(money(payload.amounts.total), 1328);
  assert.ok(Math.abs(money(payload.amounts.net) + money(payload.amounts.tax) - 1328) <= 0.02);
});

test("coupon and installment together: surcharge is computed on the discounted base", () => {
  const order = {
    id: "PTY-CPN-2",
    subtotal: 1000,
    vat: 200,
    shippingFee: 0,
    coupon: { code: "HOSGELDIN10", type: "percent", value: 10, discount: 120 },
    installment: { count: 3, ratePercent: 5, baseTotal: 1080, surcharge: 54, total: 1134 },
    total: 1134,
    customer: { name: "Kupon Taksit" },
    items: [{ productId: "a", name: "Laptop", qty: 1, line: 1000, lineVat: 200, vatPercent: 20 }],
  };
  const payload = buildSalesInvoicePayload(order, { BIZIMHESAP_FIRM_ID: "F" });
  assert.equal(money(payload.details[0].total), 1080);
  assert.equal(money(payload.details[1].total), 54);
  const sum = payload.details.reduce((acc, row) => acc + money(row.total), 0);
  assert.equal(Math.round(sum * 100) / 100, 1134);
});

test("order store persists the coupon and order mail shows the discount line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-coupon-order-"));
  resetDbForTests(dir);
  const store = createOrderStore(dir);
  const applied = { code: "HOSGELDIN10", type: "percent", value: 10, discount: 120 };
  store.save({
    id: "PTY-CPN-STORE",
    subtotal: 1000,
    vat: 200,
    total: 1080,
    coupon: applied,
    customer: { name: "Kupon", email: "store@example.com" },
    items: [{ productId: "x", name: "Ürün", qty: 1, line: 1000, lineVat: 200, vatPercent: 20 }],
  });
  const saved = store.get("PTY-CPN-STORE");
  assert.deepEqual(saved.coupon, applied);
  assert.equal(saved.merchandiseTotal, 1200, "ürün toplamı indirim öncesi kalır");
  store.save({ id: "PTY-CPN-NONE", subtotal: 10, vat: 2, total: 12, customer: {}, items: [] });
  assert.equal(store.get("PTY-CPN-NONE").coupon, null);

  const mail = buildOrderMail(saved, "paid", {}, {});
  assert.match(mail.text, /Kupon \(HOSGELDIN10\): -₺120,00/);
  assert.match(mail.text, /Genel toplam: ₺1\.080,00/);
  assert.match(mail.html, /Kupon \(HOSGELDIN10\)/);
  resetDbForTests(dir);
});

test("checkout, cart and admin UI wire coupons and cart suggestions", () => {
  const odeme = read("odeme.html");
  const checkout = read("assets/js/checkout.js");
  const sepet = read("sepet.html");
  const sepetJs = read("assets/js/sepet.js");
  const admin = read("admin.html");
  const panel = read("assets/js/admin-panel.js");
  assert.match(odeme, /id="couponInput"/);
  assert.match(odeme, /id="couponApplyBtn"/);
  assert.match(odeme, /id="couponRow" hidden/);
  assert.match(checkout, /fetch\("\/api\/coupons\/check"/);
  assert.match(checkout, /couponCode: totals\.couponCode \|\| undefined/);
  assert.match(checkout, /summary\.total = Math\.round\(\(summary\.total - discount\) \* 100\) \/ 100/);
  assert.match(sepet, /id="cartSuggestions"[^>]*hidden/);
  assert.match(sepetJs, /\/api\/products\/similar\?id=/);
  assert.match(sepetJs, /!inCart\.has\(String\(item\.id\)\)/);
  assert.match(admin, /id="adminCouponForm"/);
  assert.match(admin, /id="couponTableBody"/);
  assert.match(panel, /api\("\/api\/admin\/coupons"\)/);
  assert.match(panel, /method: "PATCH"/);
  assert.match(panel, /coupon \? \["Kupon", escapeHtml\(coupon\.code\)/);
  assert.match(panel, /loadAdminCoupons\(\)\.catch/);
});

test("coupon API: admin creates, shopper checks, payment charges the discounted total, usage counts once", async (t) => {
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
          id: "cpn-test-item",
          brand: "TEST",
          name: "Kupon Test Ürünü",
          price: 1000,
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
          currency: "TRY",
          unit: "ADET",
        },
      ],
    }
  );
  const post = (url, body, headers) =>
    fetch(baseUrl + url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: JSON.stringify(body),
    });
  const items = [{ productId: "cpn-test-item", qty: 1 }];

  assert.equal((await fetch(baseUrl + "/api/admin/coupons")).status, 401);
  const login = await post("/api/admin/login", { password });
  const auth = { Authorization: "Bearer " + (await login.json()).token };

  const bad = await post("/api/admin/coupons", { code: "X", value: 10 }, auth);
  assert.equal(bad.status, 422);
  const created = await post(
    "/api/admin/coupons",
    { code: "hosgeldin10", type: "percent", value: 10, maxDiscount: 100, usageLimit: 1 },
    auth
  );
  assert.equal(created.status, 200);
  assert.equal((await created.json()).coupon.code, "HOSGELDIN10");
  const listed = await (await fetch(baseUrl + "/api/admin/coupons", { headers: auth })).json();
  assert.deepEqual(listed.coupons.map((c) => c.code), ["HOSGELDIN10"]);

  const unknown = await post("/api/coupons/check", { code: "YOKBOYLE", items });
  assert.equal(unknown.status, 422);
  assert.match((await unknown.json()).error, /geçersiz/);
  const check = await (await post("/api/coupons/check", { code: "hosgeldin10", items })).json();
  assert.equal(check.ok, true);
  assert.equal(check.discount, 100, "%10 = 120, üst sınır 100");
  assert.equal(check.merchandiseTotal, 1200);

  const startBody = (couponCode) => ({
    items,
    customer: {
      name: "Kupon Test",
      email: "cpn@example.com",
      phone: "05555555555",
      billingAddress: "Test Mah. No:1 İstanbul",
      shippingAddress: "Test Mah. No:1 İstanbul",
    },
    contractsAccepted: true,
    kvkkAccepted: true,
    couponCode,
  });
  const badStart = await post("/api/payment/start", startBody("YOKBOYLE"));
  assert.equal(badStart.status, 422);

  const started = await (await post("/api/payment/start", startBody("HOSGELDIN10"))).json();
  assert.equal(started.ok, true);
  assert.equal(Number(started.fields.amount), 1100);
  const orderUrl =
    baseUrl +
    "/api/payment/order?orderId=" +
    encodeURIComponent(started.orderId) +
    "&token=" +
    encodeURIComponent(started.orderAccessToken);
  const order = (await (await fetch(orderUrl)).json()).order;
  assert.equal(order.total, 1100);
  assert.deepEqual(order.coupon, { code: "HOSGELDIN10", discount: 100 });
  assert.equal(order.merchandiseTotal, 1200);

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
  const afterPaid = await (await fetch(baseUrl + "/api/admin/coupons", { headers: auth })).json();
  assert.equal(afterPaid.coupons[0].usedCount, 1, "tekrarlanan banka cevabı ikinci kez saymaz");

  const exhausted = await post("/api/coupons/check", { code: "HOSGELDIN10", items });
  assert.equal(exhausted.status, 422);
  assert.match((await exhausted.json()).error, /limiti doldu/);

  const off = await fetch(baseUrl + "/api/admin/coupons/HOSGELDIN10", {
    method: "PATCH",
    headers: Object.assign({ "Content-Type": "application/json" }, auth),
    body: JSON.stringify({ active: false }),
  });
  assert.equal((await off.json()).coupon.active, false);
  const del = await fetch(baseUrl + "/api/admin/coupons/HOSGELDIN10", { method: "DELETE", headers: auth });
  assert.equal(del.status, 200);
  const delAgain = await fetch(baseUrl + "/api/admin/coupons/HOSGELDIN10", { method: "DELETE", headers: auth });
  assert.equal(delAgain.status, 404);
});
