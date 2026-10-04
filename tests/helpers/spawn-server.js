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

function spawnTestServer(t, envExtra, options) {
  const portPromise = getFreePort();
  return portPromise.then((port) => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-data-"));
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
    const stderrChunks = [];
    const child = spawn(process.execPath, ["server.js"], {
      cwd: projectRoot,
      env: Object.assign({}, process.env, {
        PORT: String(port),
        PATYGO_DATA_ROOT: dataRoot,
        SITE_BASE_URL: `http://127.0.0.1:${port}`,
        SMTP_HOST: "",
        SMTP_USER: "",
        SMTP_PASS: "",
      }, envExtra || {}),
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
      if (stderrChunks.length > 40) stderrChunks.shift();
    });
    t.after(() => {
      child.kill();
      resetDbForTests();
      try {
        fs.rmSync(dataRoot, { recursive: true, force: true });
      } catch (_) {}
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    /** Sunucu tamamen kapanınca çözülür; sonrasında test veritabanını güvenle okuyabilir. */
    function stop() {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      });
    }
    return waitForServer(baseUrl, child, () =>
      Buffer.concat(stderrChunks).toString("utf8").trim().slice(-1500)
    ).then(() => ({ port, baseUrl, child, dataRoot, stop }));
  });
}

module.exports = {
  projectRoot,
  getFreePort,
  waitForServer,
  spawnTestServer,
};
