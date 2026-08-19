const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAdminSessionStore } = require("../lib/admin-sessions");

test("admin session store persists and restores valid sessions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-admin-sess-"));
  const storeA = createAdminSessionStore(root, { idleMs: 60_000 });
  const session = storeA.create("token-abc", { userId: "user-1", mustChangePassword: false });
  assert.ok(session.exp > Date.now());

  const storeB = createAdminSessionStore(root, { idleMs: 60_000 });
  const restored = storeB.get("token-abc");
  assert.ok(restored);
  assert.equal(restored.userId, "user-1");
  assert.equal(restored.mustChangePassword, false);
});

test("admin session store removes expired sessions on load", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-admin-sess-"));
  fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".runtime", "admin-sessions.json"),
    JSON.stringify({
      expired: { exp: Date.now() - 1000, userId: null, mustChangePassword: false },
      live: { exp: Date.now() + 60_000, userId: "live-user", mustChangePassword: false },
    }),
    "utf8"
  );
  const store = createAdminSessionStore(root, { idleMs: 60_000 });
  assert.equal(store.get("expired"), null);
  assert.equal(store.get("live").userId, "live-user");
});
