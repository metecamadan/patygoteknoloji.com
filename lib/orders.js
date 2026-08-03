const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDb } = require("./db");
const { resolvePeriodRange } = require("./analytics");

const ORDER_STATUSES = new Set([
  "payment_pending",
  "paid",
  "payment_failed",
  "preparing",
  "shipped",
  "cancelled",
  "refunded",
]);

function rowToOrder(db, row) {
  if (!row) return null;
  const items = db
    .prepare(
      `SELECT product_id AS productId, brand, name, unit_price AS unitPrice,
              vat_percent AS vatPercent, qty, line_net AS line, line_vat AS lineVat
       FROM order_items WHERE order_id = ?`
    )
    .all(row.id);
  let customer = {};
  let contractsAccepted = null;
  let bankResponse = null;
  try {
    customer = JSON.parse(row.customer_json || "{}");
  } catch (_) {}
  try {
    contractsAccepted = row.contracts_json ? JSON.parse(row.contracts_json) : null;
  } catch (_) {}
  try {
    bankResponse = row.bank_response_json ? JSON.parse(row.bank_response_json) : null;
  } catch (_) {}
  return {
    id: row.id,
    customerId: row.customer_id || null,
    items,
    subtotal: row.subtotal,
    vat: row.vat,
    total: row.total,
    currency: row.currency || "TRY",
    customer,
    contractsAccepted,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentTaken: Boolean(row.payment_taken),
    provider: row.provider || "akbank",
    bankResponse,
    legalHold: Boolean(row.legal_hold),
    anonymizedAt: row.anonymized_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    paidAt: row.paid_at || null,
  };
}

