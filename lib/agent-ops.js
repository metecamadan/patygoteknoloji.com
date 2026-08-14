const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("./supplier");

const MAX_EVENTS = 400;
const AGENTS = ["orchestrator", "backend", "frontend", "seo", "qa", "release", "user"];
const TYPES = new Set(["decision", "handoff", "change", "gate", "note", "prompt"]);

function normalizeAgent(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const aliases = {
    orch: "orchestrator",
    chief: "orchestrator",
    şef: "orchestrator",
    sef: "orchestrator",
    be: "backend",
    fe: "frontend",
    web: "frontend",
    devops: "release",
    rel: "release",
  };
  const mapped = aliases[key] || key;
  return AGENTS.includes(mapped) ? mapped : "orchestrator";
}

function createAgentOpsStore(root) {
  const file = path.join(root, ".runtime", "agent-ops.json");

  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && Array.isArray(value.events)) return value;
    } catch (_) {}
    return { version: 1, events: [] };
  }

  function write(value) {
    const events = Array.isArray(value.events) ? value.events : [];
    value.events = events.slice(-MAX_EVENTS);
    atomicWriteJson(file, value);
  }

  function append(input) {
    const type = String((input && input.type) || "note").toLowerCase();
    if (!TYPES.has(type)) throw new Error("Geçersiz olay tipi.");
    const from = normalizeAgent(input && input.from);
    const to = input && input.to ? normalizeAgent(input.to) : null;
    const summary = String((input && input.summary) || "")
      .trim()
      .slice(0, 400);
    if (!summary) throw new Error("Özet gerekli.");
    const files = Array.isArray(input && input.files)
      ? input.files.map((f) => String(f).slice(0, 200)).filter(Boolean).slice(0, 20)
      : [];
    const taskId = String((input && input.taskId) || "")
      .trim()
      .slice(0, 40);
    const status = String((input && input.status) || "info")
      .trim()
      .slice(0, 24);
    const sourceId = String((input && input.sourceId) || "")
      .trim()
      .slice(0, 80);
    const now = new Date().toISOString();
    const data = read();
    if (sourceId) {
      const dup = data.events.slice(-12).reverse().find((row) => row && row.sourceId === sourceId);
      if (dup) return dup;
    }
    const event = {
      id: crypto.randomBytes(6).toString("hex"),
      at: now,
      type,
      from,
      to,
      summary,
      files,
      taskId: taskId || null,
      status,
      sourceId: sourceId || null,
    };
    data.events.push(event);
    write(data);
    return event;
  }

  function list(limit) {
    const n = Math.min(200, Math.max(1, Number(limit) || 80));
    const events = read().events.slice(-n).reverse();
    return events;
  }

  function snapshot() {
    const events = list(100);
    const edgeMap = new Map();
    const agentActivity = Object.fromEntries(AGENTS.map((a) => [a, { count: 0, lastAt: null }]));
    const decisions = [];
    const changes = [];

    for (const event of events) {
      if (agentActivity[event.from]) {
        agentActivity[event.from].count += 1;
        if (!agentActivity[event.from].lastAt) agentActivity[event.from].lastAt = event.at;
      }
      if (event.to && agentActivity[event.to]) {
        agentActivity[event.to].count += 1;
        if (!agentActivity[event.to].lastAt) agentActivity[event.to].lastAt = event.at;
      }
      if (event.type === "handoff" && event.to) {
        const key = event.from + "→" + event.to;
        const prev = edgeMap.get(key) || { from: event.from, to: event.to, count: 0, lastAt: null, lastSummary: "" };
        prev.count += 1;
        if (!prev.lastAt) {
          prev.lastAt = event.at;
          prev.lastSummary = event.summary;
        }
        edgeMap.set(key, prev);
      }
      if (event.type === "decision" || event.type === "prompt") decisions.push(event);
      if (event.type === "change") changes.push(event);
    }

    return {
      at: new Date().toISOString(),
      agents: AGENTS.filter((a) => a !== "user"),
      agentActivity,
      edges: Array.from(edgeMap.values()).sort((a, b) => b.count - a.count),
      decisions: decisions.slice(0, 20),
      changes: changes.slice(0, 20),
      events,
    };
  }

  function seedIfEmpty(seedEvents) {
    const data = read();
    if (data.events.length) return false;
    for (const row of seedEvents || []) {
      try {
        append(row);
      } catch (_) {}
    }
    return true;
  }

  return { append, list, snapshot, seedIfEmpty, file };
}

module.exports = {
  createAgentOpsStore,
  normalizeAgent,
  AGENTS,
  TYPES,
};
