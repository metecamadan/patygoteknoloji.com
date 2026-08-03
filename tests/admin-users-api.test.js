const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnTestServer } = require("./helpers/spawn-server");

test("admin users API creates accounts and email login works", async (t) => {
  const password = "users-admin-pass";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password });

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
