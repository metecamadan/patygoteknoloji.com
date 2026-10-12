const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");
const { createOrderStore } = require("../lib/orders");

const ROOT = path.join(__dirname, "..");

test("admin cargo API: session required, 503 without Yurtiçi credentials, detail exposes cargo view, label link is signed", async (t) => {
  const password = "cargo-admin-test";
  const { baseUrl } = await spawnTestServer(
    t,
    { ADMIN_PASSWORD: password, YURTICI_WS_USER: "", YURTICI_WS_PASSWORD: "" },
    {
      seed: (dataRoot) => {
        createOrderStore(dataRoot).save({
          id: "PTY-261012-CARGO1",
          total: 500,
          status: "paid",
          paymentStatus: "paid",
          paymentTaken: true,
          customer: { name: "Kargo Müşteri", email: "kargo@example.com", phone: "05551112233" },
          items: [{ productId: "p1", name: "Ürün", qty: 1, line: 500, lineVat: 0 }],
          createdAt: new Date().toISOString(),
        });
      },
    }
  );

  const anon = await fetch(baseUrl + "/api/admin/orders/PTY-261012-CARGO1/cargo", { method: "POST", body: "{}" });
  assert.equal(anon.status, 401);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const headers = { Authorization: "Bearer " + (await login.json()).token, "Content-Type": "application/json" };

  const detail = await (await fetch(baseUrl + "/api/admin/orders/PTY-261012-CARGO1", { headers })).json();
  assert.deepEqual(detail.cargo, { configured: false, mode: "test", shipment: null, labelUrl: null });

  const create = await fetch(baseUrl + "/api/admin/orders/PTY-261012-CARGO1/cargo", {
    method: "POST",
    headers,
    body: JSON.stringify({ desi: 1 }),
  });
  assert.equal(create.status, 503);
  assert.match((await create.json()).error, /Yurtiçi/);

  const forged = await fetch(baseUrl + "/api/cargo-labels/PTY-261012-CARGO1/a5?exp=9999999999&sig=" + "0".repeat(64));
  assert.equal(forged.status, 403);
  assert.match(forged.headers.get("cache-control") || "", /no-store/);
});

test("panel kargo tab wires Yurtiçi create/refresh/cancel/label to the cargo API", () => {
  const panel = fs.readFileSync(path.join(ROOT, "assets", "js", "admin-panel.js"), "utf8");
  assert.match(panel, /function orderCargoHtml\(order\)/);
  assert.match(panel, /orderCargoHtml\(order\) \+/);
  assert.match(panel, /"\/api\/admin\/orders\/" \+ encodeURIComponent\(orderId\) \+ "\/cargo" \+ path/);
  assert.match(panel, /id='adminCargoDesi' min='0\.1' max='1000' step='0\.1' value='1'/);
  assert.match(panel, /Etiketi yazdır \(A5\)/);
  assert.match(panel, /order\._cargo = data\.cargo \|\| null/);
  assert.match(panel, /bindCargoActions\(orderId\);/);
});

test("server polls Yurtiçi every 30 minutes and .env.example documents the credentials", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(server, /CARGO_SYNC_INTERVAL_MS = 30 \* 60 \* 1000/);
  assert.match(server, /cargoShipments\.sync\(\)/);
  const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.match(example, /# YURTICI_WS_USER=\r?\n/);
  assert.match(example, /# YURTICI_WS_PASSWORD=\r?\n/);
  assert.match(example, /87\.76\.157\.41/);
});
