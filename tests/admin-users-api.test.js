const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdminUserStore } = require("../lib/admin-users");
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

test("named owner login is not blocked by a weak env ADMIN_PASSWORD", async (t) => {
  const { baseUrl, dataRoot } = await spawnTestServer(t, {
    NODE_ENV: "production",
    ADMIN_PASSWORD: "1234",
    SITE_BASE_URL: "https://patygoteknoloji.com",
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });
  const email = "owner-gate@patygoteknoloji.com";
  createAdminUserStore(dataRoot).create(
    {
      firstName: "Mete",
      lastName: "Camadan",
      email,
      password: "named-owner-pass",
    },
    { role: "owner" }
  );
  const emailLogin = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "named-owner-pass" }),
  });
  assert.equal(emailLogin.status, 200);
  const session = await emailLogin.json();
  assert.equal(session.mustChangePassword, false);
  const me = await fetch(baseUrl + "/api/admin/me", {
    headers: { Authorization: "Bearer " + session.token },
  });
  assert.equal(me.status, 200);
  const profile = await me.json();
  assert.equal(profile.mustChangePassword, false);
});

test("legacy password change also updates the owner email login", async (t) => {
  const { baseUrl, dataRoot } = await spawnTestServer(t, {
    NODE_ENV: "production",
    ADMIN_PASSWORD: "1234",
    SITE_BASE_URL: "https://patygoteknoloji.com",
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });
  const email = "owner-sync@patygoteknoloji.com";
  createAdminUserStore(dataRoot).create(
    {
      firstName: "Mete",
      lastName: "Camadan",
      email,
      password: "old-owner-pass",
    },
    { role: "owner" }
  );
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "1234" }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.mustChangePassword, true);
  const changed = await fetch(baseUrl + "/api/admin/change-password", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + session.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: "1234",
      newPassword: "panel-strong-pass",
      confirmPassword: "panel-strong-pass",
    }),
  });
  assert.equal(changed.status, 200);
  const emailLogin = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "panel-strong-pass" }),
  });
  assert.equal(emailLogin.status, 200);
  const emailSession = await emailLogin.json();
  assert.equal(emailSession.ok, true);
  assert.equal(emailSession.user.email, email);
});
