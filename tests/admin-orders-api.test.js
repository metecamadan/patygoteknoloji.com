const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");
const { createOrderStore } = require("../lib/orders");
const { resetDbForTests } = require("../lib/db");

test("admin orders PATCH updates status and saves shipping with carriers list", async (t) => {
  resetDbForTests();
  const password = "orders-admin-test";
  const { baseUrl, dataRoot } = await spawnTestServer(t, { ADMIN_PASSWORD: password });
  const store = createOrderStore(dataRoot);
  store.save({
    id: "PTY-ADMIN-1",
    total: 500,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Test Müşteri", email: "musteri@example.com", phone: "0555" },
    items: [{ productId: "p1", name: "Ürün", qty: 1, line: 500, lineVat: 0 }],
    createdAt: new Date().toISOString(),
  });

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = {
    Authorization: "Bearer " + session.token,
    "Content-Type": "application/json",
  };

  const listRes = await fetch(baseUrl + "/api/admin/orders", { headers });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.ok(Array.isArray(listBody.shippingCarriers));
  assert.ok(listBody.shippingCarriers.includes("Yurtiçi Kargo"));

  const statusPatch = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-1", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "preparing" }),
  });
  assert.equal(statusPatch.status, 200);
  const statusBody = await statusPatch.json();
  assert.equal(statusBody.order.status, "preparing");

  const cancelPatch = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-1", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(cancelPatch.status, 200);
  const cancelBody = await cancelPatch.json();
  assert.equal(cancelBody.order.status, "cancelled");

  store.save({
    id: "PTY-ADMIN-2",
    total: 300,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "İkinci Müşteri", email: "ikinci@example.com" },
    items: [{ productId: "p2", name: "Klavye", qty: 2, line: 250, lineVat: 50 }],
    createdAt: new Date().toISOString(),
  });

  const shipPatch = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-2", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      shippingCarrier: "MNG Kargo",
      trackingCode: "MNG987654",
    }),
  });
  assert.equal(shipPatch.status, 200);
  const shipBody = await shipPatch.json();
  assert.equal(shipBody.order.status, "shipped");
  assert.equal(shipBody.order.shippingCarrier, "MNG Kargo");
  assert.equal(shipBody.order.trackingCode, "MNG987654");

  const shipPatch2 = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-2", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      shippingCarrier: "MNG Kargo",
      trackingCode: "MNG987654",
    }),
  });
  assert.equal(shipPatch2.status, 200);
  const shipBody2 = await shipPatch2.json();
  assert.equal(shipBody2.order.status, "shipped");
  assert.equal(shipBody2.mailSent, false);

  const resendPatch = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-2", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      shippingCarrier: "MNG Kargo",
      trackingCode: "MNG987654",
      resendMail: true,
    }),
  });
  assert.equal(resendPatch.status, 200);
  const resendBody = await resendPatch.json();
  assert.equal(resendBody.order.status, "shipped");

  const badStatusShip = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-2", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "shipped" }),
  });
  assert.equal(badStatusShip.status, 400);

  const meAfter = await fetch(baseUrl + "/api/admin/me", { headers });
  assert.equal(meAfter.status, 200);

  const badShip = await fetch(baseUrl + "/api/admin/orders/PTY-ADMIN-2", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ shippingCarrier: "MNG Kargo" }),
  });
  assert.equal(badShip.status, 400);
});

test("admin orders list filters by date range", async (t) => {
  resetDbForTests();
  const password = "orders-admin-test";
  const { baseUrl, dataRoot } = await spawnTestServer(t, { ADMIN_PASSWORD: password });
  const store = createOrderStore(dataRoot);
  store.save({
    id: "PTY-RANGE-OLD",
    total: 100,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Eski", email: "eski@example.com" },
    items: [{ productId: "p1", name: "Ürün", qty: 1, line: 100, lineVat: 0 }],
    createdAt: "2026-08-01T10:00:00.000Z",
  });
  store.save({
    id: "PTY-RANGE-NEW",
    total: 200,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Yeni", email: "yeni@example.com" },
    items: [{ productId: "p2", name: "Ürün", qty: 1, line: 200, lineVat: 0 }],
    createdAt: "2026-08-18T12:00:00.000Z",
  });

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { Authorization: "Bearer " + session.token };

  const todayOnly = await fetch(
    baseUrl + "/api/admin/orders?from=2026-08-18&to=2026-08-18",
    { headers }
  );
  assert.equal(todayOnly.status, 200);
  const todayBody = await todayOnly.json();
  assert.deepEqual(
    todayBody.orders.map((order) => order.id),
    ["PTY-RANGE-NEW"]
  );

  const august = await fetch(
    baseUrl + "/api/admin/orders?from=2026-08-01&to=2026-08-31",
    { headers }
  );
  assert.equal(august.status, 200);
  const augustBody = await august.json();
  assert.equal(augustBody.orders.length, 2);
});

test("admin orders list searches by order id, email, and phone across dates", async (t) => {
  resetDbForTests();
  const password = "orders-admin-test";
  const { baseUrl, dataRoot } = await spawnTestServer(t, { ADMIN_PASSWORD: password });
  const store = createOrderStore(dataRoot);
  store.save({
    id: "PTY-SEARCH-OLD",
    total: 100,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Ayşe Kaya", email: "ayse.kaya@example.com", phone: "0532 111 22 33" },
    items: [{ productId: "p1", name: "Ürün", qty: 1, line: 100, lineVat: 0 }],
    createdAt: "2026-01-12T10:00:00.000Z",
  });
  store.save({
    id: "PTY-SEARCH-NEW",
    total: 200,
    status: "preparing",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: { name: "Mehmet Demir", email: "mehmet@example.com", phone: "0555 999 00 11" },
    items: [{ productId: "p2", name: "Ürün", qty: 1, line: 200, lineVat: 0 }],
    createdAt: "2026-08-18T12:00:00.000Z",
  });

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { Authorization: "Bearer " + session.token };

  const byId = await fetch(
    baseUrl + "/api/admin/orders?from=2026-08-18&to=2026-08-18&q=SEARCH-OLD",
    { headers }
  );
  assert.equal(byId.status, 200);
  const byIdBody = await byId.json();
  assert.deepEqual(
    byIdBody.orders.map((order) => order.id),
    ["PTY-SEARCH-OLD"]
  );

  const byEmail = await fetch(
    baseUrl + "/api/admin/orders?from=2026-08-18&to=2026-08-18&q=ayse.kaya",
    { headers }
  );
  const byEmailBody = await byEmail.json();
  assert.deepEqual(
    byEmailBody.orders.map((order) => order.id),
    ["PTY-SEARCH-OLD"]
  );

  const byPhone = await fetch(
    baseUrl + "/api/admin/orders?from=2026-08-18&to=2026-08-18&q=0532%20111",
    { headers }
  );
  const byPhoneBody = await byPhone.json();
  assert.deepEqual(
    byPhoneBody.orders.map((order) => order.id),
    ["PTY-SEARCH-OLD"]
  );

  const byStatus = await fetch(
    baseUrl + "/api/admin/orders?q=example.com&status=preparing",
    { headers }
  );
  const byStatusBody = await byStatus.json();
  assert.deepEqual(
    byStatusBody.orders.map((order) => order.id),
    ["PTY-SEARCH-NEW"]
  );

  const wildcard = await fetch(
    baseUrl + "/api/admin/orders?from=2026-08-18&to=2026-08-18&q=%25",
    { headers }
  );
  const wildcardBody = await wildcard.json();
  assert.deepEqual(
    wildcardBody.orders.map((order) => order.id),
    ["PTY-SEARCH-NEW"]
  );
});
