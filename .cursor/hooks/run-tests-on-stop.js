#!/usr/bin/env node
/**
 * Agent stop hook: runs the project test suite and asks for a follow-up fix if tests fail.
 * Input/output: JSON on stdin/stdout (Cursor hooks protocol).
 *
 * Uses process.execPath (the same Node that launched this hook) instead of bare `npm`,
 * so nvm/fnm installs work when Cursor’s hook PATH does not include them.
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

function enrichPath(env) {
  const home = env.HOME || "";
  const extras = [];
  const nvmVersions = path.join(home, ".nvm", "versions", "node");
  if (fs.existsSync(nvmVersions)) {
    try {
      const versions = fs
        .readdirSync(nvmVersions)
        .filter((name) => name.startsWith("v"))
        .sort();
      const latest = versions[versions.length - 1];
      if (latest) extras.push(path.join(nvmVersions, latest, "bin"));
    } catch (_) {}
  }
  for (const candidate of [
    path.join(home, ".fnm", "current", "bin"),
    path.join(home, ".volta", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    if (fs.existsSync(candidate)) extras.push(candidate);
  }
  const current = env.PATH || "";
  const merged = extras.concat(current.split(path.delimiter).filter(Boolean));
  env.PATH = [...new Set(merged)].join(path.delimiter);
  return env;
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
  const env = enrichPath(Object.assign({}, process.env));
  // Self-test / avoid nested suite when this hook is invoked from tests.
  if (env.PATYGO_HOOK_DRY_RUN === "1") {
    process.stdout.write("{}\n");
    return;
  }
  // Match package.json "test": "node --test" without depending on npm on PATH.
  const result = spawnSync(process.execPath, ["--test"], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 120000,
  });

  if (result.status === 0) {
    process.stdout.write("{}\n");
    return;
  }

  const parts = [];
  if (result.error) parts.push(String(result.error.message || result.error));
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(result.stderr);
  const out = parts.join("\n").trim();
  const snippet =
    out.slice(-2500) ||
    "Test komutu çıktı üretmeden başarısız oldu (exit " +
      String(result.status) +
      "). Node: " +
      process.execPath;
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
