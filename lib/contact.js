"use strict";

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const CONTACT_TO = "info@patygoteknoloji.com";
const SMTP_NOT_CONFIGURED =
  "SMTP yapılandırılmamış; sipariş ve takvim mailleri FormSubmit ile gönderilmez.";
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

function publicSiteBase(env) {
  const source = env || process.env;
  const raw = String((source && source.SITE_BASE_URL) || "https://patygoteknoloji.com").trim();
  if (!raw || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(raw) || /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(raw)) {
    return "https://patygoteknoloji.com";
  }
  return raw.replace(/\/$/, "") || "https://patygoteknoloji.com";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logoUrl(env) {
  return publicSiteBase(env) + "/assets/img/patygo-logo.png";
}

function brandedMailHtml(options) {
  const opts = options || {};
  const heading = String(opts.heading || "").trim();
  const innerHtml = String(opts.innerHtml || "");
  const env = opts.env;
  const site = publicSiteBase(env);
  const logo = logoUrl(env);
  return [
    '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "</head>",
    '<body style="margin:0;padding:0;background:#f8fafc;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">',
    "<tr><td align=\"center\">",
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">',
    '<tr><td style="padding:28px 28px 16px;text-align:center;border-bottom:1px solid #f1f5f9;">',
    '<img src="' +
      escapeHtml(logo) +
      '" alt="Patygo Teknoloji" width="140" style="display:block;margin:0 auto;border:0;max-width:140px;height:auto;">',
    "</td></tr>",
    heading
      ? '<tr><td style="padding:28px 28px 8px;text-align:center;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">' +
        escapeHtml(heading) +
        "</p></td></tr>"
      : "",
    '<tr><td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif;color:#334155;">' +
      innerHtml +
      "</td></tr>",
    '<tr><td style="padding:16px 28px 24px;text-align:center;border-top:1px solid #f1f5f9;">',
    '<a href="' +
      escapeHtml(site) +
      '" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#2563eb;text-decoration:none;">patygoteknoloji.com</a>',
    "</td></tr></table></td></tr></table></body></html>",
  ].join("");
}

function textToInnerHtml(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      if (!line) return '<p style="margin:0 0 8px;font-size:15px;line-height:1.5;">&nbsp;</p>';
      return (
        '<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#334155;">' +
        escapeHtml(line) +
        "</p>"
      );
    })
    .join("");
}

function createSmtpTransporter(env) {
  const source = env || process.env;
  let nodemailer;
  try {
    nodemailer = createRequire(__filename)("nodemailer");
  } catch (_) {
    throw new Error("nodemailer yüklü değil. npm install nodemailer");
  }
  return nodemailer.createTransport({
    host: String(source.SMTP_HOST).trim(),
    port: Number(source.SMTP_PORT || 587),
    secure: String(source.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: String(source.SMTP_USER).trim(),
      pass: String(source.SMTP_PASS).trim(),
    },
  });
}

async function sendViaSmtp(data, env) {
  const source = env || process.env;
  const transporter = createSmtpTransporter(source);
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

async function deliverSimpleMail(payload, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const subject = String((payload && payload.subject) || "Patygo bildirimi").slice(0, 180);
  const text = String((payload && payload.text) || "").slice(0, 8000);
  if (!text) throw new Error("Mail metni boş.");
  const overrideTo = String((payload && payload.to) || "").trim();
  const to = overrideTo || String(env.CONTACT_TO || CONTACT_TO).trim() || CONTACT_TO;
  const html =
    String((payload && payload.html) || "").trim() ||
    brandedMailHtml({
      heading: subject,
      innerHtml: textToInnerHtml(text),
      env,
    });

  if (typeof opts.sendImpl === "function") {
    await opts.sendImpl({
      to,
      subject,
      text,
      html,
      attachments: Array.isArray(payload && payload.attachments) ? payload.attachments : undefined,
    });
    return { channel: "test", to, sent: true };
  }

  if (!smtpConfigured(env)) {
    throw new Error(SMTP_NOT_CONFIGURED);
  }

  const transporter = createSmtpTransporter(env);
  const attachments = Array.isArray(payload && payload.attachments)
    ? payload.attachments
        .filter((row) => row && (row.content || row.path))
        .map((row) => ({
          filename: String(row.filename || "ek.bin").slice(0, 180),
          content: row.content,
          path: row.path,
          contentType: row.contentType || undefined,
        }))
    : undefined;
  await transporter.sendMail({
    from: String(env.SMTP_FROM || env.SMTP_USER).trim(),
    to,
    subject,
    text,
    html,
    attachments: attachments && attachments.length ? attachments : undefined,
  });
  return { channel: "smtp", to, sent: true };
}

module.exports = {
  CONTACT_TO,
  ALLOWED_FIELDS,
  SMTP_NOT_CONFIGURED,
  createContactStore,
  normalizeContactPayload,
  validateContactPayload,
  buildMailText,
  smtpConfigured,
  deliverContactMail,
  deliverSimpleMail,
  brandedMailHtml,
  publicSiteBase,
  logoUrl,
  escapeHtml,
};
