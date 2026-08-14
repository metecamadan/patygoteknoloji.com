const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ORDER_MAIL_TEMPLATES,
  NOTIFY_STATUSES,
  buildOrderMail,
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
  customer: {
    name: "Ayşe Yılmaz",
    email: "ayse@example.com",
  },
  shippingCarrier: "Yurtiçi Kargo",
  trackingCode: "YK123456789",
};

test("order mail templates define paid, preparing and shipped", () => {
  assert.ok(ORDER_MAIL_TEMPLATES.paid);
  assert.ok(ORDER_MAIL_TEMPLATES.preparing);
  assert.ok(ORDER_MAIL_TEMPLATES.shipped);
  assert.equal(ORDER_MAIL_TEMPLATES.paid.subject, "Siparişiniz alındı");
  assert.equal(ORDER_MAIL_TEMPLATES.preparing.subject, "Siparişiniz hazırlanıyor");
  assert.equal(ORDER_MAIL_TEMPLATES.shipped.subject, "Siparişiniz kargoda");
});

test("paid template is a single short status notice with logo", () => {
  const mail = buildOrderMail(sampleOrder, "paid");
  assert.match(mail.text, /hazırlamaya başladığımızda/i);
  assert.match(mail.text, /PTY-TEST-001/);
  assert.match(mail.html, /https:\/\/patygoteknoloji\.com\/assets\/img\/patygo-logo\.png/);
  assert.match(mail.html, /Siparişiniz alındı/);
  assert.match(mail.html, /Patygo Teknoloji/);
});

test("shipped template includes carrier and tracking code", () => {
  const mail = buildOrderMail(sampleOrder, "shipped");
  assert.match(mail.text, /Yurtiçi Kargo/);
  assert.match(mail.text, /YK123456789/);
  assert.match(mail.html, /YK123456789/);
});

test("notify statuses include paid preparing shipped only", () => {
  assert.deepEqual([...NOTIFY_STATUSES].sort(), ["paid", "preparing", "shipped"].sort());
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
    items: [],
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
  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason, "already_notified");
  assert.equal(preparing.sent, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].subject, "Siparişiniz alındı");
  assert.equal(sent[1].subject, "Siparişiniz hazırlanıyor");
  assert.equal(store.hasStatusMail("PTY-MAIL-1", "paid"), true);
  resetDbForTests();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
});
