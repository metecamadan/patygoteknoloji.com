const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
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

test("admin users API creates accounts and email login works", async (t) => {
  const port = await getFreePort();
  const password = "users-admin-pass";
  const runtimeUsers = path.join(root, ".runtime", "admin-users.json");
  const backup = fs.existsSync(runtimeUsers) ? fs.readFileSync(runtimeUsers) : null;

  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      ADMIN_PASSWORD: password,
      SITE_BASE_URL: `http://127.0.0.1:${port}`,
    }),
    stdio: "ignore",
  });
  t.after(() => {
    child.kill();
    try {
      if (backup) fs.writeFileSync(runtimeUsers, backup);
      else if (fs.existsSync(runtimeUsers)) fs.unlinkSync(runtimeUsers);
    } catch (_) {}
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const auth = { Authorization: "Bearer " + session.token };

  const email = "ayse-test-" + Date.now() + "@patygoteknoloji.com";
  const created = await fetch(baseUrl + "/api/admin/users", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, auth),
    body: JSON.stringify({
      firstName: "Ayşe",
      lastName: "Yılmaz",
      email,
      password: "panel-pass-1",
    }),
  });
  assert.equal(created.status, 200);
  const createdPayload = await created.json();
  assert.equal(createdPayload.ok, true);
  assert.equal(createdPayload.user.firstName, "Ayşe");

  const emailLogin = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "panel-pass-1",
    }),
  });
  assert.equal(emailLogin.status, 200);
  const emailSession = await emailLogin.json();
  assert.ok(emailSession.token);
  assert.equal(emailSession.user.email, email);
});
