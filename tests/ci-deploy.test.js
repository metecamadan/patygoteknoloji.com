const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const deployScript = fs.readFileSync(path.join(root, "scripts", "deploy-production.sh"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("package postinstall runs deploy env sync without workflow file changes", () => {
  assert.equal(packageJson.scripts.postinstall, "node scripts/post-deploy-sync.js");
});

test("deploy script syncs ADMIN_PASSWORD into server .env", () => {
  assert.match(deployScript, /ADMIN_PASSWORD synced from GitHub secret/);
  assert.match(deployScript, /grep -q '\^ADMIN_PASSWORD='/);
});

test("post-deploy sync migrates legacy patygo-admin in .env to 1234", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-postinstall-"));
  const envPath = path.join(tmp, ".env");
  fs.writeFileSync(envPath, "ADMIN_PASSWORD=patygo-admin\nSITE_BASE_URL=https://patygoteknoloji.com\n");

  const scriptPath = path.join(root, "scripts", "post-deploy-sync.js");
  const patched = fs.readFileSync(scriptPath, "utf8").replace(
    'path.join(root, ".env")',
    JSON.stringify(envPath)
  );
  const patchedPath = path.join(tmp, "post-deploy-sync.js");
  fs.writeFileSync(patchedPath, patched);

  const result = spawnSync(process.execPath, [patchedPath], { cwd: tmp, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const updated = fs.readFileSync(envPath, "utf8");
  assert.match(updated, /^ADMIN_PASSWORD=1234$/m);
  assert.doesNotMatch(updated, /^ADMIN_PASSWORD=patygo-admin$/m);
});

test("CI deploy job SSHes into production after tests pass", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "ci-deploy.yml"),
    "utf8"
  );
  assert.match(workflow, /appleboy\/ssh-action/);
  assert.match(workflow, /needs: test/);
  assert.match(workflow, /git reset --hard origin\/main/);
  assert.match(workflow, /pm2 restart/);
  assert.match(workflow, /\/api\/payment\/status/);
  assert.match(workflow, /while \[ "\$i" -lt 30 \]/);
  assert.doesNotMatch(workflow, /Confirm VPS pull-deploy/);
});

test("nginx serves checkout HTML from disk when Node is busy", () => {
  const nginx = fs.readFileSync(
    path.join(root, "deploy", "nginx-patygoteknoloji.com.conf"),
    "utf8"
  );
  assert.match(nginx, /try_files \$uri\.html @node/);
  assert.match(nginx, /location \^~ \/api\//);
  assert.match(nginx, /location = \/assets\/data\/categories\.json[\s\S]*rewrite \^ \/listing\/categories\.json last/);
  assert.match(nginx, /location \^~ \/assets\/data\/ \{\s*return 404;/);
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /gzip_proxied any;/);
  assert.match(nginx, /expires 1h;/);
  const urunlerBlock = nginx.match(/location = \/urunler \{[\s\S]*?\n  \}/);
  assert.ok(urunlerBlock, "urunler nginx block missing");
  assert.doesNotMatch(urunlerBlock[0], /proxy_pass/);
  assert.match(urunlerBlock[0], /try_files \/urunler\.html/);
  assert.match(nginx, /location \^~ \/media\/catalog\//);
  assert.match(nginx, /location \^~ \/listing\//);
  assert.doesNotMatch(nginx, /location = \/listing\/categories\.json/);
  assert.match(nginx, /alias \/var\/www\/patygoteknoloji\.com\/\.runtime\/catalog-bootstrap\//);
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverJs, /scheduleStartupCatalogWarm/);
  assert.match(serverJs, /STARTUP_WARM_DEFER_MS/);
  assert.match(serverJs, /bootstrapSnapshotsReady/);
  assert.match(serverJs, /\/api\/catalog-bootstrap/);
});
