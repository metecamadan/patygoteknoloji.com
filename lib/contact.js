"use strict";

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const CONTACT_TO = "info@patygoteknoloji.com";
const ALLOWED_FIELDS = [
  "firma",
  "vkn",
  "email",
  "tel",
  "urun",
  "kategori",
  "konu",
  "mesaj",
  "_subject",
  "_honey",
];

function createContactStore(rootDir) {
  const filePath = path.join(rootDir, ".runtime", "contact-leads.json");

  function readAll() {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function append(lead) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const all = readAll();
    all.unshift(lead);
    fs.writeFileSync(filePath, JSON.stringify(all.slice(0, 500), null, 2), "utf8");
    return lead;
  }

  return { filePath, readAll, append };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizeContactPayload(body) {
  const src = body && typeof body === "object" ? body : {};
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (src[key] == null) continue;
    out[key] = String(src[key]).trim().slice(0, key === "mesaj" ? 4000 : 200);
  }
  return out;
}

function validateContactPayload(data) {
  if (data._honey) {
    return { ok: true, spam: true };
  }
  if (!data.firma) return { ok: false, error: "Firma adı gerekli." };
  if (!data.vkn || !/^\d{10,11}$/.test(data.vkn)) {
    return { ok: false, error: "Geçerli bir VKN girin (10 veya 11 hane)." };
  }
  if (!isValidEmail(data.email)) return { ok: false, error: "Geçerli bir e-posta girin." };
  if (!data.tel || data.tel.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "Geçerli bir telefon girin." };
  }
  if (!data.mesaj || data.mesaj.length < 5) {
    return { ok: false, error: "Mesajınızı yazın." };
  }
  return { ok: true, spam: false };
}

function buildMailText(data) {
  const lines = [
    "Yeni iletişim / teklif talebi",
    "------------------------------",
    "Firma: " + data.firma,
    "VKN: " + data.vkn,
    "E-posta: " + data.email,
    "Telefon: " + data.tel,
  ];
  if (data.konu) lines.push("Konu: " + data.konu);
  if (data.urun) lines.push("Ürün: " + data.urun);
  if (data.kategori) lines.push("Kategori: " + data.kategori);
  lines.push("", "Mesaj:", data.mesaj);
  return lines.join("\n");
}

function smtpConfigured(env) {
  const source = env || process.env;
  return Boolean(
    String(source.SMTP_HOST || "").trim() &&
      String(source.SMTP_USER || "").trim() &&
      String(source.SMTP_PASS || "").trim()
  );
}

async function sendViaSmtp(data, env) {
  const source = env || process.env;
  let nodemailer;
  try {
    nodemailer = createRequire(__filename)("nodemailer");
  } catch (_) {
    throw new Error("nodemailer yüklü değil. npm install nodemailer");
  }

  const transporter = nodemailer.createTransport({
    host: String(source.SMTP_HOST).trim(),
    port: Number(source.SMTP_PORT || 587),
    secure: String(source.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: String(source.SMTP_USER).trim(),
      pass: String(source.SMTP_PASS).trim(),
    },
  });

  const to = String(source.CONTACT_TO || CONTACT_TO).trim() || CONTACT_TO;
  const subject = data._subject || "Patygo Teklif / İletişim Talebi";

  await transporter.sendMail({
    from: String(source.SMTP_FROM || source.SMTP_USER).trim(),
    to,
    replyTo: data.email,
    subject,
    text: buildMailText(data),
  });

  return { channel: "smtp", to };
}

async function sendViaFormSubmit(data, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const payload = Object.assign({}, data, {
    _subject: data._subject || "Patygo Teklif / İletişim Talebi",
    _template: "table",
    _replyto: data.email,
  });
  delete payload._honey;

  const res = await fetchFn("https://formsubmit.co/ajax/" + CONTACT_TO, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://patygoteknoloji.com",
      Referer: "https://patygoteknoloji.com/iletisim",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  const message = String(json.message || json.error || "");
  if (!res.ok || json.success === "false" || json.success === false) {
    if (/activation/i.test(message)) {
      throw new Error(
        "FormSubmit aktivasyon bekliyor: info@patygoteknoloji.com kutusundaki Activate Form linkine tıklayın."
      );
    }
    throw new Error(message || "E-posta gönderimi başarısız.");
  }
  return { channel: "formsubmit", to: CONTACT_TO };
}

async function deliverContactMail(data, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (smtpConfigured(env)) {
    return sendViaSmtp(data, env);
  }
  return sendViaFormSubmit(data, opts.fetchImpl);
}

module.exports = {
  CONTACT_TO,
  ALLOWED_FIELDS,
  createContactStore,
  normalizeContactPayload,
  validateContactPayload,
  buildMailText,
  smtpConfigured,
  deliverContactMail,
};
