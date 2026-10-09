const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeInstallmentSettings,
  quoteInstallments,
  resolveInstallment,
  createInstallmentSettingsStore,
} = require("../lib/installment-settings");
const { buildSalesInvoicePayload } = require("../lib/bizimhesap");
const { buildOrderMail } = require("../lib/order-mail");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const RATES = {
  enabled: true,
  minAmount: 500,
  options: [
    { count: 6, ratePercent: 9.5 },
    { count: 3, ratePercent: 4 },
    { count: 3, ratePercent: 7 },
    { count: 1, ratePercent: 0 },
    { count: 13, ratePercent: 1 },
  ],
};

test("normalizeInstallmentSettings keeps valid counts sorted, first duplicate wins, needs options to enable", () => {
  const cfg = normalizeInstallmentSettings(RATES);
  assert.deepEqual(
    cfg.options,
    [
      { count: 3, ratePercent: 4 },
      { count: 6, ratePercent: 9.5 },
    ]
  );
  assert.equal(cfg.enabled, true);
  assert.equal(normalizeInstallmentSettings({ enabled: true, options: [] }).enabled, false);
});

test("quoteInstallments applies vade farkı to the full amount and respects the floor", () => {
  const quotes = quoteInstallments(1000, RATES);
  assert.deepEqual(quotes, [
    { count: 3, ratePercent: 4, total: 1040, monthly: 346.67 },
    { count: 6, ratePercent: 9.5, total: 1095, monthly: 182.5 },
  ]);
  assert.deepEqual(quoteInstallments(499.99, RATES), []);
  assert.deepEqual(quoteInstallments(1000, Object.assign({}, RATES, { enabled: false })), []);
});

test("resolveInstallment returns null for tek çekim and rejects counts not offered", () => {
  assert.equal(resolveInstallment(1000, 1, RATES), null);
  assert.equal(resolveInstallment(1000, undefined, RATES), null);
  assert.deepEqual(resolveInstallment(1000, 3, RATES), {
    count: 3,
    ratePercent: 4,
    baseTotal: 1000,
    surcharge: 40,
    total: 1040,
  });
  assert.throws(() => resolveInstallment(1000, 9, RATES), /taksit seçeneği bu sipariş için geçerli değil/);
  assert.throws(() => resolveInstallment(400, 3, RATES), /geçerli değil/);
});

test("installment store is off by default, validates admin input and hides rates when disabled", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-inst-"));
  const store = createInstallmentSettingsStore(dir);
  assert.deepEqual(store.getPublic(), { enabled: false, minAmount: 0, options: [] });
  assert.throws(() => store.setSettings({ enabled: true, options: [] }), /en az bir taksit/);
  assert.throws(() => store.setSettings({ options: [{ count: 3, ratePercent: 150 }] }), /%0–%100/);
  const saved = store.setSettings({ enabled: false, minAmount: 750, options: [{ count: 3, ratePercent: 5 }] });
  assert.equal(saved.enabled, false);
  assert.deepEqual(store.getSettings().options, [{ count: 3, ratePercent: 5 }]);
  assert.deepEqual(store.getPublic().options, []);
  store.setSettings({ enabled: true });
  assert.deepEqual(store.getPublic(), { enabled: true, minAmount: 750, options: [{ count: 3, ratePercent: 5 }] });
});

test("BizimHesap invoice carries vade farkı rows split by VAT rate and sums to the charged total", () => {
  const order = {
    id: "PTY-INST-1",
    subtotal: 1100,
    vat: 210,
    shippingFee: 0,
    total: 1375.5,
    installment: { count: 6, ratePercent: 5, baseTotal: 1310, surcharge: 65.5, total: 1375.5 },
    customer: { name: "Taksit Test", email: "t@example.com" },
    items: [
      { productId: "a", name: "Monitör", qty: 1, line: 1000, lineVat: 200, vatPercent: 20 },
      { productId: "b", name: "Kitap", qty: 1, line: 100, lineVat: 10, vatPercent: 10 },
    ],
  };
  const payload = buildSalesInvoicePayload(order, { BIZIMHESAP_FIRM_ID: "F" });
  const surchargeRows = payload.details.filter((row) => /^installment-surcharge-/.test(row.productId));
  assert.deepEqual(
    surchargeRows.map((row) => row.productName),
    ["Vade farkı (6 taksit) %20 KDV", "Vade farkı (6 taksit) %10 KDV"]
  );
  const money = (v) => Number(String(v).replace(/,/g, ""));
  assert.equal(
    Math.round(surchargeRows.reduce((sum, row) => sum + money(row.total), 0) * 100) / 100,
    65.5
  );
  const net = money(payload.amounts.net);
  const tax = money(payload.amounts.tax);
  assert.ok(Math.abs(net + tax - 1375.5) <= 0.02, "net + KDV ≈ charged total");
  assert.equal(money(payload.amounts.total), 1375.5);
});