function upsertCustomer(db, customer) {
  const email = String((customer && customer.email) || "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
  const phone = String((customer && customer.phone) || "").trim().slice(0, 40);
  if (!email) return null;
  const existing = db.prepare("SELECT id FROM customers WHERE email = ? LIMIT 1").get(email);
  const now = new Date().toISOString();
  const billing = customer.billingAddress
    ? JSON.stringify(customer.billingAddress)
    : customer.billingAddressJson || null;
  const shipping = customer.shippingAddress
    ? JSON.stringify(customer.shippingAddress)
    : customer.shippingAddressJson || null;
  if (existing) {
    db.prepare(
      `UPDATE customers SET full_name=?, company=?, phone=?, tax_id=?,
        billing_address=COALESCE(?, billing_address),
        shipping_address=COALESCE(?, shipping_address),
        updated_at=? WHERE id=?`
    ).run(
      String(customer.name || customer.fullName || "").slice(0, 120),
      String(customer.company || "").slice(0, 120),
      phone,
      String(customer.taxId || "").slice(0, 40),
      billing,
      shipping,
      now,
      existing.id
    );
    return existing.id;
  }
  const id = crypto.randomBytes(8).toString("hex");
  db.prepare(
    `INSERT INTO customers
      (id, full_name, company, email, phone, tax_id, billing_address, shipping_address, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(customer.name || customer.fullName || "").slice(0, 120),
    String(customer.company || "").slice(0, 120),
    email,
    phone,
    String(customer.taxId || "").slice(0, 40),
    billing,
    shipping,
    now,
    now
  );
  return id;
}

function createOrderStore(root) {
  const db = getDb(root);
  const jsonFile = path.join(root, ".runtime", "orders.json");
  migrateFromJsonOnce(db, jsonFile);

  function save(order) {
    if (!order || !order.id) throw new Error("Sipariş kimliği gerekli.");
    const customerId = upsertCustomer(db, order.customer || {});
    const paid =
      Boolean(order.paymentTaken) || order.paymentStatus === "paid" || order.status === "paid";
    const legalHold = paid ? 1 : order.legalHold ? 1 : 0;
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO orders (
          id, customer_id, status, payment_status, payment_taken, provider, currency,
          subtotal, vat, total, customer_json, contracts_json, bank_response_json,
          legal_hold, anonymized_at, created_at, updated_at, paid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          customer_id=excluded.customer_id,
          status=excluded.status,
          payment_status=excluded.payment_status,
          payment_taken=excluded.payment_taken,
          provider=excluded.provider,
          currency=excluded.currency,
          subtotal=excluded.subtotal,
          vat=excluded.vat,
          total=excluded.total,
          customer_json=excluded.customer_json,
          contracts_json=excluded.contracts_json,
          bank_response_json=excluded.bank_response_json,
          legal_hold=excluded.legal_hold,
          anonymized_at=excluded.anonymized_at,
          updated_at=excluded.updated_at,
          paid_at=excluded.paid_at`
      ).run(
        order.id,
        customerId,
        order.status || "payment_pending",
        order.paymentStatus || "pending",
        order.paymentTaken ? 1 : 0,
        order.provider || "akbank",
        order.currency || "TRY",
        Number(order.subtotal) || 0,
        Number(order.vat) || 0,
        Number(order.total) || 0,
        JSON.stringify(order.customer || {}),
        order.contractsAccepted ? JSON.stringify(order.contractsAccepted) : null,
        order.bankResponse ? JSON.stringify(order.bankResponse) : null,
        legalHold,
        order.anonymizedAt || null,
        order.createdAt || new Date().toISOString(),
        order.updatedAt || new Date().toISOString(),
        order.paidAt || (paid ? new Date().toISOString() : null)
      );
      db.prepare("DELETE FROM order_items WHERE order_id = ?").run(order.id);
      const insertItem = db.prepare(
        `INSERT INTO order_items
          (order_id, product_id, brand, name, unit_price, vat_percent, qty, line_net, line_vat)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of Array.isArray(order.items) ? order.items : []) {
        insertItem.run(
          order.id,
          String(item.productId || "").slice(0, 80),
          String(item.brand || "").slice(0, 80),
          String(item.name || "").slice(0, 200),
          Number(item.unitPrice) || 0,
          Number(item.vatPercent) || 20,
          Number(item.qty) || 1,
          Number(item.line) || 0,
          Number(item.lineVat) || 0
        );
      }
    });
    tx();
    return get(order.id);
  }

  function get(orderId) {
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(String(orderId || ""));
    return rowToOrder(db, row);
  }

  function update(orderId, patch) {
    const current = get(orderId);
    if (!current) return null;
    const next = Object.assign({}, current, patch || {}, {
      updatedAt: new Date().toISOString(),
    });
    if (next.paymentTaken || next.paymentStatus === "paid" || next.status === "paid") {
      next.legalHold = true;
      if (!next.paidAt) next.paidAt = new Date().toISOString();
    }
    return save(next);
  }

  function list(options) {
    const opts = options || {};
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
    const status = opts.status ? String(opts.status) : "";
    let rows;
    if (status) {
      rows = db
        .prepare(
          `SELECT * FROM orders WHERE status = ? OR payment_status = ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(status, status, limit);
    } else {
      rows = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit);
    }
    return rows.map((row) => rowToOrder(db, row));
  }

  function commerceSummary(requestedDaysOrRange, nowDate) {
    const range = resolvePeriodRange(requestedDaysOrRange, nowDate);
    const { from: startKey, to: endKey, periodDays } = range;
    const orders = list({ limit: 5000 });
    let ordersPaid = 0;
    let ordersFailed = 0;
    let ordersPending = 0;
    let revenue = 0;
    const byProduct = {};

    for (const order of orders) {
      const created = String(order.createdAt || "").slice(0, 10);
      if (!created || created < startKey || created > endKey) continue;
      const total = Number(order.total) || 0;
      const paid = Boolean(order.paymentTaken) || order.paymentStatus === "paid";
      const failed =
        order.paymentStatus === "failed" || order.status === "payment_failed";
      if (paid) {
        ordersPaid += 1;
        revenue += total;
        (Array.isArray(order.items) ? order.items : []).forEach((item) => {
          const productId = String((item && item.productId) || "").slice(0, 80);
          if (!productId) return;
          const qty = Math.max(0, Number(item.qty) || 0);
          const line = Number(item.line) || Number(item.unitPrice) * qty || 0;
          if (!byProduct[productId]) {
            byProduct[productId] = {
              productId,
              name: String((item && item.name) || productId).slice(0, 160),
              brand: String((item && item.brand) || "").slice(0, 80),
              qty: 0,
              revenue: 0,
            };
          }
          byProduct[productId].qty += qty;
          byProduct[productId].revenue += line;
          if (item.name) byProduct[productId].name = String(item.name).slice(0, 160);
        });
      } else if (failed) {
        ordersFailed += 1;
      } else {
        ordersPending += 1;
      }
    }

    revenue = Math.round(revenue * 100) / 100;
    const purchased = Object.values(byProduct)
      .map((row) => ({
        productId: row.productId,
        name: row.name,
        brand: row.brand,
        qty: row.qty,
        revenue: Math.round(row.revenue * 100) / 100,
      }))
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
      .slice(0, 10);

    return {
      periodDays,
      from: startKey,
      to: endKey,
      ordersPaid,
      ordersFailed,
      ordersPending,
      ordersTotal: ordersPaid + ordersFailed + ordersPending,
      revenue,
      aov: ordersPaid ? Math.round((revenue / ordersPaid) * 100) / 100 : 0,
      topPurchasedProducts: purchased,
    };
  }

  return { save, get, update, list, commerceSummary, ORDER_STATUSES };
}

