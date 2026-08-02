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

test("admin calendar APIs require auth and persist reminders/notes", async (t) => {
  const port = await getFreePort();
  const password = "calendar-admin-pass";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      ADMIN_PASSWORD: password,
      SITE_BASE_URL: `http://127.0.0.1:${port}`,
    }),
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

  const unauthorized = await fetch(baseUrl + "/api/admin/calendar");
  assert.equal(unauthorized.status, 401);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const auth = { Authorization: "Bearer " + session.token };

  const created = await fetch(baseUrl + "/api/admin/calendar", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, auth),
    body: JSON.stringify({
      type: "reminder",
      date: "2026-07-30",
      time: "14:00",
      title: "Canlı kontrol",
      body: "Deploy sonrası smoke",
      notifyEmail: "ops@example.com",
    }),
  });
  assert.equal(created.status, 200);
  const createdPayload = await created.json();
  assert.equal(createdPayload.ok, true);
  assert.equal(createdPayload.entry.type, "reminder");
  assert.equal(createdPayload.entry.notifyEmail, "ops@example.com");
  assert.equal(createdPayload.mailQueued, true);
  const entryId = createdPayload.entry.id;

  const listed = await fetch(
    baseUrl + "/api/admin/calendar?from=2026-07-01&to=2026-07-31",
    { headers: auth }
  );
  assert.equal(listed.status, 200);
  const listPayload = await listed.json();
  assert.ok(listPayload.entries.some((row) => row.id === entryId));

  const updated = await fetch(baseUrl + "/api/admin/calendar/" + entryId, {
    method: "PUT",
    headers: Object.assign({ "Content-Type": "application/json" }, auth),
    body: JSON.stringify({ title: "Canlı kontrol — tamam", done: true }),
  });
  assert.equal(updated.status, 200);
  const updatedPayload = await updated.json();
  assert.equal(updatedPayload.entry.done, true);

  const removed = await fetch(baseUrl + "/api/admin/calendar/" + entryId, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(removed.status, 200);
});
