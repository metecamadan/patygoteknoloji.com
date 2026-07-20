const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("public pages use clean URLs and resolve without broken hrefs", () => {
  const result = spawnSync(process.execPath, ["scripts/check-links.js"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
});