function migrateFromJsonOnce(db, jsonFile) {
  const flag = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("v1_orders_json");
  if (flag) return;
  let orders = {};
  try {
    const value = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    if (value && value.orders && typeof value.orders === "object") orders = value.orders;
  } catch (_) {}
  const tx = db.transaction(() => {
    for (const order of Object.values(orders)) {
      if (!order || !order.id) continue;
      try {
        const customerId = upsertCustomer(db, order.customer || {});
        const paid =
          Boolean(order.paymentTaken) || order.paymentStatus === "paid" || order.status === "paid";
        db.prepare(
          `INSERT OR IGNORE INTO orders (
            id, customer_id, status, payment_status, payment_taken, provider, currency,
            subtotal, vat, total, customer_json, contracts_json, bank_response_json,
            legal_hold, anonymized_at, created_at, updated_at, paid_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          order.id,
          customerId,
          order.status || "payment_pending",
          order.paymentStatus || "pending",
          order.paymentTaken ? 1 : 0,
          order.provider || "akbank",
          order.currency || "TRY",
          Number(order.subtotal) || 0,
          Number(order.vat) || 0,
          Number(order.total) || 0,
          JSON.stringify(order.customer || {}),
          order.contractsAccepted ? JSON.stringify(order.contractsAccepted) : null,
          order.bankResponse ? JSON.stringify(order.bankResponse) : null,
          paid ? 1 : 0,
          null,
          order.createdAt || new Date().toISOString(),
          order.updatedAt || null,
          paid ? order.updatedAt || order.createdAt || null : null
        );
        const insertItem = db.prepare(
          `INSERT INTO order_items
            (order_id, product_id, brand, name, unit_price, vat_percent, qty, line_net, line_vat)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const item of Array.isArray(order.items) ? order.items : []) {
          insertItem.run(
            order.id,
            String(item.productId || "").slice(0, 80),
            String(item.brand || "").slice(0, 80),
            String(item.name || "").slice(0, 200),
            Number(item.unitPrice) || 0,
            Number(item.vatPercent) || 20,
            Number(item.qty) || 1,
            Number(item.line) || 0,
            Number(item.lineVat) || 0
          );
        }
      } catch (_) {}
    }
    db.prepare("INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      "v1_orders_json",
      new Date().toISOString()
    );
  });
  tx();
}

module.exports = { createOrderStore, ORDER_STATUSES };
