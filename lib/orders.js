const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

const MAX_ORDERS = 500;

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDay(date, amount) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  return shifted;
}

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

  function commerceSummary(requestedDays, nowDate) {
    const periodDays = Math.max(1, Math.min(90, Number(requestedDays) || 30));
    const currentDate = nowDate ? new Date(nowDate) : new Date();
    const startKey = dayKey(shiftDay(currentDate, -(periodDays - 1)));
    const endKey = dayKey(currentDate);
    const orders = Object.values(read().orders || {});
    let ordersPaid = 0;
    let ordersFailed = 0;
    let ordersPending = 0;
    let revenue = 0;

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
      } else if (failed) {
        ordersFailed += 1;
      } else {
        ordersPending += 1;
      }
    }

    revenue = Math.round(revenue * 100) / 100;
    return {
      periodDays,
      ordersPaid,
      ordersFailed,
      ordersPending,
      ordersTotal: ordersPaid + ordersFailed + ordersPending,
      revenue,
      aov: ordersPaid ? Math.round((revenue / ordersPaid) * 100) / 100 : 0,
    };
  }

  return { save, get, update, read, commerceSummary };
}

module.exports = { createOrderStore };
