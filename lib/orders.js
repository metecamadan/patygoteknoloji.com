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

function mapOrderItem(row) {
  return {
    productId: row.productId,
    brand: row.brand,
    name: row.name,
    unitPrice: row.unitPrice,
    vatPercent: row.vatPercent,
    qty: row.qty,
    line: row.line,
    lineVat: row.lineVat,
  };
}

function loadItemsForOrderIds(db, orderIds) {
  const itemsByOrder = new Map();
  (orderIds || []).forEach((id) => itemsByOrder.set(id, []));
  const ids = (orderIds || []).filter(Boolean);
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT order_id AS orderId, product_id AS productId, brand, name,
                unit_price AS unitPrice, vat_percent AS vatPercent, qty,
                line_net AS line, line_vat AS lineVat
         FROM order_items WHERE order_id IN (${placeholders})`
      )
      .all(...chunk);
    rows.forEach((row) => {
      const list = itemsByOrder.get(row.orderId);
      if (list) list.push(mapOrderItem(row));
    });
  }
  return itemsByOrder;
}

function rowToOrder(db, row, preloadedItems) {
  if (!row) return null;
  const items =
    preloadedItems ||
    db
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
    accessToken: row.access_token || null,
    customerId: row.customer_id || null,
    items,
    subtotal: row.subtotal,
    vat: row.vat,
    shippingFee: Number(row.shipping_fee) || 0,
    merchandiseTotal:
      Math.round(((Number(row.subtotal) || 0) + (Number(row.vat) || 0)) * 100) / 100,
    total: row.total,
    currency: row.currency || "TRY",
    customer,
    contractsAccepted,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentTaken: Boolean(row.payment_taken),
    provider: row.provider || "akbank",
    bankResponse,
    shippingCarrier: row.shipping_carrier || null,
    trackingCode: row.tracking_code || null,
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
          subtotal, vat, shipping_fee, total, customer_json, contracts_json, bank_response_json,
          shipping_carrier, tracking_code, access_token,
          legal_hold, anonymized_at, created_at, updated_at, paid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          customer_id=excluded.customer_id,
          status=excluded.status,
          payment_status=excluded.payment_status,
          payment_taken=excluded.payment_taken,
          provider=excluded.provider,
          currency=excluded.currency,
          subtotal=excluded.subtotal,
          vat=excluded.vat,
          shipping_fee=excluded.shipping_fee,
          total=excluded.total,
          customer_json=excluded.customer_json,
          contracts_json=excluded.contracts_json,
          bank_response_json=excluded.bank_response_json,
          shipping_carrier=excluded.shipping_carrier,
          tracking_code=excluded.tracking_code,
          access_token=COALESCE(excluded.access_token, orders.access_token),
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
        Number(order.shippingFee) || 0,
        Number(order.total) || 0,
        JSON.stringify(order.customer || {}),
        order.contractsAccepted ? JSON.stringify(order.contractsAccepted) : null,
        order.bankResponse ? JSON.stringify(order.bankResponse) : null,
        order.shippingCarrier ? String(order.shippingCarrier).slice(0, 80) : null,
        order.trackingCode ? String(order.trackingCode).slice(0, 80) : null,
        order.accessToken ? String(order.accessToken).slice(0, 64) : null,
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

  function parseDayKey(value) {
    const text = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  function sanitizeSearchQuery(value) {
    return String(value || "")
      .replace(/[%_]/g, "")
      .trim()
      .slice(0, 80);
  }

  function list(options) {
    const opts = options || {};
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
    const status = opts.status ? String(opts.status) : "";
    const q = sanitizeSearchQuery(opts.q);
    const searching = q.length >= 2;
    let fromKey = searching ? null : parseDayKey(opts.from);
    let toKey = searching ? null : parseDayKey(opts.to);
    if (fromKey && toKey && fromKey > toKey) {
      const swap = fromKey;
      fromKey = toKey;
      toKey = swap;
    }
    const conditions = [];
    const params = [];
    if (status) {
      conditions.push("(status = ? OR payment_status = ?)");
      params.push(status, status);
    }
    if (fromKey) {
      conditions.push("substr(created_at, 1, 10) >= ?");
      params.push(fromKey);
    }
    if (toKey) {
      conditions.push("substr(created_at, 1, 10) <= ?");
      params.push(toKey);
    }
    if (searching) {
      const like = "%" + q + "%";
      const searchParts = [
        "id LIKE ? COLLATE NOCASE",
        "ifnull(json_extract(customer_json, '$.email'), '') LIKE ? COLLATE NOCASE",
        "ifnull(json_extract(customer_json, '$.name'), '') LIKE ? COLLATE NOCASE",
        "ifnull(json_extract(customer_json, '$.phone'), '') LIKE ? COLLATE NOCASE",
      ];
      params.push(like, like, like, like);
      const phoneDigits = q.replace(/\D/g, "").slice(0, 20);
      if (phoneDigits.length >= 4) {
        searchParts.push(
          "replace(replace(replace(replace(replace(replace(" +
            "ifnull(json_extract(customer_json, '$.phone'), ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '') LIKE ?"
        );
        params.push("%" + phoneDigits + "%");
      }
      conditions.push("(" + searchParts.join(" OR ") + ")");
    }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const rows = db
      .prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit);
    const itemsByOrder = loadItemsForOrderIds(
      db,
      rows.map((row) => row.id)
    );
    return rows.map((row) => rowToOrder(db, row, itemsByOrder.get(row.id) || []));
  }

  function isPaidRow(row) {
    return Boolean(row.payment_taken) || row.payment_status === "paid";
  }

  function isFailedRow(row) {
    return row.payment_status === "failed" || row.status === "payment_failed";
  }

  function commerceSummary(requestedDaysOrRange, nowDate) {
    const range = resolvePeriodRange(requestedDaysOrRange, nowDate);
    const { from: startKey, to: endKey, periodDays } = range;
    const orders = db
      .prepare(
        `SELECT payment_taken, payment_status, status, total
         FROM orders
         WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`
      )
      .all(startKey, endKey);
    let ordersPaid = 0;
    let ordersFailed = 0;
    let ordersPending = 0;
    let revenue = 0;
    for (const order of orders) {
      const total = Number(order.total) || 0;
      if (isPaidRow(order)) {
        ordersPaid += 1;
        revenue += total;
      } else if (isFailedRow(order)) {
        ordersFailed += 1;
      } else {
        ordersPending += 1;
      }
    }

    revenue = Math.round(revenue * 100) / 100;
    const purchased = db
      .prepare(
        `SELECT i.product_id AS productId,
                MAX(i.name) AS name,
                MAX(i.brand) AS brand,
                SUM(i.qty) AS qty,
                SUM(i.line_net) AS revenue
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         WHERE substr(o.created_at, 1, 10) >= ?
           AND substr(o.created_at, 1, 10) <= ?
           AND (o.payment_taken = 1 OR o.payment_status = 'paid')
         GROUP BY i.product_id
         ORDER BY qty DESC, revenue DESC
         LIMIT 10`
      )
      .all(startKey, endKey)
      .map((row) => ({
        productId: String(row.productId || "").slice(0, 80),
        name: String(row.name || row.productId || "").slice(0, 160),
        brand: String(row.brand || "").slice(0, 80),
        qty: Number(row.qty) || 0,
        revenue: Math.round((Number(row.revenue) || 0) * 100) / 100,
      }));

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

  function soldQuantities(requestedDaysOrRange, nowDate) {
    const range = resolvePeriodRange(requestedDaysOrRange, nowDate);
    const { from: startKey, to: endKey } = range;
    const qty = {};
    const rows = db
      .prepare(
        `SELECT i.product_id AS productId, SUM(i.qty) AS qty
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         WHERE substr(o.created_at, 1, 10) >= ?
           AND substr(o.created_at, 1, 10) <= ?
           AND (o.payment_taken = 1 OR o.payment_status = 'paid')
         GROUP BY i.product_id`
      )
      .all(startKey, endKey);
    rows.forEach((row) => {
      const productId = String(row.productId || "").slice(0, 80);
      if (!productId) return;
      qty[productId] = Number(row.qty) || 0;
    });
    return qty;
  }

  function claimStatusMail(orderId, status) {
    const id = String(orderId || "").trim();
    const key = String(status || "").trim();
    if (!id || !key) return false;
    try {
      db.prepare(
        "INSERT INTO order_status_mails (order_id, status, sent_at) VALUES (?, ?, ?)"
      ).run(id, key, new Date().toISOString());
      return true;
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/unique|constraint|already exists/i.test(msg)) return false;
      throw err;
    }
  }

  function releaseStatusMail(orderId, status) {
    const id = String(orderId || "").trim();
    const key = String(status || "").trim();
    if (!id || !key) return;
    db.prepare("DELETE FROM order_status_mails WHERE order_id = ? AND status = ?").run(id, key);
  }

  function hasStatusMail(orderId, status) {
    const id = String(orderId || "").trim();
    const key = String(status || "").trim();
    if (!id || !key) return false;
    return Boolean(
      db.prepare("SELECT 1 FROM order_status_mails WHERE order_id = ? AND status = ?").get(id, key)
    );
  }

  function listStatusMails(orderId) {
    const id = String(orderId || "").trim();
    if (!id) return [];
    return db
      .prepare("SELECT status, sent_at AS sentAt FROM order_status_mails WHERE order_id = ? ORDER BY sent_at")
      .all(id);
  }

  function claimIntegration(orderId, provider) {
    const id = String(orderId || "").trim();
    const key = String(provider || "").trim();
    if (!id || !key) return false;
    try {
      db.prepare(
        "INSERT INTO order_integrations (order_id, provider, created_at) VALUES (?, ?, ?)"
      ).run(id, key, new Date().toISOString());
      return true;
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/unique|constraint|already exists/i.test(msg)) return false;
      throw err;
    }
  }

  function releaseIntegration(orderId, provider) {
    const id = String(orderId || "").trim();
    const key = String(provider || "").trim();
    if (!id || !key) return;
    db.prepare("DELETE FROM order_integrations WHERE order_id = ? AND provider = ?").run(id, key);
  }

  function saveIntegrationRef(orderId, provider, ref) {
    const id = String(orderId || "").trim();
    const key = String(provider || "").trim();
    if (!id || !key) return;
    const payload = ref && typeof ref === "object" ? ref : {};
    db.prepare(
      `UPDATE order_integrations
       SET external_guid = ?, external_url = ?, payload_json = ?
       WHERE order_id = ? AND provider = ?`
    ).run(
      payload.guid ? String(payload.guid).slice(0, 120) : null,
      payload.url ? String(payload.url).slice(0, 500) : null,
      JSON.stringify(payload),
      id,
      key
    );
  }

  function getIntegration(orderId, provider) {
    const id = String(orderId || "").trim();
    const key = String(provider || "").trim();
    if (!id || !key) return null;
    const row = db
      .prepare(
        `SELECT order_id AS orderId, provider, external_guid AS guid, external_url AS url,
                payload_json AS payloadJson, created_at AS createdAt
         FROM order_integrations WHERE order_id = ? AND provider = ?`
      )
      .get(id, key);
    if (!row) return null;
    let payload = {};
    try {
      payload = row.payloadJson ? JSON.parse(row.payloadJson) : {};
    } catch (_) {}
    return {
      orderId: row.orderId,
      provider: row.provider,
      guid: row.guid || payload.guid || null,
      url: row.url || payload.url || null,
      createdAt: row.createdAt,
      payload,
    };
  }

  return {
    save,
    get,
    update,
    list,
    commerceSummary,
    soldQuantities,
    claimStatusMail,
    releaseStatusMail,
    hasStatusMail,
    listStatusMails,
    claimIntegration,
    releaseIntegration,
    saveIntegrationRef,
    getIntegration,
    ORDER_STATUSES,
  };
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
