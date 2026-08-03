const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAgentOpsStore } = require("../lib/agent-ops");

test("agent ops store records decisions handoffs and snapshot edges", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-ops-"));
  const store = createAgentOpsStore(root);
  store.append({
    type: "decision",
    from: "orchestrator",
    summary: "Önce backend sözleşmesi",
    taskId: "demo",
  });
  store.append({
    type: "handoff",
    from: "orchestrator",
    to: "backend",
    summary: "Users API",
    files: ["lib/admin-users.js"],
  });
  store.append({
    type: "change",
    from: "backend",
    summary: "Store eklendi",
    files: ["lib/admin-users.js"],
  });
  store.append({
    type: "handoff",
    from: "backend",
    to: "frontend",
    summary: "UI bağla",
  });
  const snap = store.snapshot();
  assert.ok(snap.decisions.length >= 1);
  assert.ok(snap.changes.length >= 1);
  assert.ok(snap.edges.some((e) => e.from === "orchestrator" && e.to === "backend"));
  assert.ok(snap.edges.some((e) => e.from === "backend" && e.to === "frontend"));
});

test("agent ops page exists and is noindex ops room", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "agent-ops.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "agent-ops.js"), "utf8");
  assert.match(html, /Agent Ops/);
  assert.match(html, /noindex/);
  assert.match(html, /id="loginEmail"/);
  assert.match(html, /id="password"/);
  assert.match(html, /Bağlantı havuzu/);
  assert.match(html, /Şef kararları/);
  assert.match(html, /src="\/assets\/js\/agent-ops\.js"/);
  assert.doesNotMatch(html, /<script>\s*\(function/);
  assert.match(js, /\/api\/admin\/agent-ops/);
  assert.match(js, /\/api\/admin\/login/);
  assert.match(js, /preventDefault/);
});
