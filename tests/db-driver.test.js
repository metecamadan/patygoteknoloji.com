const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openRawDatabase, resetDbForTests, getDb } = require("../lib/db");

test("sqlite driver opens with node:sqlite or better-sqlite3", () => {
  resetDbForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-db-driver-"));
  const db = getDb(root);
  assert.ok(db.driver === "node:sqlite" || db.driver === "better-sqlite3");
  db.prepare("SELECT 1 AS x").get();
  const tx = db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS _tx_probe (id INTEGER)");
  });
  tx();
  resetDbForTests();
});

test("openRawDatabase works for memory-like temp file", () => {
  const file = path.join(os.tmpdir(), "patygo-raw-" + Date.now() + ".sqlite");
  const db = openRawDatabase(file);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  db.prepare("INSERT INTO t (id) VALUES (?)").run(1);
  assert.equal(db.prepare("SELECT id FROM t").get().id, 1);
  db.close();
  try {
    fs.unlinkSync(file);
  } catch (_) {}
});
