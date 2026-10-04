"use strict";

const REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);
const ANONYMOUS_AUTHOR = "Doğrulanmış alıcı";
const MIN_BODY = 10;
const MAX_BODY = 2000;
const MAX_TITLE = 120;

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** "Ayşe Nur Yılmaz" -> "Ayşe Y."; the full name never leaves the order record. */
function abbreviateName(fullName) {
  const parts = String(fullName || "")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return ANONYMOUS_AUTHOR;
  const first = parts[0].slice(0, 30);
  if (parts.length === 1) return first;
  return first + " " + parts[parts.length - 1].charAt(0).toLocaleUpperCase("tr-TR") + ".";
}

/** Returns { ok, value } or { ok:false, error } for a customer submission. */
function normalizeReviewInput(input) {
  const body = input || {};
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "1 ile 5 arasında puan seçin." };
  }
  const text = cleanText(body.body, MAX_BODY);
  if (text.length < MIN_BODY) {
    return { ok: false, error: "Yorumunuz en az " + MIN_BODY + " karakter olmalı." };
  }
  const title = cleanText(body.title, MAX_TITLE).replace(/\n/g, " ");
  if (/(https?:\/\/|www\.)/i.test(text + " " + title)) {
    return { ok: false, error: "Yorumda bağlantı paylaşılamaz." };
  }
  return { ok: true, value: { rating, title, body: text, hideName: body.hideName === true } };
}

function rowToReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    rating: Number(row.rating) || 0,
    title: row.title || "",
    body: row.body,
    author: row.author,
    status: row.status,
    createdAt: row.created_at,
    moderatedAt: row.moderated_at || null,
  };
}

function publicReview(review) {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    author: review.author,
    createdAt: review.createdAt,
  };
}

/** Delivered orders only; the product must be one of the order lines. */
function reviewEligibility(order, productId) {
  if (!order) return { ok: false, error: "Sipariş bulunamadı." };
  if (order.anonymizedAt) return { ok: false, error: "Bu sipariş için değerlendirme yapılamaz." };
  if (order.status !== "delivered") {
    return { ok: false, error: "Değerlendirme, sipariş teslim edildikten sonra açılır." };
  }
  if (productId == null) return { ok: true };
  const item = (order.items || []).find((row) => String(row.productId) === String(productId));
  if (!item) return { ok: false, error: "Bu ürün siparişinizde yok." };
  return { ok: true, item };
}

function createReviewStore(db, options) {
  const opts = options || {};
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      rating INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      moderated_at TEXT,
      UNIQUE (order_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews(product_id, status);
    CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON product_reviews(status, created_at);
  `);
  const byKey = db.prepare("SELECT * FROM product_reviews WHERE order_id = ? AND product_id = ?");
  const byId = db.prepare("SELECT * FROM product_reviews WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO product_reviews (order_id, product_id, product_name, rating, title, body, author, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  );
  const byOrder = db.prepare("SELECT product_id, status, rating FROM product_reviews WHERE order_id = ?");
  const approvedFor = db.prepare(
    "SELECT * FROM product_reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?"
  );
  const summaryFor = db.prepare(
    `SELECT COUNT(*) AS n, AVG(rating) AS avg,
            SUM(rating = 5) AS r5, SUM(rating = 4) AS r4, SUM(rating = 3) AS r3,
            SUM(rating = 2) AS r2, SUM(rating = 1) AS r1
     FROM product_reviews WHERE product_id = ? AND status = 'approved'`
  );
  const setStatus = db.prepare("UPDATE product_reviews SET status = ?, moderated_at = ? WHERE id = ?");
  const del = db.prepare("DELETE FROM product_reviews WHERE id = ?");
  const counts = db.prepare("SELECT status, COUNT(*) AS n FROM product_reviews GROUP BY status");

  /** order: full order record (already token-checked); returns the stored review. */
  function submit(order, productId, input) {
    const eligible = reviewEligibility(order, productId);
    if (!eligible.ok) throw new Error(eligible.error);
    const parsed = normalizeReviewInput(input);
    if (!parsed.ok) throw new Error(parsed.error);
    if (byKey.get(order.id, String(productId))) {
      throw new Error("Bu ürün için değerlendirmeniz zaten alındı.");
    }
    const { rating, title, body, hideName } = parsed.value;
    const customer = order.customer || {};
    const author = hideName ? ANONYMOUS_AUTHOR : abbreviateName(customer.name || customer.fullName);
    const info = insert.run(
      order.id,
      String(productId),
      String(eligible.item.name || "").slice(0, 200),
      rating,
      title,
      body,
      author,
      new Date(now()).toISOString()
    );
    return rowToReview(byId.get(Number(info.lastInsertRowid)));
  }

  function forOrder(orderId) {
    const map = {};
    byOrder.all(String(orderId || "")).forEach((row) => {
      map[row.product_id] = { status: row.status, rating: Number(row.rating) || 0 };
    });
    return map;
  }

  function summary(productId) {
    const row = summaryFor.get(String(productId || "")) || {};
    const count = Number(row.n) || 0;
    return {
      count,
      average: count ? Math.round(Number(row.avg) * 10) / 10 : 0,
      distribution: { 5: Number(row.r5) || 0, 4: Number(row.r4) || 0, 3: Number(row.r3) || 0, 2: Number(row.r2) || 0, 1: Number(row.r1) || 0 },
    };
  }

  function publicList(productId, limit) {
    const max = Math.min(50, Math.max(1, Number(limit) || 20));
    return approvedFor.all(String(productId || ""), max).map((row) => publicReview(rowToReview(row)));
  }

  function adminList(filter) {
    const f = filter || {};
    const status = REVIEW_STATUSES.has(f.status) ? f.status : "";
    const limit = Math.min(200, Math.max(1, Number(f.limit) || 100));
    const rows = status
      ? db.prepare("SELECT * FROM product_reviews WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit)
      : db.prepare("SELECT * FROM product_reviews ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map(rowToReview);
  }

  function moderate(id, status) {
    if (status !== "approved" && status !== "rejected") throw new Error("Geçersiz yorum durumu.");
    const current = rowToReview(byId.get(Number(id)));
    if (!current) return null;
    setStatus.run(status, new Date(now()).toISOString(), current.id);
    return rowToReview(byId.get(current.id));
  }

  function remove(id) {
    const current = rowToReview(byId.get(Number(id)));
    if (!current) return null;
    del.run(current.id);
    return current;
  }

  function statusCounts() {
    const out = { pending: 0, approved: 0, rejected: 0 };
    counts.all().forEach((row) => {
      if (REVIEW_STATUSES.has(row.status)) out[row.status] = Number(row.n) || 0;
    });
    return out;
  }

  return { submit, forOrder, summary, publicList, adminList, moderate, remove, statusCounts };
}

module.exports = {
  createReviewStore,
  normalizeReviewInput,
  reviewEligibility,
  abbreviateName,
  publicReview,
  ANONYMOUS_AUTHOR,
  REVIEW_STATUSES,
};
