const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  bizimhesapConfigured,
  buildSalesInvoicePayload,
  submitSalesInvoice,
  cancelSalesInvoice,
  pingBizimHesap,
  customerAddress,
  formatMoney,
} = require("../lib/bizimhesap");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");

const sampleOrder = {
  id: "PTY-BH-001",
  paymentTaken: true,
  paymentStatus: "paid",
  subtotal: 958.75,
  vat: 191.75,
  shippingFee: 100,
  total: 1250.5,
  customer: {
    name: "Ayşe Yılmaz",
    email: "ayse@example.com",
    phone: "5320000001",
    billingAddress: "Örnek Mah. Deneme Sok. No:1, Kadıköy, İstanbul",
    shippingAddress: "Örnek Mah. Deneme Sok. No:1, Kadıköy, İstanbul",
  },
  items: [
    {
      productId: "p1",
      brand: "Asus",
      name: "Monitör 24",
      qty: 1,
      line: 958.75,
      lineVat: 191.75,
      vatPercent: 20,
    },
  ],
};

test("bizimhesapConfigured requires firm id, key and token", () => {
  assert.equal(bizimhesapConfigured({}), false);
  assert.equal(
    bizimhesapConfigured({
      BIZIMHESAP_FIRM_ID: "firm",
      BIZIMHESAP_API_KEY: "key",
      BIZIMHESAP_API_TOKEN: "token",
    }),
    true
  );
});

test("customerAddress prefers string billingAddress from checkout", () => {
  assert.match(
    customerAddress({ billingAddress: "Bağdat Cad. No:45 Kadıköy / İstanbul" }),
    /Kadıköy/
  );
});

test("formatMoney uses BizimHesap thousands separator", () => {
  assert.equal(formatMoney(2400), "2,400.00");
  assert.equal(formatMoney(958.75), "958.75");
});

test("buildSalesInvoicePayload maps paid order to BizimHesap sales invoice", () => {
  const payload = buildSalesInvoicePayload(sampleOrder, {
    BIZIMHESAP_FIRM_ID: "FIRM123",
  });
  assert.equal(payload.firmId, "FIRM123");
  assert.equal(payload.invoiceType, 3);
  assert.equal(payload.invoiceNo, "PTY-BH-001");
  assert.equal(payload.customer.title, "Ayşe Yılmaz");
  assert.equal(payload.customer.email, "ayse@example.com");
  assert.match(payload.customer.address, /İstanbul/);
  assert.equal(payload.details.length, 2);
  assert.equal(payload.details[0].productName, "Asus Monitör 24");
  assert.equal(payload.details[1].productName, "Kargo bedeli");
  assert.equal(payload.amounts.currency, "TL");
});

test("submitSalesInvoice skips when not configured", async () => {
  const result = await submitSalesInvoice(sampleOrder, { env: {} });
  assert.equal(result.submitted, false);
  assert.equal(result.reason, "not_configured");
});

test("submitSalesInvoice skips unpaid order", async () => {
  const unpaid = { ...sampleOrder, paymentTaken: false, paymentStatus: "payment_pending" };
  const result = await submitSalesInvoice(unpaid, {
    env: {
      BIZIMHESAP_FIRM_ID: "F",
      BIZIMHESAP_API_KEY: "K",
      BIZIMHESAP_API_TOKEN: "T",
    },
  });
  assert.equal(result.submitted, false);
  assert.equal(result.reason, "order_not_paid");
});

test("submitSalesInvoice posts invoice and stores integration ref once", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-bh-"));
  resetDbForTests(root);
  const store = createOrderStore(root);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      async text() {
        return JSON.stringify({ error: "", guid: "GUID-1", url: "https://bizimhesap.com/x" });
      },
    };
  };
  const env = {
    BIZIMHESAP_FIRM_ID: "FIRM123",
    BIZIMHESAP_API_KEY: "KEY",
    BIZIMHESAP_API_TOKEN: "TOKEN",
  };
  const first = await submitSalesInvoice(sampleOrder, { env, fetchImpl, store });
  assert.equal(first.submitted, true);
  assert.equal(first.guid, "GUID-1");
  assert.match(calls[0].url, /\/addinvoice$/);
  assert.equal(calls[0].init.headers.Key, "KEY");
  assert.equal(calls[0].init.headers.Token, "TOKEN");
  const saved = store.getIntegration("PTY-BH-001", "bizimhesap_invoice");
  assert.equal(saved.guid, "GUID-1");

  const second = await submitSalesInvoice(sampleOrder, { env, fetchImpl, store });
  assert.equal(second.submitted, false);
  assert.equal(second.reason, "already_submitted");
  assert.equal(second.guid, "GUID-1");
  assert.equal(calls.length, 1);
});

test("submitSalesInvoice force retries after claim", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-bh-force-"));
  resetDbForTests(root);
  const store = createOrderStore(root);
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return {
      ok: true,
      async text() {
        return JSON.stringify({ error: "", guid: "GUID-" + callCount, url: "https://bizimhesap.com/" + callCount });
      },
    };
  };
  const env = {
    BIZIMHESAP_FIRM_ID: "FIRM123",
    BIZIMHESAP_API_KEY: "KEY",
    BIZIMHESAP_API_TOKEN: "TOKEN",
  };
  await submitSalesInvoice(sampleOrder, { env, fetchImpl, store });
  const retry = await submitSalesInvoice(sampleOrder, { env, fetchImpl, store, force: true });
  assert.equal(retry.submitted, true);
  assert.equal(retry.guid, "GUID-2");
  assert.equal(callCount, 2);
});

test("pingBizimHesap calls products endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, async text() { return JSON.stringify({ error: "" }); } };
  };
  const result = await pingBizimHesap({
    env: { BIZIMHESAP_FIRM_ID: "F", BIZIMHESAP_API_KEY: "K", BIZIMHESAP_API_TOKEN: "T" },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.match(calls[0].url, /\/products$/);
});

test("cancelSalesInvoice posts guid to cancelinvoice", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: true, async text() { return JSON.stringify({ error: "", status: "0" }); } };
  };
  const result = await cancelSalesInvoice("GUID-X", {
    env: { BIZIMHESAP_FIRM_ID: "FIRM", BIZIMHESAP_API_KEY: "K", BIZIMHESAP_API_TOKEN: "T" },
    fetchImpl,
  });
  assert.equal(result.cancelled, true);
  assert.match(calls[0].url, /\/cancelinvoice$/);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.guid, "GUID-X");
  assert.equal(body.firmId, "FIRM");
});
