#!/usr/bin/env node
/**
 * Agent stop hook: runs npm test and asks for a follow-up fix if tests fail.
 * Input/output: JSON on stdin/stdout (Cursor hooks protocol).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_) {
    return "";
  }
}

function main() {
  let payload = {};
  const raw = readStdin();
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch (_) {}
  }

  // Avoid infinite loops when the follow-up itself is only about tests.
  const status = String(payload.status || payload.stop_reason || "");
  if (status === "aborted" || status === "error") {
    process.stdout.write("{}\n");
    return;
  }

  const root = path.resolve(__dirname, "..", "..");
  const result = spawnSync("npm", ["test"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    timeout: 120000,
  });

  if (result.status === 0) {
    process.stdout.write("{}\n");
    return;
  }

  const out = [result.stdout || "", result.stderr || ""].join("\n").trim();
  const snippet = out.slice(-2500) || "npm test failed with no output.";
  const followup =
    "Yerel testler başarısız oldu. Lütfen hataları düzelt, sonra tekrar `npm test` çalıştır. Çıktı:\n\n" +
    snippet;

  process.stdout.write(
    JSON.stringify({
      followup_message: followup,
    }) + "\n"
  );
}

main();
