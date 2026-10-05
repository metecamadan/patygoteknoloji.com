const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createAkbankConfig,
  executeBankReversal,
  buildOrderInquiryRequestBody,
  summarizeInquiry,
  mapInquiryTransactions,
  queryOrderTransactions,
  TXN_ORDER_INQUIRY,
} = require("../lib/akbank-pos");
const {
  validateReversalRequest,
  computeItemsRefund,
  reconcileFromInquiry,
  pendingReversal,
  buildReversalEvent,
  sanitizeReversalResponse,
} = require("../lib/akbank-reversal");
const { createOrderStore, trimPaymentEvents } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");

const pos = createAkbankConfig({
  AKBANK_MERCHANT_SAFE_ID: "m1",
  AKBANK_TERMINAL_SAFE_ID: "t1",
  AKBANK_SECRET_KEY: "sk",
  AKBANK_TEST_MODE: "true",
});

function paidOrder(overrides) {
  return Object.assign(
    {
      id: "PTY-FLOW-1",
      total: 750,
      currency: "TRY",
      status: "paid",
      paymentStatus: "paid",
      paymentTaken: true,
      paidAt: new Date().toISOString(),
      customer: { name: "Ali", email: "ali@example.com" },
      items: [
        { productId: "a", name: "Kulaklık", qty: 2, line: 250, lineVat: 50 },
        { productId: "b", name: "Mouse", qty: 1, line: 125, lineVat: 25 },
      ],
      merchandiseTotal: 750,
      shippingFee: 0,
      bankResponse: { responseCode: "VPS-0000", hashOk: true },
      paymentEvents: [],
    },
    overrides || {}
  );
}

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      status: next.status || 200,
      ok: (next.status || 200) < 400,
      text: async () => (next.body == null ? "" : JSON.stringify(next.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

const plan = { orderId: "PTY-FLOW-1", amount: "750.00", currency: "TRY", tryVoid: true, tryRefund: true };

test("void timeout is unknown and never falls through to refund (double refund guard)", async () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  const fetchImpl = fakeFetch([abort]);
  const result = await executeBankReversal(pos, plan, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.unknown, true);
  assert.equal(fetchImpl.calls.length, 1, "belirsiz void sonrası refund denenmez");
  assert.equal(result.attempts[0].error, "timeout");
});

test("declined void falls back to refund; 5xx without body is unknown", async () => {
  const ok = fakeFetch([
    { status: 200, body: { responseCode: "VPS-1073", responseMessage: "Gün sonu yapılmış" } },
    { status: 200, body: { responseCode: "VPS-0000", transaction: { authCode: "A1", rrn: "R1" } } },
  ]);
  const okResult = await executeBankReversal(pos, plan, ok);
  assert.equal(okResult.ok, true);
  assert.equal(okResult.method, "refund");
  assert.deepEqual(ok.calls.map((c) => c.body.txnCode), ["1003", "1002"]);

  const gateway = fakeFetch([{ status: 502, body: null }]);
  const unknown = await executeBankReversal(pos, Object.assign({}, plan, { tryVoid: false }), gateway);
  assert.equal(unknown.unknown, true);

  const rejected = fakeFetch([{ status: 400, body: null }]);
  const declined = await executeBankReversal(pos, Object.assign({}, plan, { tryVoid: false }), rejected);
  assert.equal(declined.ok, false);
  assert.equal(declined.unknown, false, "4xx istek reddi kesin red sayılır");
});

test("order inquiry uses txnCode 1010 without customer data and maps statuses", async () => {
  const body = buildOrderInquiryRequestBody(pos, { orderId: "PTY-FLOW-1" });
  assert.equal(body.txnCode, TXN_ORDER_INQUIRY);
  assert.equal(body.txnCode, "1010");
  assert.deepEqual(body.order, { orderId: "PTY-FLOW-1" });
  assert.equal(body.customer, undefined);

  const txs = mapInquiryTransactions({
    txnDetailList: [
      { txnCode: "3000", txnStatus: "N", responseCode: "VPS-0000", amount: 750, maskedCardNumber: "4355****1234" },
      { txnCode: "1002", txnStatus: "N", responseCode: "VPS-0000", amount: 300 },
      { txnCode: "1002", txnStatus: "S", responseCode: "VPS-1999", amount: 999 },
    ],
  });
  assert.equal(txs[0].maskedCardNumber, undefined, "kart numarası saklanmaz");
  const summary = summarizeInquiry(txs, 750);
  assert.equal(summary.saleFound, true);
  assert.equal(summary.voided, false);
  assert.equal(summary.reversedAmount, "300.00");

  const voided = summarizeInquiry(
    mapInquiryTransactions({ txnDetailList: [{ txnCode: "3000", txnStatus: "V", responseCode: "VPS-0000", amount: 750 }] }),
    750
  );
  assert.equal(voided.voided, true);
  assert.equal(voided.reversedAmount, "750.00");

  const fetchImpl = fakeFetch([{ status: 200, body: { responseCode: "VPS-0000", txnDetailList: [] } }]);
  const out = await queryOrderTransactions(pos, "PTY-FLOW-1", fetchImpl);
  assert.equal(out.ok, true);
  assert.equal(fetchImpl.calls[0].body.txnCode, "1010");
  assert.ok(fetchImpl.calls[0].headers["auth-hash"]);
});

test("partial refund is counted once in the store; remaining stays refundable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-flow-"));
  resetDbForTests(dir);
  const store = createOrderStore(dir);
  store.save(paidOrder());
  const first = store.recordBankReversal("PTY-FLOW-1", {
    success: true,
    event: buildReversalEvent({ type: "refund", amount: "375.00", success: true }),
  });
  assert.equal(first.paymentStatus, "paid", "375/750 iade siparişi tam iade yapmaz");
  assert.equal(first.status, "paid");
  const next = validateReversalRequest(first, { action: "refund" });
  assert.equal(next.ok, true);
  assert.equal(next.amount, "375.00");
  const second = store.recordBankReversal("PTY-FLOW-1", {
    success: true,
    event: buildReversalEvent({ type: "refund", amount: "375.00", success: true }),
  });
  assert.equal(second.paymentStatus, "refunded");
  assert.equal(second.status, "cancelled");
});

