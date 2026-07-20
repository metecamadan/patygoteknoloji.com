const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  hmacSha512Base64,
  formatAmount,
  getCurrencyCode,
  buildHostedPaymentForm,
  verifyCallbackHash,
  isPaymentSuccess,
  resolveEndpoints,
  createAkbankConfig,
} = require("../lib/akbank-pos");

test("HMAC-SHA512 base64 matches known vector", () => {
  const expected = crypto.createHmac("sha512", "secret").update("payload", "utf8").digest("base64");
  assert.equal(hmacSha512Base64("payload", "secret"), expected);
});

test("formatAmount and currency helpers", () => {
  assert.equal(formatAmount(10), "10.00");
  assert.equal(formatAmount("99.5"), "99.50");
  assert.equal(getCurrencyCode("TRY"), 949);
  assert.equal(getCurrencyCode(840), 840);
});

test("createAkbankConfig reads env and reports enabled only with all keys", () => {
  assert.equal(
    createAkbankConfig({
      AKBANK_MERCHANT_SAFE_ID: "m1",
      AKBANK_TERMINAL_SAFE_ID: "t1",
      AKBANK_SECRET_KEY: "",
    }).enabled,
    false
  );
  const cfg = createAkbankConfig({
    AKBANK_MERCHANT_SAFE_ID: "m1",
    AKBANK_TERMINAL_SAFE_ID: "t1",
    AKBANK_SECRET_KEY: "sk",
    AKBANK_TEST_MODE: "true",
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.testMode, true);
  assert.equal(cfg.paymentModel, "3D_PAY_HOSTING");
});

test("buildHostedPaymentForm hashes fields in documented order", () => {
  const form = buildHostedPaymentForm(
    {
      merchantSafeId: "merchant-1",
      terminalSafeId: "terminal-1",
      secretKey: "test-secret",
      testMode: true,
      paymentModel: "3D_PAY_HOSTING",
    },
    {
      orderId: "PTY-TEST-001",
      amount: 1234.5,
      currency: "TRY",
      okUrl: "https://example.com/ok",
      failUrl: "https://example.com/fail",
      emailAddress: "musteri@example.com",
      randomNumber: "a".repeat(128),
      requestDateTime: "2026-07-20T12:00:00.000",
    }
  );

  assert.equal(form.action, "https://virtualpospaymentgatewaypre.akbank.com/payhosting");
  assert.equal(form.fields.paymentModel, "3D_PAY_HOSTING");
  assert.equal(form.fields.txnCode, "3000");
  assert.equal(form.fields.amount, "1234.50");
  assert.equal(form.fields.currencyCode, "949");
  assert.ok(!("creditCard" in form.fields));

  const withoutHash = { ...form.fields };
  delete withoutHash.hash;
  const expected = hmacSha512Base64(Object.values(withoutHash).join(""), "test-secret");
  assert.equal(form.fields.hash, expected);
});

test("verifyCallbackHash uses bank hashParams order", () => {
  const secret = "callback-secret";
  const payload = {
    orderId: "PTY-1",
    responseCode: "VPS-0000",
    amount: "10.00",
    hashParams: "orderId+responseCode+amount",
  };
  payload.hash = hmacSha512Base64("PTY-1VPS-000010.00", secret);
  assert.equal(verifyCallbackHash(payload, secret), true);
  assert.equal(isPaymentSuccess(payload), true);

  payload.hash = "tampered";
  assert.equal(verifyCallbackHash(payload, secret), false);
});

test("resolveEndpoints switches test and live hosting URLs", () => {
  assert.equal(
    resolveEndpoints({ testMode: true, paymentModel: "3D_PAY_HOSTING" }).hosted,
    "https://virtualpospaymentgatewaypre.akbank.com/payhosting"
  );
  assert.equal(
    resolveEndpoints({ testMode: false, paymentModel: "3D_PAY_HOSTING" }).hosted,
    "https://virtualpospaymentgateway.akbank.com/payhosting"
  );
});
