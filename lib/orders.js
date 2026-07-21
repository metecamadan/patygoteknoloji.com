const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");
const { resolvePeriodRange } = require("./analytics");

const MAX_ORDERS = 500;

function createOrderStore(root) {
  const file = path.join(root, ".runtime", "orders.json");

  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && value.orders && typeof value.orders === "object") return value;
    } catch (_) {}
    return { version: 1, orders: {} };
  }

  function write(value) {
    const ids = Object.keys(value.orders || {});
    if (ids.length > MAX_ORDERS) {
      const sorted = ids
        .map((id) => ({ id, at: value.orders[id].createdAt || "" }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const keep = new Set(sorted.slice(0, MAX_ORDERS).map((row) => row.id));
      const next = {};
      for (const id of keep) next[id] = value.orders[id];
      value.orders = next;
    }
    atomicWriteJson(file, value);
  }

  function save(order) {
    if (!order || !order.id) throw new Error("Sipariş kimliği gerekli.");
    const data = read();
    data.orders[order.id] = order;
    write(data);
    return order;
  }

  function get(orderId) {
    const data = read();
    return data.orders[String(orderId || "")] || null;
  }

  function update(orderId, patch) {
    const data = read();
    const current = data.orders[String(orderId || "")];
    if (!current) return null;
    const next = Object.assign({}, current, patch || {}, {
      updatedAt: new Date().toISOString(),
    });
    data.orders[next.id] = next;
    write(data);
    return next;
  }

  function commerceSummary(requestedDaysOrRange, nowDate) {
    const range = resolvePeriodRange(requestedDaysOrRange, nowDate);
    const { from: startKey, to: endKey, periodDays } = range;
    const orders = Object.values(read().orders || {});
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

  return { save, get, update, read, commerceSummary };
}

module.exports = { createOrderStore };
