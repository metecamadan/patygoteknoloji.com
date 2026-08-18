const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createAdminSecurityStore,
  MIN_ADMIN_PASSWORD_LENGTH,
} = require("../lib/admin-security");

test("admin security forces change for short passwords", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-admin-sec-"));
  const store = createAdminSecurityStore(root);
  assert.equal(store.shouldForcePasswordChange("1234"), true);
  assert.equal(store.shouldForcePasswordChange("long-enough-pass"), false);
  store.activateForcePasswordChange("test");
  assert.equal(store.shouldForcePasswordChange("long-enough-pass"), true);
  store.clearForcePasswordChange();
  assert.equal(store.shouldForcePasswordChange("long-enough-pass"), false);
  assert.throws(() => store.validateNewPassword("short"), /12 karakter/);
  assert.equal(store.validateNewPassword("twelvechars!"), "twelvechars!");
  assert.equal(MIN_ADMIN_PASSWORD_LENGTH, 12);
  fs.rmSync(root, { recursive: true, force: true });
});
