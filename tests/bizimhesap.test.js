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
  normalizeInvoiceNumber,
  findIssuedInvoiceNumber,
  reconcileInvoiceAfterReversal,
  buildInvoiceFollowupMail,
  listCashiers,
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

test("invoice line names do not repeat a brand the supplier name already starts with", () => {
  const order = {
    ...sampleOrder,
    items: [
      { ...sampleOrder.items[0], brand: "GP", name: "GP G-Tech LR6 AA Pil" },
      { ...sampleOrder.items[0], brand: "Asus", name: "Monitör 24" },
    ],
  };
  const names = buildSalesInvoicePayload(order, { BIZIMHESAP_FIRM_ID: "F" }).details.map((row) => row.productName);
  assert.equal(names[0], "GP G-Tech LR6 AA Pil");
  assert.equal(names[1], "Asus Monitör 24");
});

test("sales invoice carries the cash account (CashId) only when configured", () => {
  const withCash = buildSalesInvoicePayload(sampleOrder, { BIZIMHESAP_FIRM_ID: "F", BIZIMHESAP_CASH_ID: "KASA-7" });
  assert.equal(withCash.CashId, "KASA-7");
  assert.equal(JSON.parse(JSON.stringify(withCash)).CashId, "KASA-7");
  const without = buildSalesInvoicePayload(sampleOrder, { BIZIMHESAP_FIRM_ID: "F" });
  assert.equal("CashId" in JSON.parse(JSON.stringify(without)), false);
});

test("listCashiers reads the cash accounts with the account token", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, async text() { return JSON.stringify({ error: "", data: [{ id: "K1", title: "Akbank POS" }] }); } };
  };
  const result = await listCashiers({ env: bhEnv, fetchImpl });
  assert.equal(result.ok, true);
  assert.match(calls[0].url, /\/cashiers$/);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Token, "T");
  assert.equal((await listCashiers({ env: {} })).reason, "not_configured");
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

test("normalizeInvoiceNumber accepts only GİB-format document numbers", () => {
  assert.equal(normalizeInvoiceNumber(" eft2026000000051 "), "EFT2026000000051");
  assert.equal(normalizeInvoiceNumber("GIB2026000000123"), "GIB2026000000123");
  assert.equal(normalizeInvoiceNumber("PTY-261006-D2A0C2"), "");
  assert.equal(normalizeInvoiceNumber("EFT202600000005"), "");
  assert.equal(normalizeInvoiceNumber("EFT1926000000051"), "");
  assert.equal(normalizeInvoiceNumber(""), "");
});

const lookupEnv = { BIZIMHESAP_FIRM_ID: "FIRM", BIZIMHESAP_API_KEY: "K", BIZIMHESAP_API_TOKEN: "T" };

function abstractApi(abstractRows, calls) {
  const customers = [
    { id: "C-OLD", code: "eski-kod", email: "ayse@example.com" },
    { id: "C-1", code: "Ayse@Example.com", email: "ayse@example.com" },
  ];
  return async (url, init) => {
    calls.push({ url, headers: init && init.headers });
    const body = url.endsWith("/customers")
      ? { resultCode: 1, errorText: "", data: { customers } }
      : url.endsWith("/abstract/C-1")
        ? { resultCode: 1, errorText: "", data: { abstract: abstractRows } }
        : { resultCode: 0, errorText: "Cari bulunamadı", data: null };
    return { ok: true, status: 200, async text() { return JSON.stringify(body); } };
  };
}

test("findIssuedInvoiceNumber reads the GİB number from the order's abstract row note", async () => {
  const calls = [];
  const rows = [
    { type: "Satış", trxdate: "06.10.2026", note: "PTY-BH-001 nolu sipariş", debit: "1.250,50" },
    { type: "Tahsilat", trxdate: "06.10.2026", note: "PTY-BH-001 EFT2026000000051 tahsilat", credit: "1.250,50" },
    { type: "Satış", trxdate: "01.10.2026", note: "PTY-BH-000 EFT2026000000049", debit: "10,00" },
  ];
  const found = await findIssuedInvoiceNumber(sampleOrder, { env: lookupEnv, fetchImpl: abstractApi(rows, calls) });
  assert.deepEqual(found, { found: true, invoiceNo: "EFT2026000000051", date: "06.10.2026" });
  assert.equal(calls[0].url, "https://bizimhesap.com/api/b2b/customers");
  assert.equal(calls[1].url, "https://bizimhesap.com/api/b2b/abstract/C-1");
  assert.equal(calls[1].headers.Token, "T");
});

test("findIssuedInvoiceNumber reports not issued, missing cari and API errors honestly", async () => {
  const draftOnly = [{ type: "Satış", trxdate: "06.10.2026", note: "PTY-BH-001 nolu sipariş" }];
  const otherOrder = [{ type: "Tahsilat", note: "PTY-BH-002 EFT2026000000052" }];
  assert.deepEqual(await findIssuedInvoiceNumber(sampleOrder, { env: lookupEnv, fetchImpl: abstractApi(draftOnly, []) }), {
    found: false,
    reason: "not_issued",
  });
  assert.equal(
    (await findIssuedInvoiceNumber(sampleOrder, { env: lookupEnv, fetchImpl: abstractApi(otherOrder, []) })).reason,
    "not_issued"
  );
  const stranger = Object.assign({}, sampleOrder, { customer: { email: "kimse@example.com" } });
  assert.equal(
    (await findIssuedInvoiceNumber(stranger, { env: lookupEnv, fetchImpl: abstractApi(draftOnly, []) })).reason,
    "customer_not_found"
  );
  assert.equal((await findIssuedInvoiceNumber(sampleOrder, { env: {} })).reason, "not_configured");
  const unauthorized = async () => ({ ok: false, status: 401, async text() { return '{"Message":"Authorization has been denied"}'; } });
  await assert.rejects(findIssuedInvoiceNumber(sampleOrder, { env: lookupEnv, fetchImpl: unauthorized }), /HTTP 401/);
  const errorText = async () => ({ ok: true, status: 200, async text() { return '{"resultCode":0,"errorText":"Yetkisiz","data":null}'; } });
  await assert.rejects(findIssuedInvoiceNumber(sampleOrder, { env: lookupEnv, fetchImpl: errorText }), /Yetkisiz/);
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
  const transfer = buildInvoiceFollowupMail({ orderId: "PTY-BH-001", action: "transfer_failed", error: "Token geçersiz" });
  assert.equal(transfer.subject, "BizimHesap aktarımı başarısız: PTY-BH-001");
  assert.match(transfer.text, /Token geçersiz/);
  assert.match(transfer.text, /BizimHesap'a aktar/);
  [failed.text, refund.text, transfer.text].forEach((text) => {
    assert.doesNotMatch(text, /Ayşe|ayse@example\.com|5320000001/);
  });
});
