"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnTestServer } = require("./helpers/spawn-server");
const { createOrderStore } = require("../lib/orders");
const { createContactStore } = require("../lib/contact");
const { resetDbForTests } = require("../lib/db");
const { deleteOrderHard } = require("../lib/retention");

test("GET /api/admin/leads returns contact leads when authenticated", async (t) => {
  const password = "leads-admin-test";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password }, {
    seed: (dataRoot) =>
      createContactStore(dataRoot).append({
        id: "LEAD-API-1",
        createdAt: "2026-09-01T10:00:00.000Z",
        firma: "Acme A.Ş.",
        email: "teklif@acme.example",
        tel: "0555 507 07 24",
        vkn: "1234567890",
        mesaj: "10 adet laptop teklifi",
        spam: false,
      }),
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
  assert.deepEqual(body.leads[0].replies, []);
  assert.equal(body.replyEnabled, false);

  const jsonHeaders = Object.assign({ "Content-Type": "application/json" }, headers);
  const reply = (id, payload) =>
    fetch(baseUrl + "/api/admin/leads/" + id + "/reply", {
      method: "POST",
      headers: jsonHeaders,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  const valid = { subject: "Teklif talebiniz", message: "Teklifimiz ektedir.", attachments: [] };

  const anonymousReply = await fetch(baseUrl + "/api/admin/leads/LEAD-API-1/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(valid),
  });
  assert.equal(anonymousReply.status, 401);
  assert.equal((await reply("LEAD-YOK", valid)).status, 404);
  assert.equal((await reply("LEAD-API-1", "{bozuk")).status, 400);
  const invalid = await reply("LEAD-API-1", { subject: "Teklif", message: "" });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Mesaj/);
  const spoofed = await reply("LEAD-API-1", Object.assign({}, valid, {
    attachments: [{ filename: "teklif.pdf", dataBase64: Buffer.from("MZ not a pdf").toString("base64") }],
  }));
  assert.equal(spoofed.status, 400);

  const noSmtp = await reply("LEAD-API-1", valid);
  assert.equal(noSmtp.status, 503);
  assert.match((await noSmtp.json()).error, /SMTP/);
  const after = await (await fetch(baseUrl + "/api/admin/leads", { headers })).json();
  assert.deepEqual(after.leads[0].replies, []);
});

test("POST /api/admin/orders/:id/anonymize clears PII and audit; legal_hold blocks hard delete", async (t) => {
  const password = "anon-admin-test";
  const { baseUrl, dataRoot, stop } = await spawnTestServer(t, { ADMIN_PASSWORD: password }, {
    seed: (root) =>
      createOrderStore(root).save({
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
      }),
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

  const customers = await fetch(baseUrl + "/api/admin/customers", { headers });
  assert.equal(customers.status, 200);
  const custBody = await customers.json();
  assert.equal(custBody.ok, true);
  assert.ok(Array.isArray(custBody.customers));

  await stop();
  resetDbForTests();
  const hard = deleteOrderHard(dataRoot, "PTY-DSAR-1");
  assert.equal(hard.ok, false);
  assert.equal(hard.error, "legal_hold");
  assert.ok(createOrderStore(dataRoot).get("PTY-DSAR-1"));
  resetDbForTests();
});
