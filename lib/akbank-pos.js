const crypto = require("crypto");

const PAYMENT_MODEL_HOSTING = "3D_PAY_HOSTING";
const TXN_SALE_3D = "3000";
const TXN_REFUND = "1002";
const TXN_VOID = "1003";
const TXN_ORDER_INQUIRY = "1010";
const API_VERSION = "1.00";
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

/** Kart / gizli alan — callback kaydına asla yazılmaz. */
const BANK_CALLBACK_DENY =
  /^(creditCard|cardNumber|pan|cvv|cvc|expiredDate|expireDate|expireMonth|expireYear|track2?|password|secret|secretKey|cavv|xid|dsTransId)$/i;

/**
 * Akbank callback’ten kanıt alanlarını allowlist + güvenli adlarla çıkarır.
 * PAN/CVV/secret tutulmaz; referans / auth / hostLog kanıt için saklanır.
 */
function sanitizeBankCallbackPayload(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  const out = {};
  const allowExact = new Set([
    "orderId",
    "merchantData",
    "responseCode",
    "responseMessage",
    "amount",
    "currency",
    "currencyCode",
    "authCode",
    "hostLogKey",
    "hostRefNum",
    "hostRefNumber",
    "rrn",
    "stan",
    "batchId",
    "batchNo",
    "txnResult",
    "transactionId",
    "transId",
    "procReturnCode",
    "mdStatus",
    "mdErrorMsg",
    "eci",
    "paymentModel",
    "txnCode",
    "merchantSafeId",
    "terminalSafeId",
    "installCount",
    "randomNumber",
    "requestDateTime",
    "hashParams",
    "hash",
    "maskedPan",
    "cardBrand",
  ]);
  for (const [rawKey, rawVal] of Object.entries(src)) {
    const key = String(rawKey || "").trim();
    if (!key || key.length > 64) continue;
    if (BANK_CALLBACK_DENY.test(key)) continue;
    const lower = key.toLowerCase();
    if (lower.includes("secret") || lower.includes("password") || lower.includes("cvv")) continue;
    const allowed =
      allowExact.has(key) ||
      /^(auth|host|ref|rrn|stan|batch|txn|trans|order|amount|currency|response|proc|md|eci|hash|mask)/i.test(
        key
      );
    if (!allowed) continue;
    if (rawVal == null) continue;
    const text = String(rawVal);
    if (!text) continue;
    out[key] = text.slice(0, key.toLowerCase() === "hash" ? 512 : 200);
  }
  return out;
}

/**
 * Hash/tutar/başarı koduna göre sipariş ödeme güncellemesi.
 * oncePaid: true ise asla failed’e düşmez.
 */
function decidePaymentFromBank(input) {
  const hashOk = Boolean(input && input.hashOk);
  const amountOk = Boolean(input && input.amountOk);
  const success = Boolean(input && input.success);
  const alreadyPaid = Boolean(input && input.alreadyPaid);

  if (!hashOk) {
    return { applyStatus: false, paid: false, outcome: "ignored_bad_hash" };
  }
  if (alreadyPaid) {
    return {
      applyStatus: false,
      paid: true,
      outcome: success && amountOk ? "already_paid_confirm" : "already_paid_keep",
    };
  }
  if (success && amountOk) {
    return { applyStatus: true, paid: true, outcome: "paid" };
  }
  if (success && !amountOk) {
    return { applyStatus: false, paid: false, outcome: "rejected_amount_mismatch" };
  }
  return { applyStatus: true, paid: false, outcome: "failed" };
}

function isTransactionSuccess(payload) {
  return String((payload && payload.responseCode) || "") === SUCCESS_CODE;
}

function hashJsonBody(jsonBody, secretKey) {
  return hmacSha512Base64(String(jsonBody || ""), secretKey);
}

function buildVoidRequestBody(config, input) {
  if (!config || !input || !input.orderId) {
    throw new Error("Void isteği için sipariş bilgisi eksik.");
  }
  return {
    terminal: {
      merchantSafeId: String(config.merchantSafeId),
      terminalSafeId: String(config.terminalSafeId),
    },
    version: API_VERSION,
    txnCode: TXN_VOID,
    requestDateTime: String(input.requestDateTime || getRequestDateTime()),
    randomNumber: String(input.randomNumber || generateRandomNumber()),
    order: { orderId: String(input.orderId).slice(0, 64) },
    customer: {
      ipAddress: String(input.clientIp || "127.0.0.1").slice(0, 45),
      emailAddress: String(input.emailAddress || "").slice(0, 120) || undefined,
    },
  };
}

