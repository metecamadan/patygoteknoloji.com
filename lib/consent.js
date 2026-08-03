const crypto = require("crypto");
const { getDb } = require("./db");

function createConsentStore(root) {
  const db = getDb(root);

  function record(input) {
    const id = crypto.randomBytes(8).toString("hex");
    const createdAt = new Date().toISOString();
    const subjectType = String((input && input.subjectType) || "").slice(0, 40);
    const purpose = String((input && input.purpose) || "").slice(0, 80);
    if (!subjectType || !purpose) throw new Error("Consent subject/purpose gerekli.");
    db.prepare(
      `INSERT INTO consent_events
        (id, subject_type, subject_ref, purpose, granted, policy_version, evidence_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      subjectType,
      input.subjectRef ? String(input.subjectRef).slice(0, 80) : null,
      purpose,
      input.granted === false ? 0 : 1,
      String((input && input.policyVersion) || "2026-08-03").slice(0, 40),
      JSON.stringify(input.evidence || {}),
      createdAt
    );
    return { id, createdAt, subjectType, purpose };
  }

  function listForSubject(subjectType, subjectRef, limit) {
    return db
      .prepare(
        `SELECT * FROM consent_events
         WHERE subject_type = ? AND subject_ref = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(subjectType, String(subjectRef || ""), Math.min(100, Number(limit) || 20));
  }

  return { record, listForSubject };
}

module.exports = { createConsentStore };
