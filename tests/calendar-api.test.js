const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnTestServer } = require("./helpers/spawn-server");

test("admin calendar APIs require auth and persist reminders/notes", async (t) => {
  const password = "calendar-admin-pass";
  const { baseUrl } = await spawnTestServer(t, { ADMIN_PASSWORD: password });

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
      notifyEmail: "ops@patygoteknoloji.com",
    }),
  });
  assert.equal(created.status, 200);
  const createdPayload = await created.json();
  assert.equal(createdPayload.ok, true);
  assert.equal(createdPayload.entry.type, "reminder");
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

  const removed = await fetch(baseUrl + "/api/admin/calendar/" + entryId, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(removed.status, 200);
});
