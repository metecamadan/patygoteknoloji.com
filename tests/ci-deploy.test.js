const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci-deploy.yml"), "utf8");
const deployScript = fs.readFileSync(path.join(root, "scripts", "deploy-production.sh"), "utf8");

test("deploy workflow passes ADMIN_PASSWORD secret to SSH deploy", () => {
  assert.match(workflow, /ADMIN_PASSWORD: \$\{\{ secrets\.ADMIN_PASSWORD \}\}/);
  assert.match(workflow, /envs: ADMIN_PASSWORD/);
  assert.match(workflow, /bash scripts\/deploy-production\.sh/);
});

test("deploy script syncs ADMIN_PASSWORD into server .env", () => {
  assert.match(deployScript, /ADMIN_PASSWORD synced from GitHub secret/);
  assert.match(deployScript, /grep -q '\^ADMIN_PASSWORD='/);
});
