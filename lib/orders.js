const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

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

  return { save, get, update, read };
}

module.exports = { createOrderStore };
