"use strict";

const { sumReversedAmount } = require("./akbank-reversal");

const DEFAULT_API_BASE = "https://bizimhesap.com/api/b2b";
const INVOICE_PROVIDER = "bizimhesap_invoice";

function bizimhesapConfigured(env) {
  const source = env || process.env;
  return Boolean(
    String(source.BIZIMHESAP_FIRM_ID || "").trim() &&
      String(source.BIZIMHESAP_API_KEY || "").trim() &&
      String(source.BIZIMHESAP_API_TOKEN || "").trim()
  );
}

function authHeaders(env) {
  const source = env || process.env;
  return {
    Key: String(source.BIZIMHESAP_API_KEY || "").trim(),
    Token: String(source.BIZIMHESAP_API_TOKEN || "").trim(),
  };
}

function apiBase(env) {
  return String((env || process.env).BIZIMHESAP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

/** BizimHesap örneklerinde 2,400.00 biçimi kullanılıyor. */
function formatMoney(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function istanbulIsoNow(date) {
  const d = date instanceof Date ? date : new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value || "00";
  return (
    `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}+03:00`
  );
}

function customerAddress(customer) {
  const c = customer || {};
  const billing = c.billingAddress;
  const shipping = c.shippingAddress;
  if (typeof billing === "string" && billing.trim()) return billing.trim().slice(0, 500);
  if (typeof shipping === "string" && shipping.trim()) return shipping.trim().slice(0, 500);
  const ship = billing || shipping || {};
  if (typeof ship === "string") return ship.slice(0, 500);
  const parts = [ship.line1 || ship.address || ship.street, ship.district, ship.city, ship.postalCode].filter(
    Boolean
  );
  return parts.join(", ").slice(0, 500) || "Adres belirtilmedi";
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Vade farkı is part of the taxable base of what was sold, so it is split across the
// order's VAT rates by gross share; the rounding remainder lands on the largest group.
function installmentSurchargeRows(order, details) {
  const installment = order && order.installment;
  const surcharge = round2(installment && installment.surcharge);
  if (!(surcharge > 0)) return [];
  const grossByRate = new Map();
  details.forEach((row) => {
    const rate = Number(row.taxRate) || 0;
    const gross = Number(String(row.total).replace(/,/g, "")) || 0;
    grossByRate.set(rate, (grossByRate.get(rate) || 0) + gross);
  });
  const groups = Array.from(grossByRate.entries())
    .filter(([, gross]) => gross > 0)
    .sort((a, b) => b[1] - a[1]);
  const grossTotal = groups.reduce((sum, [, gross]) => sum + gross, 0);
  if (!groups.length || !(grossTotal > 0)) return [];
  const shares = groups.map(([, gross]) => round2((surcharge * gross) / grossTotal));
  shares[0] = round2(shares[0] + surcharge - shares.reduce((sum, value) => sum + value, 0));
  const label = "Vade farkı (" + Number(installment.count) + " taksit)";
  return groups
    .map(([rate], index) => {
      const share = shares[index];
      const net = round2(share / (1 + rate / 100));
      return {
        productId: "installment-surcharge-" + rate,
        productName: groups.length > 1 ? label + " %" + rate + " KDV" : label,
        taxRate: formatMoney(rate),
        quantity: 1,
        unitPrice: formatMoney(net),
        grossPrice: formatMoney(net),
        discount: "0.00",
        net: formatMoney(net),
        tax: formatMoney(round2(share - net)),
        total: formatMoney(share),
      };
    })
    .filter((row) => Number(String(row.total).replace(/,/g, "")) > 0);
}

// The coupon discount is baked into product line prices (gross share, remainder on the
// largest line) instead of BizimHesap's discount field, so row totals equal the charge.
function couponLineShares(items, discount) {
  const grosses = items.map((item) => (Number(item.line) || 0) + (Number(item.lineVat) || 0));
  const grossTotal = grosses.reduce((sum, value) => sum + value, 0);
  const amount = round2(discount);
  if (!(amount > 0) || !(grossTotal > 0)) return grosses.map(() => 0);
  const shares = grosses.map((gross) => round2((amount * gross) / grossTotal));
  let largest = 0;
  grosses.forEach((gross, index) => {
    if (gross > grosses[largest]) largest = index;
  });
  shares[largest] = round2(shares[largest] + amount - shares.reduce((sum, value) => sum + value, 0));
  return shares;
}

function invoiceProductName(item) {
  const brand = String(item.brand || "").trim();
  const name = String(item.name || "").trim();
  const named = brand && name.toLocaleLowerCase("tr-TR").startsWith(brand.toLocaleLowerCase("tr-TR") + " ");
  return (named ? name : [brand, name].filter(Boolean).join(" ")).slice(0, 200);
}

function buildSalesInvoicePayload(order, env) {
  const source = env || process.env;
  const now = istanbulIsoNow();
  const customer = (order && order.customer) || {};
  const items = Array.isArray(order && order.items) ? order.items : [];
  const coupon = order && order.coupon && Number(order.coupon.discount) > 0 ? order.coupon : null;
  const couponShares = couponLineShares(items, coupon ? coupon.discount : 0);
  const details = items.map((item, index) => {
    const qty = Number(item.qty) || 1;
    let lineNet = Number(item.line) || 0;
    let lineVat = Number(item.lineVat) || 0;
    const vatPercent =
      Number(item.vatPercent) || (lineNet > 0 ? Math.round((lineVat / lineNet) * 100) : 20);
    let gross = lineNet + lineVat;
    if (couponShares[index] > 0) {
      gross = round2(gross - couponShares[index]);
      lineNet = round2(gross / (1 + vatPercent / 100));
      lineVat = round2(gross - lineNet);
    }
    const unitNet = qty ? lineNet / qty : lineNet;
    const row = {
      productId: String(item.productId || "").slice(0, 80),
      productName: invoiceProductName(item),
      taxRate: formatMoney(vatPercent),
      quantity: qty,
      unitPrice: formatMoney(unitNet),
      grossPrice: formatMoney(lineNet),
      discount: "0.00",
      net: formatMoney(lineNet),
      tax: formatMoney(lineVat),
      total: formatMoney(gross),
    };
    if (item.barcode) row.barcode = String(item.barcode).slice(0, 80);
    return row;
  });
  const shippingFee = Number(order.shippingFee) || 0;
  if (shippingFee > 0) {
    const net = shippingFee / 1.2;
    const tax = shippingFee - net;
    details.push({
      productId: "shipping",
      productName: "Kargo bedeli",
      taxRate: "20.00",
      quantity: 1,
      unitPrice: formatMoney(net),
      grossPrice: formatMoney(net),
      discount: "0.00",
      net: formatMoney(net),
      tax: formatMoney(tax),
      total: formatMoney(shippingFee),
    });
  }
  details.push(...installmentSurchargeRows(order, details));
  const moneyOf = (value) => Number(String(value).replace(/,/g, "")) || 0;
  const subtotal = round2(details.reduce((sum, row) => sum + moneyOf(row.net), 0));
  const vat = round2(details.reduce((sum, row) => sum + moneyOf(row.tax), 0));
  const total = Number(order.total) || round2(subtotal + vat);
  const cashId = String(source.BIZIMHESAP_CASH_ID || "").trim();
  return {
    firmId: String(source.BIZIMHESAP_FIRM_ID || "").trim(),
    // Kasa ID: card payment is already collected, so the invoice is booked as paid into this cash account.
    CashId: cashId || undefined,
    invoiceNo: String(order.id || "").slice(0, 80),
    invoiceType: 3,
    note:
      "Patygo web siparişi " +
      String(order.id || "") +
      (coupon ? " — " + String(coupon.code || "") + " kuponu ile " + formatMoney(coupon.discount) + " TL indirim uygulandı" : ""),
    dates: {
      invoiceDate: now,
      dueDate: now,
      deliveryDate: now,
    },
    customer: {
      customerId: invoiceCustomerId(order),
      title: String(
        (customer.customerType === "kurumsal" && customer.company) || customer.name || customer.company || "Müşteri"
      ).slice(0, 200),
      email: String(customer.email || "").slice(0, 160),
      phone: String(customer.phone || "").slice(0, 40),
      address: customerAddress(customer),
      taxNo: String(customer.vkn || customer.taxNo || customer.taxId || "").slice(0, 20) || undefined,
      taxOffice: String(customer.taxOffice || "").slice(0, 120) || undefined,
    },
    amounts: {
      currency: "TL",
      gross: formatMoney(subtotal),
      discount: "0.00",
      net: formatMoney(subtotal),
      tax: formatMoney(vat),
      total: formatMoney(total),
    },
    details,
  };
}

function orderAllowsBizimHesapInvoice(order) {
  if (!order) return { ok: false, reason: "missing_order" };
  const status = String(order.status || "").trim();
  if (status === "cancelled" || status === "refunded") {
    return { ok: false, reason: "order_status_blocked", status };
  }
  if (status === "payment_failed" || status === "payment_pending") {
    return { ok: false, reason: "order_not_paid", status };
  }
  const paid = order.paymentTaken === true || order.paymentStatus === "paid";
  if (!paid) return { ok: false, reason: "order_not_paid", status };
  // The payload bills every original line; after a refund that would exceed what was kept.
  if (sumReversedAmount(order) > 0) return { ok: false, reason: "order_reversed", status };
  return { ok: true };
}

// GİB belge numarası: 3 karakter seri + 4 hane yıl + 9 hane sıra (ör. EFT2026000000051).
function normalizeInvoiceNumber(value) {
  const v = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{3}20\d{2}\d{9}$/.test(v) ? v : "";
}

/** BizimHesap stores the addinvoice customerId as the cari "code". */
function invoiceCustomerId(order) {
  const customer = (order && order.customer) || {};
  return String(customer.email || (order && order.id) || "").slice(0, 80);
}

async function getB2bData(path, env, fetchImpl) {
  const res = await fetchImpl(apiBase(env) + path, { method: "GET", headers: authHeaders(env) });
  const body = await parseBizimHesapResponse(res);
  const errorText = String(body.errorText || "").trim();
  if (errorText) throw new Error(errorText);
  return body.data || {};
}

async function listBizimHesapCustomers(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const data = await getB2bData("/customers", env, opts.fetchImpl || fetch);
  return Array.isArray(data.customers) ? data.customers : [];
}

/**
 * Issued e-invoice number for an order, read from the cari abstract: BizimHesap writes our order id
 * and, once the document is issued, its GİB number into the abstract row notes.
 */
async function findIssuedInvoiceNumber(order, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (!bizimhesapConfigured(env)) return { found: false, reason: "not_configured" };
  const orderId = String((order && order.id) || "").trim();
  const code = invoiceCustomerId(order).trim().toLowerCase();
  if (!orderId || !code) return { found: false, reason: "missing_customer" };
  const fetchImpl = opts.fetchImpl || fetch;
  const customers = opts.customers || (await listBizimHesapCustomers({ env, fetchImpl }));
  const cari = customers.find((row) => row && String(row.code || "").trim().toLowerCase() === code);
  if (!(cari && cari.id)) return { found: false, reason: "customer_not_found" };
  const data = await getB2bData("/abstract/" + encodeURIComponent(String(cari.id)), env, fetchImpl);
  const rows = Array.isArray(data.abstract) ? data.abstract : [];
  for (const row of rows) {
    const note = String((row && row.note) || "");
    if (!note.includes(orderId)) continue;
    for (const candidate of note.match(/\b[A-Z0-9]{3}20\d{11}\b/g) || []) {
      const invoiceNo = normalizeInvoiceNumber(candidate);
      if (invoiceNo) return { found: true, invoiceNo, date: String(row.trxdate || "").slice(0, 20) };
    }
  }
  return { found: false, reason: "not_issued" };
}

async function parseBizimHesapResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {}
  const error = String(data.error || "").trim();
  if (!res.ok || error) {
    throw new Error(error || "BizimHesap HTTP " + res.status);
  }
  return data;
}

async function pingBizimHesap(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (!bizimhesapConfigured(env)) {
    return { ok: false, reason: "not_configured" };
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(apiBase(env) + "/products", {
    method: "GET",
    headers: authHeaders(env),
  });
  try {
    await parseBizimHesapResponse(res);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "api_error", message: err.message || String(err) };
  }
}

async function listCashiers(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (!bizimhesapConfigured(env)) return { ok: false, reason: "not_configured" };
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(apiBase(env) + "/cashiers", { method: "GET", headers: authHeaders(env) });
  try {
    const data = await parseBizimHesapResponse(res);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: "api_error", message: err.message || String(err) };
  }
}

async function submitSalesInvoice(order, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (!bizimhesapConfigured(env)) {
    return { submitted: false, reason: "not_configured" };
  }
  if (!(order && order.paymentTaken) && order.paymentStatus !== "paid") {
    return { submitted: false, reason: "order_not_paid" };
  }
  const store = opts.store;
  const orderId = order && order.id;
  const fetchImpl = opts.fetchImpl || fetch;
  if (opts.force && store && orderId) {
    const existing =
      typeof store.getIntegration === "function" ? store.getIntegration(orderId, "bizimhesap_invoice") : null;
    if (existing && existing.guid) {
      try {
        await cancelSalesInvoice(existing.guid, { env, fetchImpl });
      } catch (_) {}
    }
    if (typeof store.releaseIntegration === "function") {
      store.releaseIntegration(orderId, "bizimhesap_invoice");
    }
  }
  let claimed = false;
  if (store && typeof store.claimIntegration === "function" && orderId) {
    claimed = store.claimIntegration(orderId, "bizimhesap_invoice");
    if (!claimed) {
      const existing =
        typeof store.getIntegration === "function" ? store.getIntegration(orderId, "bizimhesap_invoice") : null;
      return {
        submitted: false,
        reason: "already_submitted",
        orderId,
        guid: existing && existing.guid,
        url: existing && existing.url,
      };
    }
  }
  const payload = buildSalesInvoicePayload(order, env);
  try {
    const res = await fetchImpl(apiBase(env) + "/addinvoice", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(env)),
      body: JSON.stringify(payload),
    });
    const data = await parseBizimHesapResponse(res);
    if (store && typeof store.saveIntegrationRef === "function" && orderId) {
      store.saveIntegrationRef(orderId, "bizimhesap_invoice", {
        guid: data.guid || null,
        url: data.url || null,
      });
    }
    return {
      submitted: true,
      guid: data.guid || null,
      url: data.url || null,
      orderId,
    };
  } catch (err) {
    if (claimed && store && typeof store.releaseIntegration === "function" && orderId) {
      store.releaseIntegration(orderId, "bizimhesap_invoice");
    }
    throw err;
  }
}

