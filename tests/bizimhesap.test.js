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
  orderAllowsBizimHesapInvoice,
  fetchInvoicePdfAttachment,
  reconcileInvoiceAfterReversal,
  buildInvoiceFollowupMail,
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
  let addCount = 0;
  let cancelCount = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("cancelinvoice")) {
      cancelCount += 1;
      return {
        ok: true,
        async text() {
          return JSON.stringify({ error: "", status: "0" });
        },
      };
    }
    addCount += 1;
    return {
      ok: true,
      async text() {
        return JSON.stringify({ error: "", guid: "GUID-" + addCount, url: "https://bizimhesap.com/" + addCount });
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
  assert.equal(addCount, 2);
  assert.equal(cancelCount, 1);
});

test("orderAllowsBizimHesapInvoice blocks cancelled and unpaid", () => {
  assert.equal(orderAllowsBizimHesapInvoice(sampleOrder).ok, true);
  assert.equal(
    orderAllowsBizimHesapInvoice({ ...sampleOrder, status: "cancelled" }).ok,
    false
  );
  assert.equal(
    orderAllowsBizimHesapInvoice({
      ...sampleOrder,
      paymentTaken: false,
      paymentStatus: "payment_pending",
      status: "payment_pending",
    }).ok,
    false
  );
});

test("fetchInvoicePdfAttachment accepts PDF bytes", async () => {
  const pdfBytes = Buffer.from("%PDF-1.4 fake");
  const attachment = await fetchInvoicePdfAttachment("https://example.com/f.pdf", {
    filename: "fatura-x.pdf",
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => "application/pdf" },
      async arrayBuffer() {
        return pdfBytes;
      },
    }),
  });
  assert.ok(attachment);
  assert.equal(attachment.filename, "fatura-x.pdf");
  assert.equal(attachment.content.slice(0, 4).toString("utf8"), "%PDF");
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

test("cancelSalesInvoice treats a non-zero status as not cancelled", async () => {
  const result = await cancelSalesInvoice("GUID-X", {
    env: { BIZIMHESAP_FIRM_ID: "FIRM", BIZIMHESAP_API_KEY: "K", BIZIMHESAP_API_TOKEN: "T" },
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify({ error: "", status: 1 }); } }),
  });
  assert.equal(result.cancelled, false);
});

test("orderAllowsBizimHesapInvoice blocks an order with a bank refund", () => {
  const refunded = {
    ...sampleOrder,
    paymentEvents: [{ kind: "bank_reversal", type: "refund", success: true, amount: "100.00" }],
  };
  const allow = orderAllowsBizimHesapInvoice(refunded);
  assert.equal(allow.ok, false);
  assert.equal(allow.reason, "order_reversed");
});

const bhEnv = { BIZIMHESAP_FIRM_ID: "FIRM", BIZIMHESAP_API_KEY: "K", BIZIMHESAP_API_TOKEN: "T" };

function storeWithInvoice(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  resetDbForTests(root);
  const store = createOrderStore(root);
  store.claimIntegration("PTY-BH-001", "bizimhesap_invoice");
  store.saveIntegrationRef("PTY-BH-001", "bizimhesap_invoice", { guid: "GUID-1", url: "https://bizimhesap.com/x" });
  return store;
}

test("same-day void cancels the BizimHesap invoice once", async () => {
  const store = storeWithInvoice("patygo-bh-void-");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, async text() { return JSON.stringify({ error: "", status: 0 }); } };
  };
  const event = { type: "void", amount: "1250.50", at: "2026-10-06T10:00:00.000Z" };
  const first = await reconcileInvoiceAfterReversal({ store, orderId: "PTY-BH-001", event, fully: true, env: bhEnv, fetchImpl });
  assert.equal(first.action, "cancelled");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/cancelinvoice$/);
  assert.equal(calls[0].body.guid, "GUID-1");
  const saved = store.getIntegration("PTY-BH-001", "bizimhesap_invoice");
  assert.equal(saved.guid, "GUID-1");
  assert.equal(saved.url, "https://bizimhesap.com/x");
  assert.equal(saved.payload.cancel.ok, true);

  const again = await reconcileInvoiceAfterReversal({ store, orderId: "PTY-BH-001", event, fully: true, env: bhEnv, fetchImpl });
  assert.equal(again.action, "none");
  assert.equal(calls.length, 1);
});

test("failed invoice cancel is recorded with a readable reason", async () => {
  const store = storeWithInvoice("patygo-bh-void-fail-");
  const result = await reconcileInvoiceAfterReversal({
    store,
    orderId: "PTY-BH-001",
    event: { type: "void", amount: "1250.50", at: "2026-10-06T10:00:00.000Z" },
    fully: true,
    env: {},
  });
  assert.equal(result.action, "cancel_failed");
  assert.equal(result.error, "BizimHesap yapılandırılmamış");
  assert.equal(store.getIntegration("PTY-BH-001", "bizimhesap_invoice").payload.cancel.ok, false);
});

test("card refund on an invoiced order asks for a return document, once per bank event", async () => {
  const store = storeWithInvoice("patygo-bh-refund-");
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("BizimHesap must not be called for a refund");
  };
  const event = { type: "refund", amount: "300.00", at: "2026-10-07T09:00:00.000Z" };
  const opts = { store, orderId: "PTY-BH-001", event, fully: false, env: bhEnv, fetchImpl };
  const result = await reconcileInvoiceAfterReversal(opts);
  assert.equal(result.action, "needs_return_document");
  assert.equal(result.amount, 300);
  await reconcileInvoiceAfterReversal(opts);
  assert.equal(called, false);
  const saved = store.getIntegration("PTY-BH-001", "bizimhesap_invoice");
  assert.equal(saved.payload.returns.length, 1);
  assert.equal(saved.payload.returns[0].amount, 300);
});

test("reversal without an issued invoice does nothing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-bh-none-"));
  resetDbForTests(root);
  const store = createOrderStore(root);
  const result = await reconcileInvoiceAfterReversal({
    store,
    orderId: "PTY-BH-001",
    event: { type: "void", amount: "10.00" },
    fully: true,
    env: bhEnv,
  });
  assert.equal(result.action, "none");
});

test("invoice follow-up mail names the order and the action without customer data", () => {
  const failed = buildInvoiceFollowupMail({
    orderId: "PTY-BH-001",
    action: "cancel_failed",
    error: "BizimHesap HTTP 500",
    siteBase: "https://patygoteknoloji.com",
  });
  assert.equal(failed.subject, "Fatura iptal edilemedi: PTY-BH-001");
  assert.match(failed.text, /BizimHesap HTTP 500/);
  assert.match(failed.text, /https:\/\/patygoteknoloji\.com\/admin/);
  const refund = buildInvoiceFollowupMail({ orderId: "PTY-BH-001", action: "needs_return_document", amount: 300 });
  assert.equal(refund.subject, "İade belgesi gerekli: PTY-BH-001");
  assert.match(refund.text, /300,00 TL/);
  assert.match(refund.text, /iade faturası \/ gider pusulası/);
  [failed.text, refund.text].forEach((text) => {
    assert.doesNotMatch(text, /Ayşe|ayse@example\.com|5320000001/);
  });
});
