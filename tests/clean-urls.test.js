const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Test sunucusu erken kapandı.");
    try {
      const response = await fetch(baseUrl + "/api/payment/status");
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Test sunucusu zamanında başlamadı.");
}

test("clean URLs serve HTML and redirect .html aliases", async (t) => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      ADMIN_PASSWORD: "test-admin-password",
      SITE_BASE_URL: `http://127.0.0.1:${port}`,
    }),
    stdio: "ignore",
  });
  t.after(() => child.kill());
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

  const clean = await fetch(baseUrl + "/urunler");
  assert.equal(clean.status, 200);
  assert.match(await clean.text(), /Ürünler/i);

  const aliased = await fetch(baseUrl + "/urunler.html", { redirect: "manual" });
  assert.equal(aliased.status, 301);
  assert.equal(aliased.headers.get("location"), "/urunler");

  const indexAlias = await fetch(baseUrl + "/index.html", { redirect: "manual" });
  assert.equal(indexAlias.status, 301);
  assert.equal(indexAlias.headers.get("location"), "/");

  const withQuery = await fetch(baseUrl + "/urun-detay.html?id=demo", { redirect: "manual" });
  assert.equal(withQuery.status, 301);
  assert.equal(withQuery.headers.get("location"), "/urun-detay?id=demo");

  const trailing = await fetch(baseUrl + "/markalar/", { redirect: "manual" });
  assert.equal(trailing.status, 301);
  assert.equal(trailing.headers.get("location"), "/markalar");
});
