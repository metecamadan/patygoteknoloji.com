"use strict";

const DEFAULT_API_BASE = "https://bizimhesap.com/api/b2b";

function bizimhesapConfigured(env) {
  const source = env || process.env;
  return Boolean(
    String(source.BIZIMHESAP_FIRM_ID || "").trim() &&
      String(source.BIZIMHESAP_API_KEY || "").trim() &&
      String(source.BIZIMHESAP_API_TOKEN || "").trim()
  );
}

function formatMoney(amount) {
  return Number(amount || 0).toFixed(2);
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
  const ship = (customer && customer.shippingAddress) || (customer && customer.billingAddress) || {};
  const parts = [ship.line1 || ship.address || ship.street, ship.district, ship.city, ship.postalCode].filter(
    Boolean
  );
  return parts.join(", ").slice(0, 500) || "Adres belirtilmedi";
}

function buildSalesInvoicePayload(order, env) {
  const source = env || process.env;
  const now = istanbulIsoNow();
  const customer = (order && order.customer) || {};
  const items = Array.isArray(order && order.items) ? order.items : [];
  const details = items.map((item) => {
    const qty = Number(item.qty) || 1;
    const lineNet = Number(item.line) || 0;
    const lineVat = Number(item.lineVat) || 0;
    const unitNet = qty ? lineNet / qty : lineNet;
    const vatPercent =
      Number(item.vatPercent) || (lineNet > 0 ? Math.round((lineVat / lineNet) * 100) : 20);
    const gross = lineNet + lineVat;
    return {
      productId: String(item.productId || "").slice(0, 80),
      productName: [item.brand, item.name].filter(Boolean).join(" ").slice(0, 200),
      taxRate: formatMoney(vatPercent),
      quantity: qty,
      unitPrice: formatMoney(unitNet),
      grossPrice: formatMoney(lineNet),
      discount: "0.00",
      net: formatMoney(lineNet),
      tax: formatMoney(lineVat),
      total: formatMoney(gross),
    };
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
  const subtotal =
    Number(order.subtotal) ||
    details.reduce((sum, row) => sum + Number(row.net), 0);
  const vat =
    Number(order.vat) || details.reduce((sum, row) => sum + Number(row.tax), 0);
  const total = Number(order.total) || Math.round((subtotal + vat) * 100) / 100;
  return {
    firmId: String(source.BIZIMHESAP_FIRM_ID || "").trim(),
    invoiceNo: String(order.id || "").slice(0, 80),
    invoiceType: 3,
    note: "Patygo web siparişi " + String(order.id || ""),
    dates: {
      invoiceDate: now,
      dueDate: now,
      deliveryDate: now,
    },
    customer: {
      customerId: String(customer.email || order.id || "").slice(0, 80),
      title: String(customer.name || customer.company || "Müşteri").slice(0, 200),
      email: String(customer.email || "").slice(0, 160),
      phone: String(customer.phone || "").slice(0, 40),
      address: customerAddress(customer),
      taxNo: String(customer.vkn || customer.taxNo || "").slice(0, 20) || undefined,
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

async function submitSalesInvoice(order, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (!bizimhesapConfigured(env)) {
    return { submitted: false, reason: "not_configured" };
  }
  const store = opts.store;
  const orderId = order && order.id;
  let claimed = false;
  if (store && typeof store.claimIntegration === "function" && orderId) {
    claimed = store.claimIntegration(orderId, "bizimhesap_invoice");
    if (!claimed) {
      return { submitted: false, reason: "already_submitted", orderId };
    }
  }
  const payload = buildSalesInvoicePayload(order, env);
  const base = String(env.BIZIMHESAP_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await fetchImpl(base + "/addinvoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Key: String(env.BIZIMHESAP_API_KEY || "").trim(),
        Token: String(env.BIZIMHESAP_API_TOKEN || "").trim(),
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (_) {}
    const error = String(data.error || "").trim();
    if (!res.ok || error) {
      throw new Error(error || "BizimHesap HTTP " + res.status);
    }
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

module.exports = {
  DEFAULT_API_BASE,
  bizimhesapConfigured,
  buildSalesInvoicePayload,
  submitSalesInvoice,
};
