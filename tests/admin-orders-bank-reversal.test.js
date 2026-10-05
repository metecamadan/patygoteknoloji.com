const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnTestServer } = require("./helpers/spawn-server");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");

function paidOrder(id, overrides) {
  return Object.assign(
    {
      id,
      total: 750,
      currency: "TRY",
      status: "paid",
      paymentStatus: "paid",
      paymentTaken: true,
      paidAt: new Date().toISOString(),
      customer: { name: "Test Müşteri", email: "musteri@example.com", phone: "0555" },
      items: [{ productId: "p1", name: "Ürün", qty: 1, line: 750, lineVat: 0 }],
      bankResponse: { responseCode: "VPS-0000", hashOk: true, amountOk: true },
      paymentEvents: [],
      createdAt: new Date().toISOString(),
    },
    overrides || {}
  );
}

async function adminHeaders(baseUrl, password) {
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  return {
    Authorization: "Bearer " + session.token,
    "Content-Type": "application/json",
  };
}

test("bank reversal preview works without enabling bank API", async (t) => {
  const password = "reversal-admin-test";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password }, {
    seed: (dataRoot) => createOrderStore(dataRoot).save(paidOrder("PTY-REV-API-1")),
  });

  const headers = await adminHeaders(baseUrl, password);

  const statusRes = await fetch(baseUrl + "/api/payment/status");
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json();
  assert.ok(statusBody.bankReversal);
  assert.equal(statusBody.bankReversal.enabled, false);

  const detail = await fetch(baseUrl + "/api/admin/orders/PTY-REV-API-1", { headers });
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.bankReversal.ok, true);
  assert.equal(detailBody.bankReversal.plan.tryRefund, true);

  const preview = await fetch(baseUrl + "/api/admin/orders/PTY-REV-API-1/bank-reversal", {
    method: "POST",
    headers,
    body: JSON.stringify({ dryRun: true, action: "auto" }),
  });
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.ok, true);
  assert.equal(previewBody.dryRun, true);
  assert.equal(previewBody.preview.plan.amount, "750.00");
});

test("bank reversal confirm is blocked when API disabled and PATCH refunded rejected", async (t) => {
  const password = "reversal-admin-test";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password }, {
    seed: (dataRoot) => createOrderStore(dataRoot).save(paidOrder("PTY-REV-API-2")),
  });

  const headers = await adminHeaders(baseUrl, password);

  const missingConfirm = await fetch(baseUrl + "/api/admin/orders/PTY-REV-API-2/bank-reversal", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "auto" }),
  });
  assert.equal(missingConfirm.status, 400);
  const missingBody = await missingConfirm.json();
  assert.match(String(missingBody.error || ""), /confirm/i);

  const blocked = await fetch(baseUrl + "/api/admin/orders/PTY-REV-API-2/bank-reversal", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirm: true, action: "auto" }),
  });
  assert.equal(blocked.status, 503);
  const blockedBody = await blocked.json();
  assert.match(String(blockedBody.error || ""), /kapalı/i);

  const manualRefunded = await fetch(baseUrl + "/api/admin/orders/PTY-REV-API-2", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "refunded" }),
  });
  assert.equal(manualRefunded.status, 400);
  const manualBody = await manualRefunded.json();
  assert.match(String(manualBody.error || ""), /Banka iadesi/i);
});

test("bank reversal rejects unpaid orders and shipped auto skips void", async (t) => {
  const password = "reversal-admin-test";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password }, {
    seed: (dataRoot) => {
      const store = createOrderStore(dataRoot);
      store.save(
        paidOrder("PTY-REV-SHIP", {
          status: "shipped",
          shippingCarrier: "Yurtiçi Kargo",
          trackingCode: "YT123",
        })
      );
      store.save(
        paidOrder("PTY-REV-UNPAID", {
          paymentStatus: "pending",
          paymentTaken: false,
          bankResponse: null,
        })
      );
    },
  });

  const headers = await adminHeaders(baseUrl, password);

  const shippedPreview = await fetch(baseUrl + "/api/admin/orders/PTY-REV-SHIP/bank-reversal", {
    method: "POST",
    headers,
    body: JSON.stringify({ dryRun: true, action: "auto" }),
  });
  assert.equal(shippedPreview.status, 200);
  const shippedBody = await shippedPreview.json();
  assert.equal(shippedBody.preview.plan.tryVoid, false);
  assert.equal(shippedBody.preview.plan.tryRefund, true);

  const unpaid = await fetch(baseUrl + "/api/admin/orders/PTY-REV-UNPAID/bank-reversal", {
    method: "POST",
    headers,
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(unpaid.status, 400);
});