async function cancelSalesInvoice(guid, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (!bizimhesapConfigured(env)) {
    return { cancelled: false, reason: "not_configured" };
  }
  const invoiceGuid = String(guid || "").trim();
  if (!invoiceGuid) return { cancelled: false, reason: "missing_guid" };
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(apiBase(env) + "/cancelinvoice", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(env)),
    body: JSON.stringify({
      firmId: String(env.BIZIMHESAP_FIRM_ID || "").trim(),
      guid: invoiceGuid,
    }),
  });
  const data = await parseBizimHesapResponse(res);
  // B2B API document: status is 0 on success, 1 on error.
  return {
    cancelled: !Number(data.status),
    status: data.status,
    error: data.error || "",
  };
}

const CANCEL_FAILURE_TEXT = {
  not_configured: "BizimHesap yapılandırılmamış",
  missing_guid: "Fatura GUID kaydı yok",
};

/**
 * A successful bank reversal on an invoiced order: a same-day void cancels the invoice in
 * BizimHesap; a card refund needs a return document from the accountant, so it is only recorded.
 */
async function reconcileInvoiceAfterReversal(input) {
  const opts = input || {};
  const store = opts.store;
  const orderId = String(opts.orderId || "").trim();
  const event = opts.event || {};
  if (!store || typeof store.getIntegration !== "function" || !orderId) return { action: "none" };
  const integration = store.getIntegration(orderId, INVOICE_PROVIDER);
  if (!integration || !integration.guid) return { action: "none" };
  const payload = Object.assign({}, integration.payload, { guid: integration.guid, url: integration.url });
  if (payload.cancel && payload.cancel.ok) return { action: "none" };
  const at = new Date().toISOString();

  if (event.type === "void" && opts.fully) {
    let cancel;
    try {
      const result = await cancelSalesInvoice(integration.guid, { env: opts.env, fetchImpl: opts.fetchImpl });
      cancel = result.cancelled
        ? { ok: true, at }
        : {
            ok: false,
            at,
            error: CANCEL_FAILURE_TEXT[result.reason] || result.error || "BizimHesap iptali onaylamadı",
          };
    } catch (err) {
      cancel = { ok: false, at, error: String((err && err.message) || err).slice(0, 300) };
    }
    store.saveIntegrationRef(orderId, INVOICE_PROVIDER, Object.assign(payload, { cancel }));
    return {
      action: cancel.ok ? "cancelled" : "cancel_failed",
      guid: integration.guid,
      error: cancel.error || null,
    };
  }

  const eventAt = String(event.at || at);
  const returns = Array.isArray(payload.returns) ? payload.returns.slice() : [];
  if (!returns.some((row) => row && row.eventAt === eventAt)) {
    returns.push({ eventAt, type: String(event.type || "refund"), amount: Number(event.amount) || 0, fully: Boolean(opts.fully) });
  }
  store.saveIntegrationRef(orderId, INVOICE_PROVIDER, Object.assign(payload, { returns }));
  return { action: "needs_return_document", guid: integration.guid, amount: Number(event.amount) || 0 };
}