test("order store persists the installment and order mail shows vade farkı", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-inst-order-"));
  resetDbForTests(dir);
  const store = createOrderStore(dir);
  const installment = { count: 3, ratePercent: 4, baseTotal: 1000, surcharge: 40, total: 1040 };
  store.save({
    id: "PTY-INST-STORE",
    subtotal: 833.33,
    vat: 166.67,
    total: 1040,
    installment,
    customer: { name: "Taksit", email: "store@example.com" },
    items: [{ productId: "x", name: "Ürün", qty: 1, line: 833.33, lineVat: 166.67, vatPercent: 20 }],
  });
  assert.deepEqual(store.get("PTY-INST-STORE").installment, installment);
  store.save({ id: "PTY-INST-SINGLE", subtotal: 10, vat: 2, total: 12, customer: {}, items: [] });
  assert.equal(store.get("PTY-INST-SINGLE").installment, null);

  const mail = buildOrderMail(store.get("PTY-INST-STORE"), "paid", {}, {});
  assert.match(mail.text, /Vade farkı \(3 taksit\): ₺40,00/);
  assert.match(mail.html, /Vade farkı \(3 taksit\)/);
  resetDbForTests(dir);
});

test("checkout and product page render installments from /api/installments and send installCount", () => {
  const checkout = read("assets/js/checkout.js");
  const odeme = read("odeme.html");
  const detail = read("assets/js/urun-detay.js");
  const detailHtml = read("urun-detay.html");
  const shared = read("assets/js/installments.js");
  assert.match(shared, /fetch\("\/api\/installments"/);
  assert.match(shared, /posReady !== false/);
  assert.match(odeme, /id="installmentFieldset"[^>]*hidden/);
  assert.match(odeme, /id="installmentRow" hidden/);
  assert.match(odeme, /installments\.js\?v=[\w-]+"><\/script>\s*<script defer src="\/assets\/js\/checkout\.js\?v=checkout-p11"/);
  assert.match(odeme, /kartınızın bankasına ve kart tipine bağlıdır/);
  assert.match(checkout, /installCount: totals\.installCount \|\| 1/);
  assert.match(checkout, /return applyInstallment\(applyCoupon\(summary\)\)/);
  assert.match(checkout, /Vade farkı \(/);
  assert.match(
    detail,
    /\{ id: "returns", label: "İade ve Cayma" \},\s*\{ id: "installments", label: "Taksit Seçenekleri" \},\s*\{ id: "reviews", label: "Değerlendirmeler" \},\s*\]/,
    "Değerlendirmeler sits right of Taksit Seçenekleri as the last detail tab"
  );
  assert.match(detail, /instPanel\.appendChild\(buildInstallmentTable\(gross\)\);/);
  assert.doesNotMatch(detail, /info\.appendChild\(installmentTable\)/, "installments live only in the tab");
  assert.match(detail, /label: "Tek çekim", monthly: gross, total: gross/);
  assert.match(detail, /kartınızın bankasına ve kart tipine bağlıdır/);
  assert.match(detail, /Şu anda yalnızca tek çekim ödeme sunulmaktadır\./);
  assert.match(detailHtml, /installments\.js\?v=/);
});

function renderInstallmentTab(settings, quoteRows, gross) {
  const detail = read("assets/js/urun-detay.js");
  const src = detail.match(/function buildInstallmentTable\(gross\) \{[\s\S]*?\n  \}/);
  assert.ok(src, "buildInstallmentTable bulunamadı");
  const node = (tag) => ({
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  });
  const el = (tag, className, text) => Object.assign(node(tag), { className: className || "", textContent: text || "" });
  const window = {
    PatygoInstallments: { settings, quote: () => quoteRows },
    PatygoCatalog: { formatPrice: (n) => "₺" + Number(n).toFixed(2) },
  };
  const build = new Function("el", "window", src[0] + "\nreturn buildInstallmentTable;")(el, window);
  const box = build(gross);
  const table = box.children[0].children[0];
  const rows = table.children[1].children.map((tr) => tr.children.map((td) => td.textContent));
  return { rows, note: box.children[1].textContent };
}

test("Taksit Seçenekleri tab: single payment row always, installment rows and honest note", () => {
  const off = renderInstallmentTab({ enabled: false, minAmount: 0 }, [], 1200);
  assert.deepEqual(off.rows, [["Tek çekim", "₺1200.00", "₺1200.00"]]);
  assert.match(off.note, /Şu anda yalnızca tek çekim ödeme sunulmaktadır\./);

  const on = renderInstallmentTab({ enabled: true, minAmount: 0 }, [{ count: 3, ratePercent: 5, total: 1260, monthly: 420 }], 1200);
  assert.deepEqual(on.rows, [
    ["Tek çekim", "₺1200.00", "₺1200.00"],
    ["3 taksit", "₺420.00", "₺1260.00"],
  ]);
  assert.match(on.note, /kartınızın bankasına ve kart tipine bağlıdır/);

  const belowMin = renderInstallmentTab({ enabled: true, minAmount: 2000 }, [], 1200);
  assert.equal(belowMin.rows.length, 1);
  assert.match(belowMin.note, /Taksit seçenekleri ₺2000\.00 ve üzeri tutarlarda sunulur\./);
});

test("pre-information form and distance sales contract disclose vade farkı", () => {
  assert.match(read("on-bilgilendirme-formu.html"), /vade farkı genel toplama eklenir/);
  assert.match(read("mesafeli-satis-sozlesmesi.html"), /Vade farkı satış bedeline eklenir/);
});

test("admin panel edits installment rates on the delivery page", () => {
  const html = read("admin.html");
  const panel = read("assets/js/admin-panel.js");
  assert.match(html, /id="adminInstallmentForm"/);
  assert.match(html, /id="installmentEnabled"/);
  assert.match(html, /id="installmentRateGrid"/);
  assert.match(panel, /api\("\/api\/admin\/installments\/settings"\)/);
  assert.match(panel, /method: "PUT"[\s\S]{0,80}JSON\.stringify\(values\)/);
  assert.match(panel, /INSTALLMENT_COUNTS = \[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12\]/);
  assert.match(panel, /loadAdminInstallmentSettings\(\)\.catch/);
  assert.match(panel, /inst\s*\?\s*\[\s*"Taksit",/);
});

test("installment API: admin rates drive payment amount and Akbank installCount", async (t) => {
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
    {
      products: [
        {
          id: "inst-test-item",
          brand: "TEST",
          name: "Taksit Test Ürünü",
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
          barcode: "8690000000456",
          manufacturerCode: "INST-TEST",
          gtipCode: "84.71.30.00.00.00",
          mainCategory: "KİŞİSEL BİLGİSAYARLAR",
          midCategory: "Taşınabilir Bilgisayarlar",
          subCategory: "Notebooklar",
          currency: "TRY",
          unit: "ADET",
        },
      ],
    }
  );

  const pubDefault = await (await fetch(baseUrl + "/api/installments")).json();
  assert.equal(pubDefault.enabled, false);
  assert.deepEqual(pubDefault.options, []);

  const unauth = await fetch(baseUrl + "/api/admin/installments/settings");
  assert.equal(unauth.status, 401);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const headers = {
    Authorization: "Bearer " + (await login.json()).token,
    "Content-Type": "application/json",
  };

  const bad = await fetch(baseUrl + "/api/admin/installments/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({ enabled: true, options: [] }),
  });
  assert.equal(bad.status, 422);

  const put = await fetch(baseUrl + "/api/admin/installments/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({ enabled: true, minAmount: 500, options: [{ count: 3, ratePercent: 5 }] }),
  });
  assert.equal(put.status, 200);

  const pub = await (await fetch(baseUrl + "/api/installments")).json();
  assert.equal(pub.enabled, true);
  assert.equal(pub.posReady, true);
  assert.deepEqual(pub.options, [{ count: 3, ratePercent: 5 }]);

  const startBody = (installCount) =>
    JSON.stringify({
      items: [{ productId: "inst-test-item", qty: 1 }],
      customer: {
        name: "Taksit Test",
        email: "inst@example.com",
        phone: "05555555555",
        billingAddress: "Test Mah. No:1 İstanbul",
        shippingAddress: "Test Mah. No:1 İstanbul",
      },
      contractsAccepted: true,
      kvkkAccepted: true,
      installCount,
    });

  const start = await fetch(baseUrl + "/api/payment/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: startBody(3),
  });
  assert.equal(start.status, 200);
  const started = await start.json();
  // 1000 net + %20 KDV = 1200; 3 taksit %5 vade farkı = 1260
  assert.equal(Number(started.fields.amount), 1260);
  assert.equal(started.fields.installCount, "3");

  const order = await (
    await fetch(
      baseUrl +
        "/api/payment/order?orderId=" +
        encodeURIComponent(started.orderId) +
        "&token=" +
        encodeURIComponent(started.orderAccessToken)
    )
  ).json();
  assert.equal(order.order.total, 1260);
  assert.equal(order.order.installment.count, 3);
  assert.equal(order.order.installment.surcharge, 60);

  const single = await (
    await fetch(baseUrl + "/api/payment/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: startBody(1),
    })
  ).json();
  assert.equal(Number(single.fields.amount), 1200);
  assert.equal(single.fields.installCount, "1");

  const notOffered = await fetch(baseUrl + "/api/payment/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: startBody(6),
  });
  assert.equal(notOffered.status, 422);
  assert.match((await notOffered.json()).error, /taksit seçeneği bu sipariş için geçerli değil/);
});
