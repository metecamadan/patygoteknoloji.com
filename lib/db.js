const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const cache = new Map();

function openDatabase(root) {
  const runtime = path.join(root, ".runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const file = path.join(runtime, "patygo.sqlite");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      tax_id TEXT,
      billing_address TEXT,
      shipping_address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      payment_taken INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      currency TEXT NOT NULL DEFAULT 'TRY',
      subtotal REAL NOT NULL DEFAULT 0,
      vat REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      customer_json TEXT NOT NULL,
      contracts_json TEXT,
      bank_response_json TEXT,
      legal_hold INTEGER NOT NULL DEFAULT 0,
      anonymized_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      paid_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status);

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT,
      brand TEXT,
      name TEXT,
      unit_price REAL,
      vat_percent REAL,
      qty INTEGER,
      line_net REAL,
      line_vat REAL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS consent_events (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_ref TEXT,
      purpose TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1,
      policy_version TEXT,
      evidence_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consent_subject ON consent_events(subject_type, subject_ref);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      detail_json TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
  `);

  const has = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const mark = db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)"
  );
  if (!has.get("v1_core")) {
    mark.run("v1_core", new Date().toISOString());
  }
}

function getDb(root) {
  const key = path.resolve(root);
  if (cache.has(key)) return cache.get(key);
  const db = openDatabase(key);
  cache.set(key, db);
  return db;
}

function resetDbForTests() {
  for (const db of cache.values()) {
    try {
      db.close();
    } catch (_) {}
  }
  cache.clear();
}

module.exports = {
  getDb,
  openDatabase,
  resetDbForTests,
};
