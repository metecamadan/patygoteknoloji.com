const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAdminUserStore } = require("../lib/admin-users");

test("admin user store creates and authenticates users", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-users-"));
  const store = createAdminUserStore(root);
  const user = store.create(
    {
      firstName: "Mete",
      lastName: "Camadan",
      email: "mete@patygoteknoloji.com",
      password: "secret12",
    },
    { role: "owner" }
  );
  assert.match(user.id, /^[a-f0-9]{16}$/);
  assert.equal(user.email, "mete@patygoteknoloji.com");
  assert.equal(user.role, "owner");
  assert.ok(!user.passwordHash);
  assert.equal(store.authenticate("mete@patygoteknoloji.com", "secret12").id, user.id);
  assert.equal(store.authenticate("mete@patygoteknoloji.com", "wrong"), null);
  assert.throws(
    () =>
      store.create({
        firstName: "A",
        lastName: "B",
        email: "mete@patygoteknoloji.com",
        password: "xxxx",
      }),
    /kayıtlı/i
  );
});

test("admin user store protects last owner from delete", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-users-owner-"));
  const store = createAdminUserStore(root);
  const owner = store.create(
    {
      firstName: "Owner",
      lastName: "One",
      email: "owner@patygoteknoloji.com",
      password: "secret12",
    },
    { role: "owner" }
  );
  assert.throws(() => store.remove(owner.id), /sahip/i);
});
