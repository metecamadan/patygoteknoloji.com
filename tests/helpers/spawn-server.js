const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { resetDbForTests } = require("../../lib/db");

const projectRoot = path.resolve(__dirname, "..", "..");

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

async function waitForServer(baseUrl, child, getStderr) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const detail = typeof getStderr === "function" ? getStderr() : "";
      throw new Error(
        "Test sunucusu erken kapandı." + (detail ? " " + detail : "")
      );
    }
    try {
      const response = await fetch(baseUrl + "/api/payment/status");
      if (response.ok) return;
    } catch (_) {}
    try {
      const response = await fetch(baseUrl + "/api/products");
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Test sunucusu zamanında başlamadı.");
}

const PORT_IN_USE = /portu kullanımda/;
const MAX_PORT_ATTEMPTS = 5;

async function spawnTestServer(t, envExtra, options) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-data-"));
  let child = null;
  t.after(() => {
    if (child) child.kill();
    resetDbForTests();
    try {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    } catch (_) {}
  });
  seedDataRoot(dataRoot, options);

  // getFreePort ile listen arasında paralel test dosyaları aynı portu kapabilir.
  async function attempt(remaining) {
    const port = await getFreePort();
    const stderrChunks = [];
    const readStderr = () => Buffer.concat(stderrChunks).toString("utf8").trim().slice(-1500);
    child = spawn(process.execPath, ["server.js"], {
      cwd: projectRoot,
      env: Object.assign({}, process.env, {
        PORT: String(port),
        PATYGO_DATA_ROOT: dataRoot,
        SITE_BASE_URL: `http://127.0.0.1:${port}`,
        SMTP_HOST: "",
        SMTP_USER: "",
        SMTP_PASS: "",
        FX_AUTO_REFRESH: "0",
      }, envExtra || {}),
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
      if (stderrChunks.length > 40) stderrChunks.shift();
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      await waitForServer(baseUrl, child, readStderr);
    } catch (err) {
      if (remaining > 1 && child.exitCode !== null && PORT_IN_USE.test(readStderr())) {
        return attempt(remaining - 1);
      }
      throw err;
    }
    const current = child;
    /** Sunucu tamamen kapanınca çözülür; sonrasında test veritabanını güvenle okuyabilir. */
    function stop() {
      if (current.exitCode !== null || current.signalCode !== null) return Promise.resolve();
      return new Promise((resolve) => {
        current.once("exit", () => resolve());
        current.kill();
      });
    }
    return { port, baseUrl, child: current, dataRoot, stop };
  }

  return attempt(MAX_PORT_ATTEMPTS);
}

function seedDataRoot(dataRoot, options) {
  const productsDir = path.join(dataRoot, "assets", "data");
  fs.mkdirSync(productsDir, { recursive: true });
  const seedProducts = options && Object.prototype.hasOwnProperty.call(options, "products")
    ? options.products
    : [];
  fs.writeFileSync(
    path.join(productsDir, "products.json"),
    JSON.stringify(seedProducts, null, 2),
    "utf8"
  );
  // SQLite (WAL) aynı dosyayı iki süreç birlikte açınca Windows'ta ara sıra
  // "disk I/O error" verir: test verisi sunucu başlamadan yazılır ve bağlantı kapanır.
  resetDbForTests();
  if (options && typeof options.seed === "function") {
    try {
      options.seed(dataRoot);
    } finally {
      resetDbForTests();
    }
  }
}

module.exports = {
  projectRoot,
  getFreePort,
  waitForServer,
  spawnTestServer,
};
