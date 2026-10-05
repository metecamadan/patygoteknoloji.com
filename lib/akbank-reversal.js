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

/** Son banka iade/iptal denemesinin sonucu bilinmiyorsa yeni deneme yapılmaz; önce işlem sorgulanır. */
function pendingReversal(order) {
  const events = (Array.isArray(order && order.paymentEvents) ? order.paymentEvents : []).filter(
    (ev) => ev && ev.kind === REVERSAL_EVENT_KIND && !ev.dryRun
  );
  const last = events[events.length - 1];
  return last && last.unknown === true ? last : null;
}

function isShipped(order) {
  return Boolean(order) && (order.status === "shipped" || order.status === "delivered");
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Kalem index’ine göre daha önce iade edilmiş adet. */
function refundedQtyByIndex(order) {
  const out = {};
  for (const ev of listReversalEvents(order)) {
    for (const row of Array.isArray(ev.items) ? ev.items : []) {
      const idx = Number(row && row.index);
      const qty = Number(row && row.qty);
      if (Number.isInteger(idx) && idx >= 0 && Number.isFinite(qty) && qty > 0) {
        out[idx] = (out[idx] || 0) + qty;
      }
    }
  }
  return out;
}

function shippingAlreadyRefunded(order) {
  return listReversalEvents(order).some((ev) => ev.shippingRefunded === true);
}

/**
 * Ödenen tutar = (ürünler KDV dahil − kupon + kargo) × taksit farkı.
 * Kalem iadesi bu oranları korur; kargo ancak açıkça seçilirse eklenir.
 */
function orderAmountFactors(order) {
  const items = Array.isArray(order && order.items) ? order.items : [];
  const merchandise =
    Number(order && order.merchandiseTotal) ||
    items.reduce((sum, it) => sum + (Number(it.line) || 0) + (Number(it.lineVat) || 0), 0);
  const discount = Number(order && order.coupon && order.coupon.discount) || 0;
  const shipping = Number(order && order.shippingFee) || 0;
  const base = merchandise - discount + shipping;
  const total = Number(order && order.total) || base;
  return {
    merchandise,
    couponFactor: merchandise > 0 ? Math.max(0, (merchandise - discount) / merchandise) : 1,
    installmentFactor: base > 0 ? total / base : 1,
    shipping,
  };
}

function computeItemsRefund(order, selections, includeShipping) {
  const items = Array.isArray(order && order.items) ? order.items : [];
  const already = refundedQtyByIndex(order);
  const factors = orderAmountFactors(order);
  const picked = [];
  let amount = 0;
  for (const row of Array.isArray(selections) ? selections.slice(0, 40) : []) {
    const index = Number(row && row.index);
    const qty = Math.floor(Number(row && row.qty));
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return { ok: false, reason: "invalid_item" };
    }
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const item = items[index];
    const bought = Math.max(1, Number(item.qty) || 1);
    const left = bought - (already[index] || 0);
    if (qty > left) return { ok: false, reason: "item_qty_exceeds_remaining" };
    const lineGross = (Number(item.line) || 0) + (Number(item.lineVat) || 0);
    amount += (lineGross / bought) * qty * factors.couponFactor * factors.installmentFactor;
    picked.push({ index, qty, productId: String(item.productId || "").slice(0, 80) });
  }
  let shippingRefunded = false;
  if (includeShipping && factors.shipping > 0 && !shippingAlreadyRefunded(order)) {
    amount += factors.shipping * factors.installmentFactor;
    shippingRefunded = true;
  }
  if (!picked.length && !shippingRefunded) return { ok: false, reason: "no_items_selected" };
  const pickedByIndex = {};
  for (const row of picked) pickedByIndex[row.index] = (pickedByIndex[row.index] || 0) + row.qty;
  const coversEverything =
    items.every((item, idx) => (already[idx] || 0) + (pickedByIndex[idx] || 0) >= Math.max(1, Number(item.qty) || 1)) &&
    (factors.shipping <= 0 || shippingRefunded || shippingAlreadyRefunded(order));
  return { ok: true, amount: round2(amount), items: picked, shippingRefunded, coversEverything };
}

