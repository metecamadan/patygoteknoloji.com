(function () {
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

  function looksLikeGarbageName(value) {
    const compact = String(value || "")
      .toLocaleLowerCase("tr-TR")
      .replace(/[^\p{L}]/gu, "");
    if (!compact) return true;
    for (let i = 0; i < GARBAGE_NAME_PATTERNS.length; i += 1) {
      if (GARBAGE_NAME_PATTERNS[i].test(compact)) return true;
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
    if (words.some(function (word) { return word.replace(/[^ \p{L}]/gu, "").length < 2; })) {
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
      return { ok: false, error: "Geçerli bir cep telefonu girin (05XX XXX XX XX)." };
    }
    return { ok: true, digits: digits };
  }

  window.PatygoCustomerIdentity = {
    validateCustomerName,
    validateCustomerPhone,
  };
})();
