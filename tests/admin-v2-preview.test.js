const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

const root = path.join(__dirname, "..");

test("admin v2 preview mock is not shipped", () => {
  assert.equal(fs.existsSync(path.join(root, "admin-v2-preview.html")), false);
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, "admin.html"), "utf8"),
    /admin-v2-preview|Admin Panel v2/
  );
});