function buildRefundRequestBody(config, input) {
  if (!config || !input || !input.orderId || input.amount == null) {
    throw new Error("Refund isteği için sipariş ve tutar gerekli.");
  }
  const body = {
    terminal: {
      merchantSafeId: String(config.merchantSafeId),
      terminalSafeId: String(config.terminalSafeId),
    },
    version: API_VERSION,
    txnCode: TXN_REFUND,
    requestDateTime: String(input.requestDateTime || getRequestDateTime()),
    randomNumber: String(input.randomNumber || generateRandomNumber()),
    order: { orderId: String(input.orderId).slice(0, 64) },
    transaction: {
      amount: formatAmount(input.amount),
      currencyCode: getCurrencyCode(input.currency || "TRY"),
    },
    customer: {
      ipAddress: String(input.clientIp || "127.0.0.1").slice(0, 45),
      emailAddress: String(input.emailAddress || "").slice(0, 120),
    },
  };
  if (!body.customer.emailAddress) delete body.customer.emailAddress;
  return body;
}

async function postTransactionRequest(config, body, fetchImpl) {
  if (!config || !config.secretKey) {
    throw new Error("Akbank POS kimlik bilgileri eksik.");
  }
  const fetchFn = fetchImpl || global.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("Fetch kullanılamıyor.");
  }
  const jsonBody = JSON.stringify(body);
  const authHash = hashJsonBody(jsonBody, config.secretKey);
  const url = resolveEndpoints(config).api;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout === "function"
      ? setTimeout(() => controller.abort(), 30000)
      : null;
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "auth-hash": authHash,
      },
      body: jsonBody,
      signal: controller ? controller.signal : undefined,
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (_) {
      parsed = { responseCode: "PARSE_ERROR", responseMessage: text.slice(0, 300) };
    }
    return {
      httpStatus: response.status,
      ok: response.ok,
      parsed,
      raw: text.slice(0, 4000),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Banka cevabı kesin değilse (ağ hatası, zaman aşımı, 5xx, okunamayan gövde) işlem bankada
 * gerçekleşmiş olabilir; sonuç işlem sorgulama (1010) ile netleşmeden yeniden denenmemelidir.
 */
function classifyTransactionResult(result) {
  if (!result || result.error) return "unknown";
  const parsed = result.parsed || {};
  if (isTransactionSuccess(parsed)) return "success";
  const code = String(parsed.responseCode || "");
  if (!code || code === "PARSE_ERROR") {
    return Number(result.httpStatus) >= 400 && Number(result.httpStatus) < 500 ? "declined" : "unknown";
  }
  return "declined";
}

async function attemptTransaction(config, type, body, fetchImpl) {
  let result;
  try {
    result = await postTransactionRequest(config, body, fetchImpl);
  } catch (err) {
    result = { error: (err && (err.name === "AbortError" ? "timeout" : err.message)) || "network_error" };
  }
  const outcome = classifyTransactionResult(result);
  return {
    type,
    success: outcome === "success",
    unknown: outcome === "unknown",
    httpStatus: result.httpStatus || null,
    error: result.error || null,
    response: result.parsed || null,
  };
}

async function executeBankReversal(config, plan, fetchImpl) {
  const attempts = [];
  if (plan.tryVoid) {
    const attempt = await attemptTransaction(config, "void", buildVoidRequestBody(config, plan), fetchImpl);
    attempts.push(attempt);
    if (attempt.success) {
      return { ok: true, method: "void", amount: plan.amount, attempts };
    }
    if (attempt.unknown) {
      return {
        ok: false,
        unknown: true,
        method: "void",
        amount: plan.amount,
        attempts,
        responseMessage: "Bankadan iptal sonucu alınamadı.",
      };
    }
  }
  if (plan.tryRefund) {
    const attempt = await attemptTransaction(config, "refund", buildRefundRequestBody(config, plan), fetchImpl);
    attempts.push(attempt);
    if (attempt.success) {
      return { ok: true, method: "refund", amount: plan.amount, attempts };
    }
    const last = attempt.response || {};
    return {
      ok: false,
      unknown: attempt.unknown,
      method: "refund",
      amount: plan.amount,
      attempts,
      responseCode: last.responseCode,
      responseMessage: attempt.unknown
        ? "Bankadan iade sonucu alınamadı."
        : last.responseMessage || "Banka iadesi reddedildi.",
    };
  }
  const lastAttempt = attempts[attempts.length - 1] || {};
  const lastResponse = lastAttempt.response || {};
  return {
    ok: false,
    method: lastAttempt.type || "void",
    amount: plan.amount,
    attempts,
    responseCode: lastResponse.responseCode,
    responseMessage: lastResponse.responseMessage || "Banka iptali reddedildi.",
  };
}

function buildOrderInquiryRequestBody(config, input) {
  if (!config || !input || !input.orderId) {
    throw new Error("İşlem sorgulama için sipariş numarası gerekli.");
  }
  return {
    terminal: {
      merchantSafeId: String(config.merchantSafeId),
      terminalSafeId: String(config.terminalSafeId),
    },
    version: API_VERSION,
    txnCode: TXN_ORDER_INQUIRY,
    requestDateTime: String(input.requestDateTime || getRequestDateTime()),
    randomNumber: String(input.randomNumber || generateRandomNumber()),
    order: { orderId: String(input.orderId).slice(0, 64) },
  };
}

/** txnStatus: N tamamlandı, V iptal edildi, R iade edildi, S hatalı. Kart numarası alınmaz. */
function mapInquiryTransactions(parsed) {
  const list = Array.isArray(parsed && parsed.txnDetailList) ? parsed.txnDetailList : [];
  return list.slice(0, 50).map((tx) => ({
    txnCode: String((tx && tx.txnCode) || ""),
    txnStatus: String((tx && tx.txnStatus) || ""),
    responseCode: String((tx && tx.responseCode) || ""),
    amount: tx && tx.amount != null && Number.isFinite(Number(tx.amount)) ? formatAmount(tx.amount) : null,
    txnDateTime: String((tx && tx.txnDateTime) || "").slice(0, 40),
    rrn: (tx && tx.rrn && String(tx.rrn).slice(0, 40)) || null,
    authCode: (tx && tx.authCode && String(tx.authCode).slice(0, 20)) || null,
  }));
}

/**
 * Bankadaki iptal/iade toplamı. Void satışın tamamını geri alır; refund kayıtları tutar toplanır.
 * Satış satırı R durumundaysa ve ayrı iade satırı yoksa tam iade kabul edilir.
 */
function summarizeInquiry(transactions, orderTotal) {
  const total = Number(orderTotal) || 0;
  const okRow = (tx) => tx.responseCode === SUCCESS_CODE || (!tx.responseCode && tx.txnStatus !== "S");
  const saleRows = transactions.filter((tx) => tx.txnCode === TXN_SALE_3D || tx.txnCode === "1000");
  const voided =
    transactions.some((tx) => tx.txnCode === TXN_VOID && okRow(tx)) ||
    saleRows.some((tx) => tx.txnStatus === "V");
  const refundRows = transactions.filter((tx) => tx.txnCode === TXN_REFUND && okRow(tx) && tx.txnStatus !== "V");
  let refunded = refundRows.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  if (!refundRows.length && saleRows.some((tx) => tx.txnStatus === "R")) refunded = total;
  refunded = Math.round(refunded * 100) / 100;
  return {
    saleFound: saleRows.some(okRow),
    voided,
    refundedAmount: formatAmount(refunded),
    reversedAmount: formatAmount(voided ? total : Math.min(refunded, total || refunded)),
  };
}

async function queryOrderTransactions(config, orderId, fetchImpl) {
  let result;
  try {
    result = await postTransactionRequest(config, buildOrderInquiryRequestBody(config, { orderId }), fetchImpl);
  } catch (err) {
    return {
      ok: false,
      unknown: true,
      error: (err && (err.name === "AbortError" ? "timeout" : err.message)) || "network_error",
    };
  }
  const parsed = result.parsed || {};
  if (!isTransactionSuccess(parsed)) {
    return {
      ok: false,
      unknown: classifyTransactionResult(result) === "unknown",
      httpStatus: result.httpStatus,
      responseCode: parsed.responseCode || null,
      responseMessage: parsed.responseMessage || "İşlem sorgulama başarısız.",
    };
  }
  return { ok: true, httpStatus: result.httpStatus, transactions: mapInquiryTransactions(parsed) };
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
  TXN_REFUND,
  TXN_VOID,
  TXN_ORDER_INQUIRY,
  API_VERSION,
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
  isTransactionSuccess,
  hashJsonBody,
  buildVoidRequestBody,
  buildRefundRequestBody,
  postTransactionRequest,
  executeBankReversal,
  classifyTransactionResult,
  buildOrderInquiryRequestBody,
  mapInquiryTransactions,
  summarizeInquiry,
  queryOrderTransactions,
  sanitizeBankCallbackPayload,
  decidePaymentFromBank,
  publicPosStatus,
};
