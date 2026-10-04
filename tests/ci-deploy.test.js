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
  assert.match(workflow, /data-catalog-infinite/);
  assert.match(workflow, /set -euo pipefail/);
  assert.doesNotMatch(
    workflow,
    /curl [^\n|]*\|\s*grep -q/,
    "under pipefail, curl | grep -q fails with curl (23) on large bodies once grep exits early"
  );
  assert.match(workflow, /fetch_has "http:\/\/127\.0\.0\.1:\$\{APP_PORT\}\/sitemap" 'urunler\/'/);
  assert.match(workflow, /ensure-sitemap-nginx\.sh/);
  assert.match(workflow, /ensure-product-shell-nginx\.sh/);
  assert.match(workflow, /\/bilgisayar-tablet/);
  assert.doesNotMatch(workflow, /data-catalog-pager/);
  assert.doesNotMatch(workflow, /Confirm VPS pull-deploy/);
  const ensureNginx = fs.readFileSync(
    path.join(root, "scripts", "ensure-sitemap-nginx.sh"),
    "utf8"
  );
  assert.match(ensureNginx, /location = \/sitemap\.xml/);
  assert.match(ensureNginx, /systemctl reload nginx/);
  assert.match(ensureNginx, /removed .* existing location|existing location = \/sitemap\.xml/);
  assert.match(ensureNginx, /re\.DOTALL|DOTALL/);
  const ensureProductShell = fs.readFileSync(
    path.join(root, "scripts", "ensure-product-shell-nginx.sh"),
    "utf8"
  );
  assert.match(ensureProductShell, /location ~ \^\/\[a-z0-9-\]\+\/\[a-z0-9-\]\+\/\?\$/);
  assert.match(ensureProductShell, /try_files \/urun-detay\.html =404/);
  assert.match(ensureProductShell, /systemctl reload nginx/);
  assert.match(ensureProductShell, /inserted before location \//);
  assert.doesNotMatch(ensureProductShell, /proxy_pass/);
  assert.match(ensureProductShell, /\.runtime\/nginx\/legacy-product-redirects\.conf/);
  assert.match(ensureProductShell, /include \{redirects_file\};/);
  assert.match(ensureProductShell, /\[ -f "\$\{REDIRECTS_FILE\}" \] \|\| : > "\$\{REDIRECTS_FILE\}"/);
  assert.match(ensureProductShell, /if ! nginx -t; then[\s\S]*cat "\$\{BACKUP\}" > "\$\{NGINX_CONF\}"[\s\S]*exit 1/);
  assert.match(ensureProductShell, /mktemp \/root\//, "backup must stay outside sites-enabled");
  assert.match(ensureProductShell, /PathChanged=\$\{REDIRECTS_FILE\}/);
  assert.match(ensureProductShell, /nginx -t -q && systemctl reload nginx/);
  assert.doesNotMatch(ensureProductShell, /map_hash_/, "map_hash_* must precede every map in http; other sites define maps first");
});

test("deploy does not install extra SSH keys on the VPS", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci-deploy.yml"), "utf8");
  assert.doesNotMatch(workflow, /ensure-agent-ssh-key|agent-laptop/);
  assert.doesNotMatch(workflow, />>\s*\S*authorized_keys/);
  assert.equal(fs.existsSync(path.join(root, "scripts", "ensure-agent-ssh-key.sh")), false);
  assert.equal(fs.existsSync(path.join(root, "deploy", "agent-laptop.pub")), false);
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
  const urunlerPathBlock = nginx.match(/location \^~ \/urunler\/ \{[\s\S]*?\n  \}/);
  assert.ok(urunlerPathBlock, "urunler path nginx block missing");
  assert.doesNotMatch(urunlerPathBlock[0], /proxy_pass/);
  assert.match(urunlerPathBlock[0], /try_files \/urunler\.html/);
  const productSeoBlock = nginx.match(
    /location ~ \^\/\[a-z0-9-\]\+\/\[a-z0-9-\]\+\/\?\$ \{[\s\S]*?\n  \}/
  );
  assert.ok(productSeoBlock, "product SEO nginx block missing");
  assert.doesNotMatch(productSeoBlock[0], /proxy_pass/);
  assert.match(productSeoBlock[0], /try_files \/urun-detay\.html =404/);
  assert.match(
    nginx,
    /include \/var\/www\/patygoteknoloji\.com\/\.runtime\/nginx\/legacy-product-redirects\.conf;\r?\n  location ~ \^\/\[a-z0-9-\]\+/
  );
  assert.doesNotMatch(nginx, /map_hash_|patygo_legacy_product/);
  assert.match(
    nginx,
    /try_files \/urun-detay\.html =404;[\s\S]*?location \/ \{/
  );
  assert.match(nginx, /location \^~ \/media\/catalog\//);
  assert.match(nginx, /location \^~ \/listing\//);
  assert.doesNotMatch(nginx, /location = \/listing\/categories\.json/);
  assert.match(nginx, /alias \/var\/www\/patygoteknoloji\.com\/\.runtime\/catalog-bootstrap\//);
  assert.match(nginx, /location = \/sitemap\.xml[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:5173/);
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(serverJs, /scheduleStartupCatalogWarm/);
  assert.match(serverJs, /STARTUP_WARM_DEFER_MS/);
  assert.match(serverJs, /bootstrapSnapshotsReady/);
  assert.match(serverJs, /\/api\/catalog-bootstrap/);
});
