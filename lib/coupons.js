"use strict";

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
const MAX_PERCENT = 90;

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I")
    .replace(/\s+/g, "");
}

function istanbulDay(nowMs) {
  return new Date((Number(nowMs) || Date.now()) + 3 * 3600000).toISOString().slice(0, 10);
}

function validDay(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Tarih YYYY-AA-GG biçiminde olmalı.");
  const parsed = new Date(text + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("Geçersiz tarih: " + text);
  }
  return text;
}

/** Admin input → stored coupon; throws a Turkish message on invalid input. */
function normalizeCouponInput(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const code = normalizeCode(input.code);
  if (!CODE_RE.test(code)) {
    throw new Error("Kupon kodu 3–24 karakter olmalı; yalnızca harf, rakam ve tire kullanılabilir.");
  }
  const type = input.type === "amount" ? "amount" : "percent";
  const value = round2(input.value);
  if (!(value > 0)) throw new Error("İndirim değeri sıfırdan büyük olmalı.");
  if (type === "percent" && value > MAX_PERCENT) {
    throw new Error("Yüzde indirim en fazla %" + MAX_PERCENT + " olabilir.");
  }
  const startsAt = validDay(input.startsAt);
  const endsAt = validDay(input.endsAt);
  if (startsAt && endsAt && endsAt < startsAt) throw new Error("Bitiş tarihi başlangıçtan önce olamaz.");
  return {
    code,
    type,
    value,
    minOrder: Math.max(0, round2(input.minOrder) || 0),
    maxDiscount: type === "percent" ? Math.max(0, round2(input.maxDiscount) || 0) : 0,
    startsAt,
    endsAt,
    usageLimit: Math.max(0, Math.floor(Number(input.usageLimit) || 0)),
    active: input.active !== false,
  };
}

/**
 * merchandiseTotal: KDV dahil ürün toplamı (kargo ve vade farkı hariç).
 * Returns { ok, discount } or { ok: false, error }.
 */
function evaluateCoupon(coupon, merchandiseTotal, nowMs) {
  if (!coupon) return { ok: false, error: "Kupon kodu geçersiz." };
  if (!coupon.active) return { ok: false, error: "Bu kupon artık geçerli değil." };
  const today = istanbulDay(nowMs);
  if (coupon.startsAt && today < coupon.startsAt) return { ok: false, error: "Bu kupon henüz başlamadı." };
  if (coupon.endsAt && today > coupon.endsAt) return { ok: false, error: "Bu kuponun süresi doldu." };
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false, error: "Bu kuponun kullanım limiti doldu." };
  }
  const merch = round2(merchandiseTotal);
  if (coupon.minOrder > 0 && merch < coupon.minOrder) {
    return {
      ok: false,
      error:
        "Bu kupon " +
        coupon.minOrder.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        " ₺ ve üzeri ürün toplamında geçerlidir.",
    };
  }
  let discount = coupon.type === "amount" ? coupon.value : round2((merch * coupon.value) / 100);
  if (coupon.type === "percent" && coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  // The bank cannot charge zero; keep at least 1 TL of merchandise.
  discount = round2(Math.min(discount, Math.max(0, merch - 1)));
  if (!(discount > 0)) return { ok: false, error: "Bu kupon sepetinize uygulanamıyor." };
  return { ok: true, discount };
}

function rowToCoupon(row) {
  if (!row) return null;
  return {
    code: row.code,
    type: row.type,
    value: Number(row.value) || 0,
    minOrder: Number(row.min_order) || 0,
    maxDiscount: Number(row.max_discount) || 0,
    startsAt: row.starts_at || "",
    endsAt: row.ends_at || "",
    usageLimit: Number(row.usage_limit) || 0,
    usedCount: Number(row.used_count) || 0,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createCouponStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      min_order REAL NOT NULL DEFAULT 0,
      max_discount REAL NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT,
      usage_limit INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      order_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      redeemed_at TEXT NOT NULL
    );
  `);
  const selectOne = db.prepare("SELECT * FROM coupons WHERE code = ?");
  const selectAll = db.prepare("SELECT * FROM coupons ORDER BY created_at DESC");
  const upsert = db.prepare(`
    INSERT INTO coupons (code, type, value, min_order, max_discount, starts_at, ends_at, usage_limit, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      type = excluded.type, value = excluded.value, min_order = excluded.min_order,
      max_discount = excluded.max_discount, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      usage_limit = excluded.usage_limit, active = excluded.active, updated_at = excluded.updated_at
  `);
  const remove = db.prepare("DELETE FROM coupons WHERE code = ?");
  const setActive = db.prepare("UPDATE coupons SET active = ?, updated_at = ? WHERE code = ?");
  const insertRedemption = db.prepare(
    "INSERT OR IGNORE INTO coupon_redemptions (order_id, code, redeemed_at) VALUES (?, ?, ?)"
  );
  const bumpUsage = db.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE code = ?");

  return {
    list() {
      return selectAll.all().map(rowToCoupon);
    },
    get(code) {
      return rowToCoupon(selectOne.get(normalizeCode(code)));
    },
    save(input) {
      const coupon = normalizeCouponInput(input);
      const now = new Date().toISOString();
      upsert.run(
        coupon.code,
        coupon.type,
        coupon.value,
        coupon.minOrder,
        coupon.maxDiscount,
        coupon.startsAt || null,
        coupon.endsAt || null,
        coupon.usageLimit,
        coupon.active ? 1 : 0,
        now,
        now
      );
      return rowToCoupon(selectOne.get(coupon.code));
    },
    setActive(code, active) {
      setActive.run(active ? 1 : 0, new Date().toISOString(), normalizeCode(code));
      return rowToCoupon(selectOne.get(normalizeCode(code)));
    },
    remove(code) {
      return remove.run(normalizeCode(code)).changes > 0;
    },
    /** Counts a paid order once, even if the bank callback repeats. */
    redeem(orderId, code) {
      const id = String(orderId || "");
      const key = normalizeCode(code);
      if (!id || !key) return false;
      let counted = false;
      db.transaction(() => {
        if (insertRedemption.run(id, key, new Date().toISOString()).changes > 0) {
          bumpUsage.run(key);
          counted = true;
        }
      })();
      return counted;
    },
  };
}

module.exports = {
  normalizeCode,
  normalizeCouponInput,
  evaluateCoupon,
  createCouponStore,
  MAX_PERCENT,
};
