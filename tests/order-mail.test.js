const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ORDER_MAIL_TEMPLATES,
  NOTIFY_STATUSES,
  buildOrderMail,
  customerEmail,
  SHIPPING_CARRIERS,
} = require("../lib/order-mail");

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
  assert.equal(ORDER_MAIL_TEMPLATES.paid.subject, "Siparişini Aldık!");
  assert.equal(ORDER_MAIL_TEMPLATES.preparing.subject, "Siparişiniz Hazırlanıyor");
  assert.equal(ORDER_MAIL_TEMPLATES.shipped.subject, "Siparişiniz Kargoya Verildi");
});

test("paid template mentions preparation and notification", () => {
  const mail = buildOrderMail(sampleOrder, "paid");
  assert.match(mail.text, /hazırlanıyor/i);
  assert.match(mail.text, /mail üzerinden bilgilendirme/i);
  assert.match(mail.text, /PTY-TEST-001/);
});

test("shipped template includes carrier and tracking code", () => {
  const mail = buildOrderMail(sampleOrder, "shipped");
  assert.match(mail.text, /Yurtiçi Kargo/);
  assert.match(mail.text, /YK123456789/);
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
