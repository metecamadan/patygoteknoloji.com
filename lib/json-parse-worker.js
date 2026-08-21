const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");

try {
  const text = fs.readFileSync(String(workerData.filePath || ""), "utf8");
  parentPort.postMessage({ ok: true, value: JSON.parse(text) });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    error: String(err && err.message ? err.message : err),
  });
}
