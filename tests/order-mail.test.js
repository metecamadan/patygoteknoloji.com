const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ORDER_MAIL_TEMPLATES,
  NOTIFY_STATUSES,
  buildOrderMail,
  buildOrderSummaryText,
  sendOrderStatusMail,
  customerEmail,
  SHIPPING_CARRIERS,
} = require("../lib/order-mail");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");
const { deliverSimpleMail, SMTP_NOT_CONFIGURED } = require("../lib/contact");

const sampleOrder = {
  id: "PTY-TEST-001",
  total: 1250.5,
  merchandiseTotal: 1150.5,
  shippingFee: 100,
  customer: {
    name: "Ayşe Yılmaz",
    email: "ayse@example.com",
  },
  items: [
    {
      productId: "p1",
      brand: "Asus",
      name: "Monitör 24\"",
      qty: 1,
      line: 958.75,
      lineVat: 191.75,
    },
  ],
  shippingCarrier: "Yurtiçi Kargo",
  trackingCode: "YK123456789",
};

test("order mail templates define paid, preparing, shipped and cancelled", () => {
  assert.ok(ORDER_MAIL_TEMPLATES.paid);
  assert.ok(ORDER_MAIL_TEMPLATES.preparing);
  assert.ok(ORDER_MAIL_TEMPLATES.shipped);
  assert.ok(ORDER_MAIL_TEMPLATES.cancelled);
  assert.equal(ORDER_MAIL_TEMPLATES.paid.subject, "Siparişinizi Aldık");
  assert.equal(ORDER_MAIL_TEMPLATES.preparing.subject, "Siparişiniz hazırlanıyor");
  assert.equal(ORDER_MAIL_TEMPLATES.shipped.subject, "Siparişiniz kargoda");
  assert.equal(ORDER_MAIL_TEMPLATES.cancelled.subject, "Siparişiniz iptal edildi");
});

test("paid template includes order summary with line items", () => {
  const mail = buildOrderMail(sampleOrder, "paid");
  assert.match(mail.text, /hazırlamaya başladığımızda/i);
  assert.match(mail.text, /PTY-TEST-001/);
  assert.match(mail.text, /Sipariş özeti/);
  assert.match(mail.text, /Asus Monitör 24"/);
  assert.match(mail.text, /Genel toplam/);
  assert.match(mail.html, /https:\/\/patygoteknoloji\.com\/assets\/img\/patygo-logo\.png/);
  assert.match(mail.html, /Siparişinizi Aldık/);
  assert.match(mail.html, /Sipariş özeti/);
  assert.match(mail.html, /Asus Monitör 24&quot;/);
  assert.match(mail.html, /Patygo Teknoloji/);
});

test("cancelled template includes cancellation notice and order summary", () => {
  const mail = buildOrderMail(sampleOrder, "cancelled");
  assert.match(mail.text, /iptal edilmiştir/i);
  assert.match(mail.text, /Sipariş özeti/);
  assert.match(mail.text, /Genel toplam: ₺1\.250,50/);
  assert.match(mail.html, /Siparişiniz iptal edildi/);
  assert.match(mail.html, /Genel toplam/);
});

test("order summary text lists qty, merchandise, shipping and total", () => {
  const summary = buildOrderSummaryText(sampleOrder);
  assert.match(summary, /1× Asus Monitör 24"/);
  assert.match(summary, /Ürünler toplamı: ₺1\.150,50/);
  assert.match(summary, /Kargo: ₺100,00/);
  assert.match(summary, /Genel toplam: ₺1\.250,50/);
});

test("shipped template includes carrier and tracking code", () => {
  const mail = buildOrderMail(sampleOrder, "shipped");
  assert.match(mail.text, /Yurtiçi Kargo/);
  assert.match(mail.text, /YK123456789/);
  assert.match(mail.html, /YK123456789/);
  assert.match(mail.html, /Sipariş özeti/);
});

test("notify statuses include paid preparing shipped and cancelled", () => {
  assert.deepEqual([...NOTIFY_STATUSES].sort(), ["cancelled", "paid", "preparing", "shipped"].sort());
});

test("customerEmail normalizes address", () => {
  assert.equal(customerEmail(sampleOrder), "ayse@example.com");
  assert.equal(customerEmail({ customer: {} }), "");
});

test("shipping carriers list includes major Turkish carriers", () => {
  assert.ok(SHIPPING_CARRIERS.includes("Yurtiçi Kargo"));
  assert.ok(SHIPPING_CARRIERS.includes("Aras Kargo"));
  assert.ok(SHIPPING_CARRIERS.includes("MNG Kargo"));
});

test("deliverSimpleMail does not use FormSubmit when SMTP is missing", async () => {
  let called = false;
  await assert.rejects(
    () =>
      deliverSimpleMail(
        { to: "ayse@example.com", subject: "Test", text: "Merhaba" },
        {
          env: {},
          fetchImpl: async () => {
            called = true;
            return { ok: true, json: async () => ({ success: true }) };
          },
        }
      ),
    (err) => {
      assert.match(String(err && err.message), /SMTP yapılandırılmamış/);
      return true;
    }
  );
  assert.equal(called, false);
  assert.match(SMTP_NOT_CONFIGURED, /FormSubmit/);
});

test("same order status is mailed only once", async () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-order-mail-"));
  const store = createOrderStore(root);
  store.save({
    id: "PTY-MAIL-1",
    total: 100,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "A", email: "a@example.com" },
    items: [{ productId: "p1", name: "Ürün", qty: 1, line: 100, lineVat: 0 }],
    createdAt: new Date().toISOString(),
  });
  const sent = [];
  const first = await sendOrderStatusMail(store.get("PTY-MAIL-1"), "paid", {
    store,
    sendImpl: async (payload) => {
      sent.push(payload);
    },
  });
  const second = await sendOrderStatusMail(store.get("PTY-MAIL-1"), "paid", {
    store,
    sendImpl: async (payload) => {
      sent.push(payload);
    },
  });
  const preparing = await sendOrderStatusMail(store.get("PTY-MAIL-1"), "preparing", {
    store,
    sendImpl: async (payload) => {
      sent.push(payload);
    },
  });
  const cancelled = await sendOrderStatusMail(store.get("PTY-MAIL-1"), "cancelled", {
    store,
    sendImpl: async (payload) => {
      sent.push(payload);
    },
  });
  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason, "already_notified");
  assert.equal(preparing.sent, true);
  assert.equal(cancelled.sent, true);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].subject, "Siparişinizi Aldık");
  assert.equal(sent[1].subject, "Siparişiniz hazırlanıyor");
  assert.equal(sent[2].subject, "Siparişiniz iptal edildi");
  assert.equal(store.hasStatusMail("PTY-MAIL-1", "paid"), true);
  assert.equal(store.hasStatusMail("PTY-MAIL-1", "cancelled"), true);
  resetDbForTests();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});
