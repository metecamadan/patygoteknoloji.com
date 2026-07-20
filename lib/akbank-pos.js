const crypto = require("crypto");

const PAYMENT_MODEL_HOSTING = "3D_PAY_HOSTING";
const TXN_SALE_3D = "3000";
const SUCCESS_CODE = "VPS-0000";

const ENDPOINTS = {
  test: {
    hosted: "https://virtualpospaymentgatewaypre.akbank.com/payhosting",
    securepay: "https://virtualpospaymentgatewaypre.akbank.com/securepay",
    api: "https://apipre.akbank.com/api/v1/payment/virtualpos/transaction/process",
  },
  live: {
    hosted: "https://virtualpospaymentgateway.akbank.com/payhosting",
    securepay: "https://virtualpospaymentgateway.akbank.com/securepay",
    api: "https://api.akbank.com/api/v1/payment/virtualpos/transaction/process",
  },
};

const CURRENCY_CODES = {
  TRY: 949,
  USD: 840,
  EUR: 978,
  GBP: 826,
  JPY: 392,
};

function hmacSha512Base64(data, secretKey) {
  return crypto.createHmac("sha512", String(secretKey)).update(String(data), "utf8").digest("base64");
}

function formatAmount(amount) {
  return (Math.round(Number(amount) * 100) / 100).toFixed(2);
}

function getCurrencyCode(currency) {
  if (typeof currency === "number" || /^\d+$/.test(String(currency))) {
    return Number(currency);
  }
  return CURRENCY_CODES[String(currency || "TRY").toUpperCase()] || 949;
}

function generateRandomNumber() {
  return crypto.randomBytes(64).toString("hex").toUpperCase();
}

function getRequestDateTime(date = new Date()) {
  // Akbank örnekleri Europe/Istanbul + sabit .000 kullanır
  const stamp = date
    .toLocaleString("sv-SE", { timeZone: "Europe/Istanbul", hour12: false })
    .replace(" ", "T");
  return stamp + ".000";
}

function truthyEnv(value) {
  const v = String(value == null ? "" : value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function createAkbankConfig(env) {
  const source = env || process.env;
  const merchantSafeId = String(source.AKBANK_MERCHANT_SAFE_ID || "").trim();
  const terminalSafeId = String(source.AKBANK_TERMINAL_SAFE_ID || "").trim();
  const secretKey = String(source.AKBANK_SECRET_KEY || "").trim();
  const paymentModel = String(source.AKBANK_PAYMENT_MODEL || PAYMENT_MODEL_HOSTING).trim() || PAYMENT_MODEL_HOSTING;
  const testMode =
    source.AKBANK_TEST_MODE == null || String(source.AKBANK_TEST_MODE).trim() === ""
      ? true
      : truthyEnv(source.AKBANK_TEST_MODE);
  const enabled = Boolean(merchantSafeId && terminalSafeId && secretKey);
  return {
    enabled,
    merchantSafeId,
    terminalSafeId,
    secretKey,
    paymentModel,
    testMode,
  };
}

function resolveEndpoints(config) {
  return config && config.testMode === false ? ENDPOINTS.live : ENDPOINTS.test;
}

/**
 * Akbank 3D hash alanı sırası (mews/pos AkbankPosCrypt ile uyumlu).
 * 3D_PAY_HOSTING için kart alanları boş string olarak hash'e girer.
 */
function buildHostedHashPlain(fields) {
  return [
    fields.paymentModel,
    fields.txnCode,
    fields.merchantSafeId,
    fields.terminalSafeId,
    fields.orderId,
    fields.lang,
    fields.amount,
    fields.ccbRewardAmount || "",
    fields.pcbRewardAmount || "",
    fields.xcbRewardAmount || "",
    fields.currencyCode,
    fields.installCount,
    fields.okUrl,
    fields.failUrl,
    fields.emailAddress || "",
    fields.subMerchantId || "",
    fields.creditCard || "",
    fields.expiredDate || "",
    fields.cvv || "",
    fields.randomNumber,
    fields.requestDateTime,
    fields.b2bIdentityNumber || "",
  ].join("");
}

function buildHostedPaymentForm(config, input) {
  if (!config || !config.merchantSafeId || !config.terminalSafeId || !config.secretKey) {
    throw new Error("Akbank POS kimlik bilgileri eksik.");
  }
  if (!input || !input.orderId || input.amount == null || !input.okUrl || !input.failUrl) {
    throw new Error("Ödeme formu için sipariş bilgileri eksik.");
  }

  const paymentModel = config.paymentModel || PAYMENT_MODEL_HOSTING;
  if (paymentModel !== PAYMENT_MODEL_HOSTING) {
    throw new Error("Bu entegrasyon yalnızca 3D_PAY_HOSTING modelini destekler.");
  }

  const fields = {
    paymentModel,
    txnCode: TXN_SALE_3D,
    merchantSafeId: String(config.merchantSafeId),
    terminalSafeId: String(config.terminalSafeId),
    orderId: String(input.orderId).slice(0, 64),
    lang: String(input.lang || "TR"),
    amount: formatAmount(input.amount),
    ccbRewardAmount: "0.00",
    pcbRewardAmount: "0.00",
    xcbRewardAmount: "0.00",
    currencyCode: String(getCurrencyCode(input.currency || "TRY")),
    installCount: String(Math.max(1, Number(input.installCount) || 1)),
    okUrl: String(input.okUrl),
    failUrl: String(input.failUrl),
    emailAddress: String(input.emailAddress || "").slice(0, 120),
    subMerchantId: String(input.subMerchantId || ""),
    randomNumber: String(input.randomNumber || generateRandomNumber()),
    requestDateTime: String(input.requestDateTime || getRequestDateTime()),
  };

  fields.hash = hmacSha512Base64(buildHostedHashPlain(fields), config.secretKey);

  return {
    method: "POST",
    action: resolveEndpoints(config).hosted,
    fields,
  };
}

function verifyCallbackHash(payload, secretKey) {
  if (!payload || !payload.hashParams || !payload.hash || !secretKey) return false;
  let plain = "";
  for (const param of String(payload.hashParams).split("+")) {
    if (!param) continue;
    plain += String(payload[param] == null ? "" : payload[param]);
  }
  const expected = hmacSha512Base64(plain, secretKey);
  const left = Buffer.from(String(payload.hash));
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isPaymentSuccess(payload) {
  return String((payload && payload.responseCode) || "") === SUCCESS_CODE;
}

function publicPosStatus(config) {
  return {
    enabled: Boolean(config && config.enabled),
    testMode: Boolean(config && config.testMode),
    paymentModel: (config && config.paymentModel) || PAYMENT_MODEL_HOSTING,
    provider: "akbank",
  };
}

module.exports = {
  PAYMENT_MODEL_HOSTING,
  TXN_SALE_3D,
  SUCCESS_CODE,
  hmacSha512Base64,
  formatAmount,
  getCurrencyCode,
  generateRandomNumber,
  getRequestDateTime,
  createAkbankConfig,
  resolveEndpoints,
  buildHostedHashPlain,
  buildHostedPaymentForm,
  verifyCallbackHash,
  isPaymentSuccess,
  publicPosStatus,
};
