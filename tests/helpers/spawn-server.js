const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

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

function spawnTestServer(t, envExtra) {
  const portPromise = getFreePort();
  return portPromise.then((port) => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-data-"));
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
      try {
        fs.rmSync(dataRoot, { recursive: true, force: true });
      } catch (_) {}
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    return waitForServer(baseUrl, child, () =>
      Buffer.concat(stderrChunks).toString("utf8").trim().slice(-1500)
    ).then(() => ({ port, baseUrl, child, dataRoot }));
  });
}

module.exports = {
  projectRoot,
  getFreePort,
  waitForServer,
  spawnTestServer,
};