function formatTl(amount) {
  return (Number(amount) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Owner alert when an invoice must be fixed by hand; carries no customer data. */
function buildInvoiceFollowupMail(input) {
  const opts = input || {};
  const orderId = String(opts.orderId || "");
  const base = String(opts.siteBase || "").replace(/\/+$/, "");
  const error = "Hata: " + String(opts.error || "bilinmiyor");
  const variants = {
    transfer_failed: {
      subject: "BizimHesap aktarımı başarısız: ",
      lead: "Ödemesi alınan sipariş BizimHesap'a otomatik aktarılamadı.",
      detail: error,
      todo: "Yapılacak: Panelde siparişin Fatura sekmesinden “BizimHesap'a aktar” ile tekrar deneyin.",
    },
    cancel_failed: {
      subject: "Fatura iptal edilemedi: ",
      lead: "Sipariş bankada iptal edildi ancak BizimHesap faturası otomatik iptal edilemedi.",
      detail: error,
      todo: "Yapılacak: BizimHesap panelinden bu faturayı iptal edin. e-Arşiv olarak gönderildiyse GİB iptalini de kontrol edin.",
    },
    needs_return_document: {
      subject: "İade belgesi gerekli: ",
      lead: "Faturası kesilmiş siparişte müşterinin kartına iade yapıldı.",
      detail: "İade tutarı: " + formatTl(opts.amount) + " TL",
      todo: "Yapılacak: Muhasebecinizle bu fatura için iade faturası / gider pusulası düzenleyin.",
    },
  };
  const variant = variants[opts.action] || variants.needs_return_document;
  const subject = variant.subject + orderId;
  const lines = [variant.lead, "", "Sipariş: " + orderId, variant.detail, "", variant.todo];
  if (base) lines.push("", "Panel: " + base + "/admin");
  return { subject, text: lines.join("\n") };
}

module.exports = {
  DEFAULT_API_BASE,
  reconcileInvoiceAfterReversal,
  buildInvoiceFollowupMail,
  bizimhesapConfigured,
  authHeaders,
  buildSalesInvoicePayload,
  submitSalesInvoice,
  cancelSalesInvoice,
  pingBizimHesap,
  listCashiers,
  customerAddress,
  formatMoney,
  orderAllowsBizimHesapInvoice,
  normalizeInvoiceNumber,
  invoiceCustomerId,
  listBizimHesapCustomers,
  findIssuedInvoiceNumber,
};
