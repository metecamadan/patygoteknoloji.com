const crypto = require("crypto");
const { getDb } = require("./db");

function createAuditStore(root) {
  const db = getDb(root);

  function record(input) {
    const id = crypto.randomBytes(8).toString("hex");
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, entity_type, entity_id, detail_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String((input && input.actorType) || "system").slice(0, 40),
      input && input.actorId ? String(input.actorId).slice(0, 80) : null,
      String((input && input.action) || "unknown").slice(0, 80),
      input && input.entityType ? String(input.entityType).slice(0, 40) : null,
      input && input.entityId ? String(input.entityId).slice(0, 80) : null,
      JSON.stringify(input && input.detail ? input.detail : {}),
      input && input.ip ? String(input.ip).slice(0, 80) : null,
      createdAt
    );
    return { id, createdAt };
  }

  function list(limit) {
    return db
      .prepare(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?`)
      .all(Math.min(200, Number(limit) || 50));
  }

  return { record, list };
}

module.exports = { createAuditStore };
