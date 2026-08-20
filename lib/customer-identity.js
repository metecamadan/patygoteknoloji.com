"use strict";

const GARBAGE_NAME_PATTERNS = [
  /^(.)\1+$/i,
  /^(asd|qwe|zxc|abc|xyz|asdf|test|deneme|xxx|axax|sdfg|ghjk|hjkl|qwerty|asdasd)+$/i,
  /(.{2,4})\1{2,}/i,
];

function normalizeCustomerName(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function normalizeTrMobilePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function formatTrMobilePhone(digits) {
  const d = normalizeTrMobilePhone(digits);
  if (!/^5\d{9}$/.test(d)) return String(digits || "").trim().slice(0, 40);
  return "0" + d.slice(0, 3) + " " + d.slice(3, 6) + " " + d.slice(6, 8) + " " + d.slice(8, 10);
}

function looksLikeGarbageName(value) {
  const compact = String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}]/gu, "");
  if (!compact) return true;
  for (const pattern of GARBAGE_NAME_PATTERNS) {
    if (pattern.test(compact)) return true;
  }
  const vowels = compact.match(/[aeiouöüı]/gi);
  if (!vowels || vowels.length < 1) return true;
  return false;
}

function validateCustomerName(raw) {
  const name = normalizeCustomerName(raw);
  if (!name) return { ok: false, error: "Ad soyad gerekli." };
  if (name.length < 5) {
    return { ok: false, error: "Ad soyad en az 5 karakter olmalı (ad ve soyad)." };
  }
  if (/[<>&{}[\]|\\^`0-9]/.test(name)) {
    return { ok: false, error: "Ad soyad geçersiz karakter içeriyor." };
  }
  if (!/^[\p{L}][\p{L}\s'.-]*$/u.test(name)) {
    return { ok: false, error: "Ad soyad yalnızca harf, boşluk ve tire içerebilir." };
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return { ok: false, error: "Lütfen ad ve soyadınızı birlikte yazın." };
  }
  if (words.some((word) => word.replace(/[^ \p{L}]/gu, "").length < 2)) {
    return { ok: false, error: "Ad ve soyadın her bölümü en az 2 harf olmalı." };
  }
  if (looksLikeGarbageName(name)) {
    return { ok: false, error: "Geçerli bir ad soyad girin." };
  }
  return { ok: true, value: name };
}

function validateCustomerPhone(raw) {
  const digits = normalizeTrMobilePhone(raw);
  if (!digits) return { ok: false, error: "Cep telefonu gerekli." };
  if (!/^5\d{9}$/.test(digits)) {
    return {
      ok: false,
      error: "Geçerli bir cep telefonu girin (05XX XXX XX XX).",
    };
  }
  return { ok: true, value: formatTrMobilePhone(digits), digits };
}

module.exports = {
  normalizeCustomerName,
  normalizeTrMobilePhone,
  formatTrMobilePhone,
  validateCustomerName,
  validateCustomerPhone,
  looksLikeGarbageName,
};
