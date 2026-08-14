const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnTestServer } = require("./helpers/spawn-server");

test("admin supplier APIs require authentication and return feed status", async (t) => {
  const password = "test-admin-password";
  const { baseUrl } = await spawnTestServer(t, {
    ADMIN_PASSWORD: password,
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });

  const unauthorized = await fetch(baseUrl + "/api/admin/supplier/status");
  assert.equal(unauthorized.status, 401);
  const analyticsUnauthorized = await fetch(baseUrl + "/api/admin/analytics?days=30");
  assert.equal(analyticsUnauthorized.status, 401);

  const tracked = await fetch(baseUrl + "/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "page_view",
      path: "/urunler.html?campaign=test",
      sessionId: "integration-session",
    }),
  });
  assert.equal(tracked.status, 202);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.match(session.token, /^[a-f0-9]{48}$/);

  const status = await fetch(baseUrl + "/api/admin/supplier/status", {
    headers: { Authorization: "Bearer " + session.token },
  });
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(typeof payload.status.configured, "boolean");
  assert.equal(payload.slots.length, 3);
  assert.deepEqual(
    payload.slots.map((slot) => slot.id),
    ["supplier-1", "supplier-2", "supplier-3"]
  );
  assert.equal(typeof payload.feed.activeCount, "number");
  assert.ok(Array.isArray(payload.feed.issues));
  assert.equal(typeof payload.feed.catalogActiveCount, "number");
  assert.equal(typeof payload.feed.reasonCounts, "object");
  assert.equal(payload.feed.publicUrl, baseUrl + "/api/feeds/akakce.xml");
  assert.ok(payload.feed.catalogActiveCount >= payload.feed.activeCount);

  const analytics = await fetch(baseUrl + "/api/admin/analytics?days=30", {
    headers: { Authorization: "Bearer " + session.token },
  });
  assert.equal(analytics.status, 200);
  const analyticsPayload = await analytics.json();
  assert.ok(analyticsPayload.analytics.pageViews >= 1);
  assert.equal(analyticsPayload.analytics.periodDays, 30);

  const dashboard = await fetch(baseUrl + "/api/admin/dashboard?days=30", {
    headers: { Authorization: "Bearer " + session.token },
  });
  assert.equal(dashboard.status, 200);
  const dash = await dashboard.json();
  assert.equal(dash.ok, true);
  assert.ok(dash.analytics.pageViews >= 1);
  assert.equal(typeof dash.commerce.revenue, "number");
  assert.equal(typeof dash.commerce.aov, "number");
  assert.equal(dash.process.apiReachable, true);
  assert.equal(typeof dash.process.uptimeSec, "number");
  assert.ok(dash.leadsNote);

  const privateData = await fetch(baseUrl + "/assets/data/products.json");
  assert.equal(privateData.status, 404);
  assert.equal(privateData.headers.get("x-frame-options"), "DENY");
  assert.match(
    privateData.headers.get("content-security-policy") || "",
    /default-src 'self'/
  );
  assert.match(
    privateData.headers.get("strict-transport-security") || "",
    /max-age=/
  );

  const publicCatalog = await fetch(baseUrl + "/api/products");
  assert.equal(publicCatalog.status, 200);
  const publicPayload = await publicCatalog.json();
  assert.ok(Array.isArray(publicPayload.products));
  for (const product of publicPayload.products) {
    assert.equal(Object.prototype.hasOwnProperty.call(product, "source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(product, "costPrice"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(product, "supplierSku"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(product, "stockQty"), false);
  }

  const feed = await fetch(baseUrl + "/api/feeds/akakce.xml");
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get("content-type"), /application\/xml/);
  assert.match(await feed.text(), /^<\?xml version="1.0"/);
});

test("admin sessions expire after idle timeout and slide on activity", async (t) => {
  const password = "test-admin-password";
  const { baseUrl } = await spawnTestServer(t, {
    ADMIN_PASSWORD: password,
    ADMIN_IDLE_MS: "400",
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { Authorization: "Bearer " + session.token };

  const first = await fetch(baseUrl + "/api/admin/products", { headers });
  assert.equal(first.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 50));
  const refreshed = await fetch(baseUrl + "/api/admin/products", { headers });
  assert.equal(refreshed.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const expired = await fetch(baseUrl + "/api/admin/products", { headers });
  assert.equal(expired.status, 401);
});

test("admin login does not lock out after repeated wrong attempts", async (t) => {
  const password = "1234";
  const { baseUrl } = await spawnTestServer(t, {
    ADMIN_PASSWORD: password,
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });

  for (let i = 0; i < 10; i += 1) {
    const wrong = await fetch(baseUrl + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    assert.equal(wrong.status, 401);
  }

  const correct = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(correct.status, 200);
  const session = await correct.json();
  assert.match(session.token, /^[a-f0-9]{48}$/);
});

test("legacy patygo-admin env password maps to 1234 for login", async (t) => {
  const { baseUrl } = await spawnTestServer(t, {
    ADMIN_PASSWORD: "patygo-admin",
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });

  const legacy = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "patygo-admin" }),
  });
  assert.equal(legacy.status, 401);

  const updated = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "1234" }),
  });
  assert.equal(updated.status, 200);
});

test("agent-ops ingest accepts keyed prompt events without admin session", async (t) => {
  const ingestKey = "test-ingest-key";
  const { baseUrl } = await spawnTestServer(t, {
    ADMIN_PASSWORD: "test-admin-password",
    AGENT_OPS_INGEST_KEY: ingestKey,
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });

  const denied = await fetch(baseUrl + "/api/agent-ops/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "prompt", from: "user", summary: "no key" }),
  });
  assert.equal(denied.status, 401);

  const accepted = await fetch(baseUrl + "/api/agent-ops/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Ops-Key": ingestKey,
    },
    body: JSON.stringify({
      type: "prompt",
      from: "user",
      to: "orchestrator",
      summary: "Agent ops canlı görünsün",
      status: "live",
    }),
  });
  assert.equal(accepted.status, 200);
  const payload = await accepted.json();
  assert.equal(payload.event.type, "prompt");
});
