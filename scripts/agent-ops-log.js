#!/usr/bin/env node
/**
 * Agent ops olay yazıcı — görev paslaşmalarını canlı panele basar.
 * Örnek:
 *   node scripts/agent-ops-log.js --type decision --from orchestrator --summary "Sıra: BE→FE→QA"
 *   node scripts/agent-ops-log.js --type handoff --from orchestrator --to frontend --summary "Ödeme spacing" --files odeme.html,assets/css/style.css
 */
const path = require("path");
const { createAgentOpsStore } = require("../lib/agent-ops");

function arg(name) {
  const idx = process.argv.indexOf("--" + name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "");
}

const root = path.resolve(__dirname, "..");
const store = createAgentOpsStore(root);
const files = arg("files")
  ? arg("files")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

try {
  const event = store.append({
    type: arg("type") || "note",
    from: arg("from") || "orchestrator",
    to: arg("to") || null,
    summary: arg("summary"),
    files,
    taskId: arg("task") || null,
    status: arg("status") || "info",
  });
  console.log(JSON.stringify({ ok: true, event }, null, 2));
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
