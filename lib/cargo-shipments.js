"use strict";

const yurticiClient = require("./yurtici-kargo");

const PROVIDER = "yurtici_shipment";
/** States Yurtiçi can still move forward; only these are polled. */
const POLLED_STATES = new Set(["created", "in_transit"]);
/** A new shipment is refused while one of these exists; only a cancelled one can be replaced. */
const OPEN_STATES = new Set(["created", "in_transit", "delivered", "returning", "returned"]);
const SHIPPABLE_ORDER_STATUSES = new Set(["paid", "preparing"]);
const QUERY_BATCH = 25;
const POLL_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
// Yurtiçi blocks a repeated query for the same key within a minute.
const MANUAL_QUERY_COOLDOWN_MS = 2 * 60 * 1000;
const DEFAULT_DESI = 1;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function measure(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const n = Math.round(Number(String(value).replace(",", ".")) * 1000) / 1000;
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw httpError(400, label + " 0 ile 1000 arasında olmalı.");
  return n;
}

function createCargoShipments(deps) {
  const orderStore = deps.orderStore;
  const client = deps.client || yurticiClient;
  const getEnv = deps.env || (() => process.env);
  const nowMs = deps.now || (() => Date.now());
  const sendStatusMail = deps.sendStatusMail || (async () => ({ sent: false, reason: "no_mailer" }));
  const reviewUrlFor = deps.reviewUrlFor || (() => "");
  const onEvent = deps.onEvent || (() => {});
  const locks = new Set();
  let syncRunning = false;

  function config() {
    return client.yurticiConfig(getEnv());
  }

  function read(orderId) {
    const row = orderStore.getIntegration(orderId, PROVIDER);
    return row && row.guid ? row.payload || null : null;
  }

  function save(orderId, payload) {
    orderStore.saveIntegrationRef(orderId, PROVIDER, Object.assign({}, payload, { guid: payload.cargoKey, url: payload.trackingUrl || null }));
  }

  function view(orderId) {
    const cfg = config();
    return { configured: cfg.configured, mode: cfg.mode, shipment: read(orderId) };
  }

  async function withLock(orderId, run) {
    if (locks.has(orderId)) throw httpError(409, "Bu sipariş için kargo işlemi sürüyor; birkaç saniye sonra tekrar deneyin.");
    locks.add(orderId);
    try {
      return await run();
    } finally {
      locks.delete(orderId);
    }
  }

  async function create(orderId, input) {
    const cfg = config();
    if (!cfg.configured) throw httpError(503, "Yurtiçi Kargo bilgileri sunucuda tanımlı değil.");
    const body = input || {};
    const desi = measure(body.desi, DEFAULT_DESI, "Desi");
    const kg = measure(body.kg, null, "Kilo");
    return withLock(orderId, async () => {
      const order = orderStore.get(orderId);
      if (!order) throw httpError(404, "Sipariş bulunamadı");
      const paid = Boolean(order.paymentTaken || order.paymentStatus === "paid");
      if (!paid || !SHIPPABLE_ORDER_STATUSES.has(order.status)) {
        throw httpError(409, "Yalnızca ödemesi alınmış, kargoya verilmemiş sipariş için gönderi açılır.");
      }
      const existingRow = orderStore.getIntegration(orderId, PROVIDER);
      const existing = existingRow && existingRow.guid ? existingRow.payload || {} : null;
      if (existing && OPEN_STATES.has(existing.state)) {
        throw httpError(409, "Bu sipariş için Yurtiçi gönderisi zaten açık (" + existing.cargoKey + ").");
      }
      const attempt = existing ? (Number(existing.attempt) || 1) + 1 : 1;
      const cargoKey = client.cargoKeyFor(orderId, attempt);
      const claimed = existingRow ? false : orderStore.claimIntegration(orderId, PROVIDER);
      if (!existingRow && !claimed) throw httpError(409, "Bu sipariş için kargo işlemi sürüyor.");
      let result;
      try {
        result = await client.createShipment(order, { env: getEnv(), fetchImpl: deps.fetchImpl, cargoKey, desi, kg });
      } catch (err) {
        if (claimed) orderStore.releaseIntegration(orderId, PROVIDER);
        throw httpError(err.status || 502, err.message);
      }
      const previous = existing ? (existing.previousKeys || []).concat(existing.cargoKey) : [];
      const payload = {
        cargoKey,
        carrier: client.CARRIER_NAME,
        mode: result.mode,
        attempt,
        desi,
        kg,
        jobId: result.jobId,
        state: "created",
        createdAt: new Date(nowMs()).toISOString(),
        previousKeys: previous,
      };
      save(orderId, payload);
      onEvent({
        action: "order.cargo_created",
        orderId,
        actorId: body.actorId,
        detail: { cargoKey, mode: result.mode, desi, alreadyExisted: result.alreadyExisted },
      });
      return payload;
    });
  }

  async function cancel(orderId, actorId) {
    if (!config().configured) throw httpError(503, "Yurtiçi Kargo bilgileri sunucuda tanımlı değil.");
    return withLock(orderId, async () => {
      const payload = read(orderId);
      if (!payload || payload.state === "cancelled") throw httpError(404, "İptal edilecek açık gönderi yok.");
      if (payload.state !== "created") {
        throw httpError(409, "Paket şubede işlem gördü; iptal için Yurtiçi şubesiyle görüşün.");
      }
      let result;
      try {
        result = await client.cancelShipment(payload.cargoKey, { env: getEnv(), fetchImpl: deps.fetchImpl });
      } catch (err) {
        throw httpError(502, err.message);
      }
      if (!result.cancelled) throw httpError(409, "Yurtiçi gönderiyi iptal etmedi: " + result.message);
      const next = Object.assign({}, payload, { state: "cancelled", cancelledAt: new Date(nowMs()).toISOString() });
      save(orderId, next);
      onEvent({ action: "order.cargo_cancelled", orderId, actorId, detail: { cargoKey: payload.cargoKey } });
      return next;
    });
  }

  async function mail(order, key, extra) {
    try {
      const result = await sendStatusMail(order, key, extra);
      return result && result.sent ? null : (result && result.reason) || "not_sent";
    } catch (err) {
      return String((err && err.message) || err).slice(0, 160);
    }
  }

  /** Applies one Yurtiçi status row: the first waybill marks the order shipped, delivery marks it delivered. */
  async function apply(orderId, payload, row) {
    const stamp = new Date(nowMs()).toISOString();
    const next = Object.assign({}, payload, {
      state: row.state,
      lastCheckedAt: stamp,
      operationMessage: row.errMessage || row.operationMessage || payload.operationMessage || "",
      docId: row.docId || payload.docId || "",
      trackingUrl: row.trackingUrl || payload.trackingUrl || "",
    });
    const reachedBranch = (row.state === "in_transit" || row.state === "delivered") && next.docId;
    if (reachedBranch && !payload.shippedAt) {
      const order = orderStore.get(orderId);
      if (order && SHIPPABLE_ORDER_STATUSES.has(order.status)) {
        const updated = orderStore.update(orderId, {
          shippingCarrier: client.CARRIER_NAME,
          trackingCode: next.docId,
          status: "shipped",
        });
        next.shippedAt = stamp;
        next.shippedMailError = await mail(updated, "shipped", {
          shippingCarrier: client.CARRIER_NAME,
          trackingCode: next.docId,
          trackingUrl: next.trackingUrl,
        });
        onEvent({ action: "order.cargo_picked_up", orderId, detail: { docId: next.docId, mailError: next.shippedMailError } });
      } else if (order) {
        next.orderConflict = order.status;
      }
    }
    if (row.state === "delivered" && !payload.deliveredAt) {
      const order = orderStore.get(orderId);
      if (order && order.status === "shipped") {
        const updated = orderStore.update(orderId, { status: "delivered" });
        next.deliveredAt = stamp;
        next.deliveredMailError = await mail(updated, "delivered", { reviewUrl: reviewUrlFor(updated) });
        onEvent({ action: "order.cargo_delivered", orderId, detail: { docId: next.docId, mailError: next.deliveredMailError } });
      }
    }
    save(orderId, next);
    return next;
  }

  function pollTargets(cfg, onlyOrderId) {
    const since = new Date(nowMs() - POLL_LOOKBACK_MS).toISOString();
    const ids = onlyOrderId ? [onlyOrderId] : orderStore.listIntegrationOrderIds(PROVIDER, { since, limit: 300 });
    const targets = [];
    for (const id of ids) {
      const payload = read(id);
      // Test-mode keys do not exist on the live service and vice versa.
      if (payload && POLLED_STATES.has(payload.state) && payload.mode === cfg.mode) targets.push({ orderId: id, payload });
    }
    return targets;
  }

  async function sync(options) {
    const opts = options || {};
    const cfg = config();
    if (!cfg.configured) return { checked: 0, skipped: "not_configured" };
    if (syncRunning && !opts.orderId) return { checked: 0, skipped: "running" };
    if (!opts.orderId) syncRunning = true;
    try {
      const targets = pollTargets(cfg, opts.orderId);
      let checked = 0;
      for (let i = 0; i < targets.length; i += QUERY_BATCH) {
        const batch = targets.slice(i, i + QUERY_BATCH);
        const rows = await client.queryShipments(
          batch.map((t) => t.payload.cargoKey),
          { env: getEnv(), fetchImpl: deps.fetchImpl }
        );
        const byKey = new Map(rows.map((row) => [row.cargoKey, row]));
        for (const target of batch) {
          const row = byKey.get(target.payload.cargoKey);
          if (!row) continue;
          await apply(target.orderId, target.payload, row);
          checked += 1;
        }
      }
      return { checked };
    } finally {
      if (!opts.orderId) syncRunning = false;
    }
  }

  /** Panel "query now": rate-limited per order so Yurtiçi's one-minute block is never hit. */
  async function refresh(orderId) {
    const payload = read(orderId);
    if (!payload) throw httpError(404, "Bu siparişte Yurtiçi gönderisi yok.");
    const last = Date.parse(payload.lastCheckedAt || "") || 0;
    if (!POLLED_STATES.has(payload.state) || nowMs() - last < MANUAL_QUERY_COOLDOWN_MS) {
      return { shipment: payload, queried: false };
    }
    await withLock(orderId, () => sync({ orderId }));
    return { shipment: read(orderId), queried: true };
  }

  return { PROVIDER, view, read, create, cancel, sync, refresh };
}

module.exports = { createCargoShipments, PROVIDER, DEFAULT_DESI, MANUAL_QUERY_COOLDOWN_MS };
