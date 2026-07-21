const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Test sunucusu erken kapandı.");
    try {
      const response = await fetch(baseUrl + "/api/products");
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Test sunucusu zamanında başlamadı.");
}

test("admin supplier APIs require authentication and return feed status", async (t) => {
  const port = await getFreePort();
  const password = "test-admin-password";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      ADMIN_PASSWORD: password,
      SITE_BASE_URL: `http://127.0.0.1:${port}`,
      SUPPLIER_ALLOWED_HOSTS: "supplier.example",
    }),
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

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
  assert.equal(dash.server.status, "online");
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

  const feed = await fetch(baseUrl + "/api/feeds/akakce.xml");
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get("content-type"), /application\/xml/);
  assert.match(await feed.text(), /^<\?xml version="1.0"/);
});
