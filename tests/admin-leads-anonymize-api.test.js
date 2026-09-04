"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnTestServer } = require("./helpers/spawn-server");
const { createOrderStore } = require("../lib/orders");
const { createContactStore } = require("../lib/contact");
const { resetDbForTests } = require("../lib/db");
const { deleteOrderHard } = require("../lib/retention");

test("GET /api/admin/leads returns contact leads when authenticated", async (t) => {
  resetDbForTests();
  const password = "leads-admin-test";
  const { baseUrl, dataRoot } = await spawnTestServer(t, { ADMIN_PASSWORD: password });
  const contactStore = createContactStore(dataRoot);
  contactStore.append({
    id: "LEAD-API-1",
    createdAt: "2026-09-01T10:00:00.000Z",
    firma: "Acme A.Ş.",
    email: "teklif@acme.example",
    tel: "0555 507 07 24",
    vkn: "1234567890",
    mesaj: "10 adet laptop teklifi",
    spam: false,
  });

  const unauthorized = await fetch(baseUrl + "/api/admin/leads");
  assert.equal(unauthorized.status, 401);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { Authorization: "Bearer " + session.token };

  const res = await fetch(baseUrl + "/api/admin/leads", { headers });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.leads));
  assert.equal(body.leads.length, 1);
  assert.equal(body.leads[0].firma, "Acme A.Ş.");
  assert.equal(body.leads[0].email, "teklif@acme.example");
  assert.equal(body.leads[0].tel, "0555 507 07 24");
  assert.match(String(body.policyNote || ""), /taslak/i);
});

test("POST /api/admin/orders/:id/anonymize clears PII and audit; legal_hold blocks hard delete", async (t) => {
  resetDbForTests();
  const password = "anon-admin-test";
  const { baseUrl, dataRoot } = await spawnTestServer(t, { ADMIN_PASSWORD: password });
  const store = createOrderStore(dataRoot);
  store.save({
    id: "PTY-DSAR-1",
    total: 750,
    status: "paid",
    paymentStatus: "paid",
    paymentTaken: true,
    customer: {
      name: "Zeynep Kara",
      email: "zeynep@example.com",
      phone: "0533 222 33 44",
      billingAddress: "İstanbul",
    },
    items: [{ productId: "p1", name: "Klavye", qty: 1, line: 750, lineVat: 0 }],
    createdAt: new Date().toISOString(),
  });

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const session = await login.json();
  const headers = {
    Authorization: "Bearer " + session.token,
    "Content-Type": "application/json",
  };

  const anon = await fetch(baseUrl + "/api/admin/orders/PTY-DSAR-1/anonymize", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(anon.status, 200);
  const anonBody = await anon.json();
  assert.equal(anonBody.ok, true);
  assert.ok(anonBody.order.anonymizedAt);
  assert.equal(anonBody.order.total, 750);
  assert.equal(anonBody.order.items[0].name, "Klavye");
  assert.doesNotMatch(String(anonBody.order.customer.email || ""), /zeynep@example\.com/i);
  assert.equal(String(anonBody.order.customer.phone || ""), "");
  assert.equal(anonBody.order.legalHold, true);

  const hard = deleteOrderHard(dataRoot, "PTY-DSAR-1");
  assert.equal(hard.ok, false);
  assert.equal(hard.error, "legal_hold");
  assert.ok(store.get("PTY-DSAR-1"));

  const customers = await fetch(baseUrl + "/api/admin/customers", { headers });
  assert.equal(customers.status, 200);
  const custBody = await customers.json();
  assert.equal(custBody.ok, true);
  assert.ok(Array.isArray(custBody.customers));
});