test("unknown bank result blocks new reversal until inquiry resolves it", () => {
  const unknownEvent = buildReversalEvent({ type: "void", amount: "750.00", success: false, unknown: true });
  const order = paidOrder({ paymentEvents: [unknownEvent] });
  assert.ok(pendingReversal(order));
  assert.equal(validateReversalRequest(order, { mode: "cancel" }).reason, "reversal_pending_inquiry");

  const bankDidIt = reconcileFromInquiry(order, { saleFound: true, voided: true, reversedAmount: "750.00" });
  assert.equal(bankDidIt.kind, "record_success");
  assert.equal(bankDidIt.type, "void");
  assert.equal(bankDidIt.amount, "750.00");

  const bankDidNot = reconcileFromInquiry(order, { saleFound: true, voided: false, reversedAmount: "0.00" });
  assert.equal(bankDidNot.kind, "resolve_not_performed");

  const resolved = paidOrder({
    paymentEvents: [unknownEvent, buildReversalEvent({ type: "inquiry", amount: 0, success: false })],
  });
  assert.equal(pendingReversal(resolved), null);
  assert.equal(validateReversalRequest(resolved, { mode: "cancel" }).ok, true);
});

test("cancel mode: full amount, unshipped only, not after partial refund", () => {
  const ok = validateReversalRequest(paidOrder(), { mode: "cancel", amount: "1" });
  assert.equal(ok.ok, true);
  assert.equal(ok.amount, "750.00", "iptal her zaman kalan tutarın tamamıdır");
  assert.equal(ok.tryVoid, true);
  assert.equal(validateReversalRequest(paidOrder({ status: "shipped" }), { mode: "cancel" }).reason, "cancel_requires_unshipped");
  const partial = paidOrder({ paymentEvents: [buildReversalEvent({ type: "refund", amount: "100", success: true })] });
  assert.equal(validateReversalRequest(partial, { mode: "cancel" }).reason, "cancel_after_partial_refund");
});

test("item refund keeps coupon and installment ratios, tracks returned qty", () => {
  const order = paidOrder({
    status: "delivered",
    coupon: { code: "YAZ10", discount: 75 },
    shippingFee: 50,
    installment: { count: 3, total: 755.25 },
    total: 755.25,
  });
  // base = 750 - 75 + 50 = 725; installment factor = 755.25 / 725; coupon factor = 0.9
  const one = computeItemsRefund(order, [{ index: 0, qty: 1 }], false);
  assert.equal(one.ok, true);
  assert.equal(one.amount, Math.round(150 * 0.9 * (755.25 / 725) * 100) / 100);
  assert.equal(computeItemsRefund(order, [{ index: 0, qty: 3 }], false).reason, "item_qty_exceeds_remaining");
  assert.equal(computeItemsRefund(order, [{ index: 9, qty: 1 }], false).reason, "invalid_item");
  assert.equal(computeItemsRefund(order, [], false).reason, "no_items_selected");

  const plan1 = validateReversalRequest(order, { mode: "items", items: [{ index: 0, qty: 1 }] });
  assert.equal(plan1.ok, true);
  assert.equal(plan1.tryVoid, false);
  assert.deepEqual(plan1.items, [{ index: 0, qty: 1, productId: "a" }]);

  const after = Object.assign({}, order, {
    paymentEvents: [
      buildReversalEvent({ type: "refund", amount: plan1.amount, success: true, items: plan1.items }),
    ],
  });
  assert.equal(
    computeItemsRefund(after, [{ index: 0, qty: 2 }], false).reason,
    "item_qty_exceeds_remaining",
    "iade edilen adet tekrar iade edilemez"
  );
  const rest = validateReversalRequest(after, {
    mode: "items",
    items: [
      { index: 0, qty: 1 },
      { index: 1, qty: 1 },
    ],
    includeShipping: true,
  });
  assert.equal(rest.ok, true);
  assert.equal(rest.amount, rest.remaining, "son kalemler + kargo kalan tutarın tamamını kapatır");
  assert.equal(rest.shippingRefunded, true);
});

test("reversal response sanitizer reads nested Akbank transaction fields", () => {
  const out = sanitizeReversalResponse({
    responseCode: "VPS-0000",
    responseMessage: "Başarılı",
    order: { orderId: "PTY-FLOW-1" },
    transaction: { authCode: "123456", rrn: "999", amount: 750 },
  });
  assert.equal(out.authCode, "123456");
  assert.equal(out.rrn, "999");
  assert.equal(out.orderId, "PTY-FLOW-1");
});

test("payment event trimming never drops reversal events", () => {
  const events = [buildReversalEvent({ type: "refund", amount: "10", success: true })];
  for (let i = 0; i < 60; i++) events.push({ kind: "bank_callback", at: String(i) });
  const trimmed = trimPaymentEvents(events);
  assert.equal(trimmed.length, 40);
  assert.equal(trimmed[0].kind, "bank_reversal");
  assert.equal(trimmed[trimmed.length - 1].at, "59");
});