function validateReversalRequest(order, input) {
  const mode = String((input && input.mode) || "").trim().toLowerCase();
  let action = String((input && input.action) || "auto").trim().toLowerCase();
  if (!order) return { ok: false, reason: "order_missing" };
  if (!orderPaid(order)) return { ok: false, reason: "not_paid" };
  if (!bankSuccessEvidence(order)) {
    return { ok: false, reason: "missing_bank_success_evidence" };
  }
  if (alreadyFullyReversed(order)) return { ok: false, reason: "already_reversed" };
  if (pendingReversal(order)) return { ok: false, reason: "reversal_pending_inquiry" };

  const remaining = remainingRefundableAmount(order);
  let amount = remaining;
  let items = [];
  let shippingRefunded = false;
  if (mode === "cancel") {
    if (isShipped(order)) return { ok: false, reason: "cancel_requires_unshipped" };
    if (sumReversedAmount(order) > 0.005) return { ok: false, reason: "cancel_after_partial_refund" };
    action = "auto";
  } else if (mode === "items") {
    const computed = computeItemsRefund(order, input.items, input.includeShipping === true);
    if (!computed.ok) return computed;
    items = computed.items;
    shippingRefunded = computed.shippingRefunded;
    amount = computed.coversEverything ? remaining : Math.min(computed.amount, remaining);
    action = "refund";
  }
  if (mode !== "cancel" && input && input.amount != null && String(input.amount).trim() !== "") {
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
    mode: mode || "manual",
    items,
    shippingRefunded,
  };
}

function reversalState(order, reversalConfig) {
  const pending = pendingReversal(order);
  return {
    reversal: publicBankReversalStatus(reversalConfig),
    reversedAmount: formatAmount(sumReversedAmount(order)),
    remainingAmount: formatAmount(remainingRefundableAmount(order)),
    refundedQty: refundedQtyByIndex(order),
    shippingRefunded: shippingAlreadyRefunded(order),
    pending: pending ? { at: pending.at, type: pending.type, amount: pending.amount } : null,
  };
}

function buildReversalPreview(order, reversalConfig, input) {
  const validation = validateReversalRequest(order, input);
  if (!validation.ok) {
    return Object.assign({ ok: false, reason: validation.reason }, reversalState(order, reversalConfig));
  }
  return Object.assign(
    {
      ok: true,
      plan: {
        action: validation.action,
        mode: validation.mode,
        amount: validation.amount,
        tryVoid: validation.tryVoid,
        tryRefund: validation.tryRefund,
        sameDay: validation.sameDay,
        fullAmount: validation.fullAmount,
        orderId: validation.orderId,
        clientIp: validation.clientIp,
        emailAddress: validation.emailAddress,
        currency: validation.currency,
        items: validation.items,
        shippingRefunded: validation.shippingRefunded,
      },
    },
    reversalState(order, reversalConfig),
    { remainingAmount: validation.remaining }
  );
}

function sanitizeReversalResponse(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  const nested = (key) => (raw[key] && typeof raw[key] === "object" ? raw[key] : {});
  // Akbank JSON cevabında authCode/rrn transaction{}, orderId order{} altında gelir.
  const src = Object.assign({}, nested("order"), nested("transaction"), raw);
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
    if (src[key] != null && typeof src[key] !== "object" && String(src[key]).trim()) {
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
    rrn: (input.response && input.response.rrn) || null,
    unknown: input.unknown === true,
    mode: input.mode ? String(input.mode).slice(0, 16) : undefined,
    items: Array.isArray(input.items) && input.items.length ? input.items : undefined,
    shippingRefunded: input.shippingRefunded === true || undefined,
    source: input.source ? String(input.source).slice(0, 16) : undefined,
    actorId: input.actorId || null,
  };
}

/** `order` yeni olay eklenmeden önceki hâlidir; `amount` bu işlemin tutarıdır. */
function orderPatchAfterSuccessfulReversal(order, amount) {
  const reversedTotal = round2(sumReversedAmount(order) + Number(amount));
  const total = Number(order.total);
  const fully = Number.isFinite(total) && reversedTotal >= total - 0.005;
  if (!fully) return {};
  return {
    status: isShipped(order) || order.status === "refunded" ? "refunded" : "cancelled",
    paymentStatus: "refunded",
    paymentTaken: false,
  };
}

/**
 * İşlem sorgulama (1010) sonucunu yerel kayıtla karşılaştırır.
 * Bankada kayıtlı olandan fazlası yereldeyse dokunmaz; eksikse fark için olay üretir.
 */
function reconcileFromInquiry(order, summary) {
  const local = sumReversedAmount(order);
  const bank = Number(summary && summary.reversedAmount) || 0;
  const diff = round2(bank - local);
  const pending = pendingReversal(order);
  if (diff > 0.005) {
    return {
      kind: "record_success",
      amount: formatAmount(diff),
      type: summary.voided ? "void" : "refund",
      items: pending && pending.items,
      shippingRefunded: pending && pending.shippingRefunded,
      mode: pending && pending.mode,
    };
  }
  if (pending) return { kind: "resolve_not_performed" };
  return { kind: "in_sync" };
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
  reconcileFromInquiry,
  pendingReversal,
  computeItemsRefund,
  refundedQtyByIndex,
  reversalState,
  sumReversedAmount,
  remainingRefundableAmount,
  alreadyFullyReversed,
  istanbulDayKey,
};
