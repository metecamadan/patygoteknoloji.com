const path = require("path");
const { Worker } = require("worker_threads");

function readJsonFileInWorker(filePath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(path.join(__dirname, "json-parse-worker.js"), {
      workerData: { filePath: String(filePath || "") },
    });
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      try {
        worker.terminate();
      } catch (_) {}
      fn();
    };
    worker.on("message", (msg) => {
      if (msg && msg.ok) finish(() => resolve(msg.value));
      else finish(() => reject(new Error((msg && msg.error) || "JSON parse failed")));
    });
    worker.on("error", (err) => finish(() => reject(err)));
    worker.on("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error("JSON worker exit " + code)));
    });
  });
}

module.exports = { readJsonFileInWorker };
