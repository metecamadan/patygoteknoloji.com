const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const hook = path.join(root, ".cursor", "hooks", "run-tests-on-stop.js");

test("stop hook invokes node --test via process.execPath (not bare npm)", () => {
  const source = fs.readFileSync(hook, "utf8");
  assert.match(source, /process\.execPath/);
  assert.match(source, /"--test"/);
  assert.match(source, /PATYGO_HOOK_DRY_RUN/);
  assert.doesNotMatch(source, /spawnSync\(\s*["']npm["']/);
});

test("cursor hooks do not ingest agent-ops prompts", () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8")
  );
  assert.deepEqual(Object.keys(config.hooks || {}), ["stop"]);
  assert.equal(fs.existsSync(path.join(root, ".cursor", "hooks", "agent-ops-live.js")), false);
  assert.equal(fs.existsSync(path.join(root, "agent-ops.html")), false);
});

test("stop hook dry-run reports ok without nesting the suite", () => {
  const result = spawnSync(process.execPath, [hook], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ status: "completed" }),
    timeout: 5000,
    env: Object.assign({}, process.env, { PATYGO_HOOK_DRY_RUN: "1" }),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "{}");
});