test("cancel and item refund previews; unknown result blocks; paid cancel needs refund", async (t) => {
  const password = "reversal-admin-test";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password }, {
    seed: (dataRoot) => {
      const store = createOrderStore(dataRoot);
      store.save(paidOrder("PTY-REV-CANCEL"));
      store.save(
        paidOrder("PTY-REV-ITEMS", {
          status: "delivered",
          items: [{ productId: "p1", name: "Ürün", qty: 3, line: 750, lineVat: 0 }],
          merchandiseTotal: 750,
        })
      );
      store.save(
        paidOrder("PTY-REV-PENDING", {
          paymentEvents: [
            { kind: "bank_reversal", type: "void", amount: "750.00", success: false, unknown: true, at: new Date().toISOString() },
          ],
        })
      );
    },
  });
  const headers = await adminHeaders(baseUrl, password);
  const post = (id, suffix, body) =>
    fetch(baseUrl + "/api/admin/orders/" + id + suffix, { method: "POST", headers, body: JSON.stringify(body) });

  const detail = await (await fetch(baseUrl + "/api/admin/orders/PTY-REV-CANCEL", { headers })).json();
  assert.equal(detail.bankReversal.ok, true);
  assert.equal(detail.bankReversal.plan.mode, "cancel");
  assert.equal(detail.bankInquiryAvailable, false);

  const cancelPreview = await (await post("PTY-REV-CANCEL", "/bank-reversal", { dryRun: true, mode: "cancel" })).json();
  assert.equal(cancelPreview.preview.plan.amount, "750.00");
  assert.equal(cancelPreview.preview.plan.tryVoid, true);

  const shippedCancel = await post("PTY-REV-ITEMS", "/bank-reversal", { dryRun: true, mode: "cancel" });
  assert.equal(shippedCancel.status, 400);
  assert.equal((await shippedCancel.json()).reason, "cancel_requires_unshipped");

  const itemsPreview = await (
    await post("PTY-REV-ITEMS", "/bank-reversal", { dryRun: true, mode: "items", items: [{ index: 0, qty: 1 }] })
  ).json();
  assert.equal(itemsPreview.preview.plan.amount, "250.00");
  assert.equal(itemsPreview.preview.plan.tryVoid, false);

  const pending = await post("PTY-REV-PENDING", "/bank-reversal", { dryRun: true, mode: "cancel" });
  assert.equal(pending.status, 400);
  const pendingBody = await pending.json();
  assert.equal(pendingBody.reason, "reversal_pending_inquiry");
  assert.match(pendingBody.error, /Bankadan sorgula/);

  const inquiry = await post("PTY-REV-PENDING", "/bank-inquiry", {});
  assert.equal(inquiry.status, 503, "POS kimliği yokken sorgu bankaya gitmez");

  const paidCancel = await fetch(baseUrl + "/api/admin/orders/PTY-REV-CANCEL", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(paidCancel.status, 409);
});

test("recordBankReversal updates order through store layer", () => {
  resetDbForTests();
  const os = require("node:os");
  const fs = require("node:fs");
  const path = require("node:path");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-rev-store-"));
  const store = createOrderStore(dataRoot);
  store.save(paidOrder("PTY-STORE-REV"));
  const updated = store.recordBankReversal("PTY-STORE-REV", {
    success: true,
    dryRun: false,
    event: {
      kind: "bank_reversal",
      type: "void",
      amount: "750.00",
      success: true,
      dryRun: false,
      responseCode: "VPS-0000",
    },
  });
  assert.equal(updated.status, "cancelled");
  assert.equal(updated.paymentStatus, "refunded");
  assert.equal(updated.paymentTaken, false);
  assert.equal(updated.paymentEvents.length, 1);
  try {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  } catch (_) {}
});
