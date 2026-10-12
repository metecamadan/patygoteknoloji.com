const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const site = read("deploy/nginx-patygoteknoloji.com.conf");
const hardening = read("deploy/nginx-patygo-hardening.conf");
const block = (head) => {
  const start = site.indexOf("\n  " + head + " {");
  assert.ok(start >= 0, head + " bloğu yok");
  return site.slice(start, site.indexOf("\n  }", start) + 4);
};

test("nginx: HTTP/2, a year for ?v= assets, an hour for unversioned ones, never for the panel", () => {
  assert.match(site, /listen 443 ssl http2;/);
  assert.match(site, /map \$arg_v \$patygo_asset_expires \{\s*""\s+1h;\s*default 1y;\s*\}/);
  assert.match(site, /map \$arg_v \$patygo_asset_cache_control \{\s*""\s+"public";\s*default "public, immutable";\s*\}/);
  const assets = block("location ^~ /assets/");
  assert.match(assets, /expires \$patygo_asset_expires;/);
  assert.match(assets, /add_header Cache-Control \$patygo_asset_cache_control always;/);
  const admin = block("location = /admin");
  assert.match(admin, /add_header Cache-Control "no-store" always;/);
  assert.match(admin, /expires off;/);
  assert.match(admin, /error_page 405 = @node;/);
});

test("nginx: the repo copy keeps what is live (bot block, rate limits, micro-cache, TLS, port 80)", () => {
  assert.match(site, /if \(\$patygo_bot_block\) \{ return 403; \}/);
  assert.match(block("location ^~ /api/"), /limit_req zone=patygo_ip\s+burst=30 nodelay;/);
  for (const head of ["location = /urun-detay", "location @node"]) {
    const b = block(head);
    assert.match(b, /proxy_cache patygo_cache;/, head);
    assert.match(b, /proxy_no_cache\s+\$patygo_nocache;/, head);
  }
  assert.match(site, /ssl_certificate \/etc\/letsencrypt\/live\/patygoteknoloji\.com\/fullchain\.pem;/);
  assert.match(site, /listen 80 default_server;/);
  // Every zone and variable the site uses is defined in the hardening file.
  for (const name of ["zone=patygo_bots:", "zone=patygo_ip:", "keys_zone=patygo_cache:", "$patygo_nocache", "$patygo_bot_block"]) {
    assert.ok(hardening.includes(name), name);
  }
  assert.match(hardening, /"~\*\^\/admin"\s+1;/, "panel micro-cache'e girmez");
});

function pythonCommand() {
  for (const cmd of ["python3", "python"]) {
    const probe = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (probe.status === 0 && /Python 3/.test(probe.stdout + probe.stderr)) return cmd;
  }
  return "";
}

test("deploy's ensure-*-nginx.sh helpers, run in deploy order, leave the repo nginx file unchanged", (t) => {
  const python = pythonCommand();
  if (!python) {
    if (process.env.CI) assert.fail("python3 gerekli");
    t.skip("python yok");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-nginx-"));
  const conf = path.join(dir, "site.conf");
  fs.writeFileSync(conf, site.replace(/\r\n/g, "\n"));
  const redirects = "/var/www/patygoteknoloji.com/.runtime/nginx/legacy-product-redirects.conf";
  const helpers = [
    ["scripts/ensure-sitemap-nginx.sh", [conf, "5173"]],
    ["scripts/ensure-product-shell-nginx.sh", [conf, redirects, "5173"]],
    ["scripts/ensure-admin-api-nginx.sh", [conf, "5173"]],
  ];
  for (const [script, args] of helpers) {
    const source = read(script).replace(/\r\n/g, "\n");
    const body = source.match(/<<'PY'\n([\s\S]*?)\nPY\n/);
    assert.ok(body, script + " python bölümü");
    const pyFile = path.join(dir, path.basename(script) + ".py");
    fs.writeFileSync(pyFile, body[1]);
    const run = spawnSync(python, [pyFile, ...args], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(run.status, 0, script + ": " + run.stderr);
  }
  // Deploy runs them back to back and records the result; only the end state has to match.
  // Windows Python writes CRLF, the server does not.
  const after = fs.readFileSync(conf, "utf8").replace(/\r/g, "");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(after, site.replace(/\r\n/g, "\n"), "ensure-*-nginx.sh betikleri repo dosyasını değiştirdi");
});

test("install-nginx-conf.sh: stops on a hand edit, restores on a failed nginx -t, records after the helpers", () => {
  const script = read("scripts/install-nginx-conf.sh");
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /was edited on the server after the last deploy/);
  assert.match(script, /\[ "\$\{drift\}" = "0" \] \|\| exit 1/);
  assert.match(script, /mktemp -d \/root\//, "yedek sites-enabled dışında");
  assert.match(script, /if ! nginx -t; then[\s\S]*cat "\$\{BACKUP_DIR\}\/\$\{name\}\.old" > "\$\{dest\}"[\s\S]*exit 1/);
  assert.match(script, /tr -d '\\r'/);
  assert.match(script, /\/etc\/nginx\/sites-available\/patygoteknoloji\.com/);
  assert.match(script, /\/etc\/nginx\/conf\.d\/00-patygo-hardening\.conf/);

  const workflow = read(".github/workflows/ci-deploy.yml");
  const install = workflow.indexOf('install-nginx-conf.sh" install "$APP_DIR"');
  const firstHelper = workflow.indexOf('bash "$APP_DIR/scripts/ensure-sitemap-nginx.sh"');
  const lastHelper = workflow.indexOf('bash "$APP_DIR/scripts/ensure-admin-api-nginx.sh"');
  const record = workflow.indexOf('install-nginx-conf.sh" record "$APP_DIR"');
  assert.ok(install > 0 && install < firstHelper, "repo dosyası yardımcılardan önce kurulur");
  assert.ok(record > lastHelper, "kayıt yardımcılardan sonra");
  assert.doesNotMatch(workflow, /install-nginx-conf\.sh" install "\$APP_DIR" \|\|/, "kurulum hatası gizlenmez");
  assert.match(workflow, /--http2 -w '%\{http_version\}'/);
  assert.match(workflow, /cache-control: public, immutable/);
  assert.match(workflow, /cache-control: no-store/);
  assert.match(read(".gitattributes"), /deploy\/\*\.conf text eol=lf/);
});
