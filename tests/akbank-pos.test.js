const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  hmacSha512Base64,
  formatAmount,
  getCurrencyCode,
  buildHostedPaymentForm,
  buildHostedHashPlain,
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

test("buildHostedPaymentForm uses Akbank 3D hash field order", () => {
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
      randomNumber: "A".repeat(128),
      requestDateTime: "2026-07-20T12:00:00.000",
    }
  );

  assert.equal(form.action, "https://virtualpospaymentgatewaypre.akbank.com/payhosting");
  assert.equal(form.fields.paymentModel, "3D_PAY_HOSTING");
  assert.equal(form.fields.txnCode, "3000");
  assert.equal(form.fields.amount, "1234.50");
  assert.equal(form.fields.currencyCode, "949");
  assert.ok(!("creditCard" in form.fields));
  assert.ok(!("mobilePhone" in form.fields));

  const expected = hmacSha512Base64(buildHostedHashPlain(form.fields), "test-secret");
  assert.equal(form.fields.hash, expected);
});

test("buildHostedHashPlain matches published Akbank 3D secure vector", () => {
  // Kaynak: mews/pos AkbankPosCryptTest (açık test verisi)
  const secret =
    "3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f";
  const fields = {
    paymentModel: "3D",
    txnCode: "3000",
    merchantSafeId: "2023090417500272654BD9A49CF07574",
    terminalSafeId: "2023090417500284633D137A249DBBEB",
    orderId: "20240404A4B0",
    lang: "TR",
    amount: "1.01",
    ccbRewardAmount: "1.00",
    pcbRewardAmount: "1.00",
    xcbRewardAmount: "1.00",
    currencyCode: "949",
    installCount: "1",
    okUrl: "http://localhost/akbankpos/3d/response.php",
    failUrl: "http://localhost/akbankpos/3d/response.php",
    emailAddress: "test@test.com",
    subMerchantId: "",
    creditCard: "4355093000315232",
    expiredDate: "1135",
    cvv: "665",
    randomNumber:
      "AEDDD8688E11A3DC588DAB2ED59B2F64D45E798761CEFF17F4DB47581072697890180C4195986250F89C2C67A04A3B96F0AC66AE99B49BB7BEE618FBD621C4CD",
    requestDateTime: "2024-04-04T21:11:41.000",
    b2bIdentityNumber: "",
  };
  const hash = hmacSha512Base64(buildHostedHashPlain(fields), secret);
  assert.equal(hash, "ilR2mCExklKEti+2x61A8pcOfzJ5z5M6xMYmmU8ClaKaDuxKooFuH3v7XW/ba25xlTDqGN1H//i0zTiJl5YnfA==");
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
