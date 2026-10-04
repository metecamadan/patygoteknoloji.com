/**
 * Akbank bank reversal (void/refund) eligibility and planning.
 * Tahsilat akışından bağımsız; yalnızca admin tetikler.
 */
const { formatAmount, SUCCESS_CODE } = require("./akbank-pos");

const REVERSAL_EVENT_KIND = "bank_reversal";

function truthyEnv(value) {
  const v = String(value == null ? "" : value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function createBankReversalConfig(env, akbankConfig) {
  const source = env || process.env;
  const enabled = truthyEnv(source.AKBANK_BANK_REVERSAL_ENABLED);
  const allowLive = truthyEnv(source.AKBANK_BANK_REVERSAL_LIVE);
  const testMode = Boolean(akbankConfig && akbankConfig.testMode);
  const posReady = Boolean(akbankConfig && akbankConfig.enabled);
  const canCallBank = Boolean(posReady && enabled && (testMode || allowLive));
  return {
    enabled,
    allowLive,
    testMode,
    posReady,
    canCallBank,
    mode: !enabled ? "disabled" : canCallBank ? (testMode ? "test_api" : "live_api") : "blocked_live",
  };
}

function publicBankReversalStatus(reversalConfig) {
  const cfg = reversalConfig || {};
  return {
    enabled: Boolean(cfg.enabled),
    canCallBank: Boolean(cfg.canCallBank),
    testMode: Boolean(cfg.testMode),
    liveAllowed: Boolean(cfg.allowLive),
    posReady: Boolean(cfg.posReady),
    mode: cfg.mode || "disabled",
  };
}

function istanbulDayKey(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function orderPaid(order) {
  return Boolean(
    order &&
      (order.paymentTaken || order.paymentStatus === "paid" || order.status === "paid")
  );
}

function bankSuccessEvidence(order) {
  const br = (order && order.bankResponse) || {};
  return String(br.responseCode || "") === SUCCESS_CODE && br.hashOk !== false;
}

function listReversalEvents(order) {
  return (Array.isArray(order && order.paymentEvents) ? order.paymentEvents : []).filter(
    (ev) => ev && ev.kind === REVERSAL_EVENT_KIND && ev.success === true && !ev.dryRun
  );
}

function sumReversedAmount(order) {
  return listReversalEvents(order).reduce((sum, ev) => {
    const n = Number(ev.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function remainingRefundableAmount(order) {
  const total = Number(order && order.total);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const left = Math.round((total - sumReversedAmount(order)) * 100) / 100;
  return left > 0 ? left : 0;
}

function alreadyFullyReversed(order) {
  return remainingRefundableAmount(order) <= 0.005;
}

function validateReversalRequest(order, input) {
  const action = String((input && input.action) || "auto").trim().toLowerCase();
  if (!order) return { ok: false, reason: "order_missing" };
  if (!orderPaid(order)) return { ok: false, reason: "not_paid" };
  if (!bankSuccessEvidence(order)) {
    return { ok: false, reason: "missing_bank_success_evidence" };
  }
  if (alreadyFullyReversed(order)) return { ok: false, reason: "already_reversed" };

  const remaining = remainingRefundableAmount(order);
  let amount = remaining;
  if (input && input.amount != null && String(input.amount).trim() !== "") {
    amount = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, reason: "invalid_amount" };
    }
    if (amount - remaining > 0.005) {
      return { ok: false, reason: "amount_exceeds_remaining" };
    }
  }

  const email = String((order.customer && order.customer.email) || "").trim();
  if (!email) return { ok: false, reason: "customer_email_required" };

  const paidAt = order.paidAt || order.updatedAt || order.createdAt;
  const sameDay = istanbulDayKey(paidAt) === istanbulDayKey(new Date().toISOString());
  const fullAmount = Math.abs(amount - remaining) <= 0.005;
  const shipped = order.status === "shipped" || order.status === "delivered";

  let tryVoid = false;
  let tryRefund = false;
  if (action === "void") {
    if (shipped) return { ok: false, reason: "shipped_use_refund_not_void" };
    if (!sameDay) return { ok: false, reason: "void_only_same_day" };
    if (!fullAmount) return { ok: false, reason: "void_requires_full_amount" };
    tryVoid = true;
  } else if (action === "refund") {
    tryRefund = true;
  } else {
    // auto: aynı gün tam tutar → önce void, olmazsa refund; kargoda yalnızca refund
    if (sameDay && fullAmount && !shipped) tryVoid = true;
    tryRefund = true;
  }

  return {
    ok: true,
    action,
    amount: formatAmount(amount),
    remaining: formatAmount(remaining),
    orderId: order.id,
    clientIp: String((input && input.clientIp) || "127.0.0.1").slice(0, 45),
    emailAddress: email.slice(0, 120),
    currency: order.currency || "TRY",
    tryVoid,
    tryRefund,
    sameDay,
    fullAmount,
  };
}

function buildReversalPreview(order, reversalConfig, input) {
  const validation = validateReversalRequest(order, input);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      reversal: publicBankReversalStatus(reversalConfig),
      reversedAmount: formatAmount(sumReversedAmount(order)),
      remainingAmount: formatAmount(remainingRefundableAmount(order)),
    };
  }
  return {
    ok: true,
    plan: {
      action: validation.action,
      amount: validation.amount,
      tryVoid: validation.tryVoid,
      tryRefund: validation.tryRefund,
      sameDay: validation.sameDay,
      orderId: validation.orderId,
      clientIp: validation.clientIp,
      emailAddress: validation.emailAddress,
      currency: validation.currency,
    },
    reversal: publicBankReversalStatus(reversalConfig),
    reversedAmount: formatAmount(sumReversedAmount(order)),
    remainingAmount: validation.remaining,
  };
}

function sanitizeReversalResponse(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  const out = {};
  for (const key of [
    "responseCode",
    "responseMessage",
    "orderId",
    "amount",
    "authCode",
    "hostRefNum",
    "hostRefNumber",
    "rrn",
    "transactionId",
    "txnCode",
  ]) {
    if (src[key] != null && String(src[key]).trim()) {
      out[key] = String(src[key]).slice(0, 200);
    }
  }
  return out;
}

function buildReversalEvent(input) {
  return {
    at: new Date().toISOString(),
    kind: REVERSAL_EVENT_KIND,
    type: String(input.type || "").slice(0, 16),
    amount: formatAmount(input.amount),
    success: Boolean(input.success),
    dryRun: Boolean(input.dryRun),
    responseCode: input.response && input.response.responseCode,
    responseMessage: input.response && input.response.responseMessage,
    hostRefNum:
      (input.response && (input.response.hostRefNum || input.response.hostRefNumber)) || null,
    authCode: (input.response && input.response.authCode) || null,
    actorId: input.actorId || null,
  };
}

function orderPatchAfterSuccessfulReversal(order, amount) {
  const reversedTotal =
    Math.round((sumReversedAmount(order) + Number(amount)) * 100) / 100;
  const total = Number(order.total);
  const fully = Number.isFinite(total) && reversedTotal >= total - 0.005;
  if (!fully) {
    return { reversedAmount: formatAmount(reversedTotal) };
  }
  return {
    status: "refunded",
    paymentStatus: "refunded",
    paymentTaken: false,
    reversedAmount: formatAmount(reversedTotal),
  };
}

module.exports = {
  REVERSAL_EVENT_KIND,
  createBankReversalConfig,
  publicBankReversalStatus,
  validateReversalRequest,
  buildReversalPreview,
  sanitizeReversalResponse,
  buildReversalEvent,
  orderPatchAfterSuccessfulReversal,
  sumReversedAmount,
  remainingRefundableAmount,
  alreadyFullyReversed,
  istanbulDayKey,
};
