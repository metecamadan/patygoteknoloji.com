const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  bizimhesapConfigured,
  buildSalesInvoicePayload,
  submitSalesInvoice,
} = require("../lib/bizimhesap");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");

const sampleOrder = {
  id: "PTY-BH-001",
  subtotal: 958.75,
  vat: 191.75,
  shippingFee: 100,
  total: 1250.5,
  customer: {
    name: "Ayşe Yılmaz",
    email: "ayse@example.com",
    phone: "5320000001",
    shippingAddress: {
      line1: "Örnek Mah. Deneme Sok. No:1",
      district: "Kadıköy",
      city: "İstanbul",
    },
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

  const second = await submitSalesInvoice(sampleOrder, { env, fetchImpl, store });
  assert.equal(second.submitted, false);
  assert.equal(second.reason, "already_submitted");
  assert.equal(calls.length, 1);
});
