const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBankReversalConfig,
  validateReversalRequest,
  buildReversalPreview,
  sumReversedAmount,
  remainingRefundableAmount,
  orderPatchAfterSuccessfulReversal,
  istanbulDayKey,
} = require("../lib/akbank-reversal");
const { createAkbankConfig } = require("../lib/akbank-pos");

function paidOrder(overrides) {
  return Object.assign(
    {
      id: "PTY-REV-1",
      total: 500,
      currency: "TRY",
      status: "paid",
      paymentStatus: "paid",
      paymentTaken: true,
      paidAt: new Date().toISOString(),
      customer: { name: "Ali", email: "ali@example.com" },
      bankResponse: { responseCode: "VPS-0000", hashOk: true },
      paymentEvents: [],
    },
    overrides || {}
  );
}

test("createBankReversalConfig gates live calls unless explicitly allowed", () => {
  const pos = createAkbankConfig({
    AKBANK_MERCHANT_SAFE_ID: "m1",
    AKBANK_TERMINAL_SAFE_ID: "t1",
    AKBANK_SECRET_KEY: "sk",
    AKBANK_TEST_MODE: "false",
  });
  const blocked = createBankReversalConfig(
    { AKBANK_BANK_REVERSAL_ENABLED: "true", AKBANK_BANK_REVERSAL_LIVE: "false" },
    pos
  );
  assert.equal(blocked.enabled, true);
  assert.equal(blocked.canCallBank, false);
  assert.equal(blocked.mode, "blocked_live");

  const allowed = createBankReversalConfig(
    {
      AKBANK_BANK_REVERSAL_ENABLED: "true",
      AKBANK_BANK_REVERSAL_LIVE: "true",
    },
    pos
  );
  assert.equal(allowed.canCallBank, true);
  assert.equal(allowed.mode, "live_api");

  const testCfg = createAkbankConfig({
    AKBANK_MERCHANT_SAFE_ID: "m1",
    AKBANK_TERMINAL_SAFE_ID: "t1",
    AKBANK_SECRET_KEY: "sk",
    AKBANK_TEST_MODE: "true",
  });
  const testRev = createBankReversalConfig({ AKBANK_BANK_REVERSAL_ENABLED: "true" }, testCfg);
  assert.equal(testRev.canCallBank, true);
  assert.equal(testRev.mode, "test_api");
});

test("validateReversalRequest requires paid order with bank success evidence", () => {
  assert.equal(validateReversalRequest(null, {}).reason, "order_missing");
  assert.equal(validateReversalRequest({ paymentStatus: "pending" }, {}).reason, "not_paid");
  assert.equal(
    validateReversalRequest(paidOrder({ bankResponse: null }), {}).reason,
    "missing_bank_success_evidence"
  );
  assert.equal(
    validateReversalRequest(paidOrder({ customer: { email: "" } }), {}).reason,
    "customer_email_required"
  );
});

test("auto plan tries void same day full amount, refund only when shipped", () => {
  const order = paidOrder();
  const auto = validateReversalRequest(order, { action: "auto" });
  assert.equal(auto.ok, true);
  assert.equal(auto.tryVoid, true);
  assert.equal(auto.tryRefund, true);

  const shipped = validateReversalRequest(paidOrder({ status: "shipped" }), { action: "auto" });
  assert.equal(shipped.ok, true);
  assert.equal(shipped.tryVoid, false);
  assert.equal(shipped.tryRefund, true);

  assert.equal(
    validateReversalRequest(paidOrder({ status: "shipped" }), { action: "void" }).reason,
    "shipped_use_refund_not_void"
  );
});

test("partial and cumulative reversal amounts are tracked", () => {
  const order = paidOrder({
    paymentEvents: [
      {
        kind: "bank_reversal",
        success: true,
        dryRun: false,
        amount: "200.00",
      },
    ],
  });
  assert.equal(sumReversedAmount(order), 200);
  assert.equal(remainingRefundableAmount(order), 300);
  const partial = validateReversalRequest(order, { action: "refund", amount: "150" });
  assert.equal(partial.ok, true);
  assert.equal(partial.amount, "150.00");

  const patch = orderPatchAfterSuccessfulReversal(order, 300);
  assert.equal(patch.status, "refunded");
  assert.equal(patch.paymentStatus, "refunded");
  assert.equal(patch.paymentTaken, false);
});

test("buildReversalPreview exposes public config without secrets", () => {
  const pos = createAkbankConfig({
    AKBANK_MERCHANT_SAFE_ID: "m1",
    AKBANK_TERMINAL_SAFE_ID: "t1",
    AKBANK_SECRET_KEY: "sk",
    AKBANK_TEST_MODE: "true",
  });
  const cfg = createBankReversalConfig({ AKBANK_BANK_REVERSAL_ENABLED: "false" }, pos);
  const preview = buildReversalPreview(paidOrder(), cfg, { action: "auto" });
  assert.equal(preview.ok, true);
  assert.equal(preview.reversal.enabled, false);
  assert.equal(preview.reversal.canCallBank, false);
  assert.ok(!("secretKey" in preview.reversal));
});

test("istanbulDayKey uses Europe/Istanbul calendar day", () => {
  const key = istanbulDayKey("2026-08-31T21:30:00.000Z");
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});
