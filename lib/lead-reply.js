"use strict";

const {
  CONTACT_TO,
  brandedMailHtml,
  textToInnerHtml,
  escapeHtml,
  isValidEmail,
  smtpConfigured,
  deliverSimpleMail,
} = require("./contact");

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
const SUBJECT_MAX = 180;
const MESSAGE_MAX = 6000;

const OLE = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1;
const ZIP = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

// Content type comes from the extension and the bytes must match it; the browser's MIME is ignored.
const ATTACHMENT_TYPES = {
  pdf: { contentType: "application/pdf", sniff: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  png: { contentType: "image/png", sniff: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  jpg: { contentType: "image/jpeg", sniff: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { contentType: "image/jpeg", sniff: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sniff: ZIP,
  },
  xlsx: {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sniff: ZIP,
  },
  doc: { contentType: "application/msword", sniff: OLE },
  xls: { contentType: "application/vnd.ms-excel", sniff: OLE },
};

function safeFilename(raw) {
  const base = String(raw || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f"<>|:*?]/g, "")
    .trim()
    .slice(0, 120);
  return base;
}

function validateLeadReplyInput(body) {
  const src = body && typeof body === "object" ? body : {};
  const subject = String(src.subject || "").replace(/\s+/g, " ").trim();
  const message = String(src.message || "").replace(/\r\n/g, "\n").trim();
  if (subject.length < 3) return { ok: false, error: "Konu en az 3 karakter olmalı." };
  if (subject.length > SUBJECT_MAX) return { ok: false, error: "Konu en fazla " + SUBJECT_MAX + " karakter olabilir." };
  if (message.length < 5) return { ok: false, error: "Mesajınızı yazın." };
  if (message.length > MESSAGE_MAX) return { ok: false, error: "Mesaj en fazla " + MESSAGE_MAX + " karakter olabilir." };

  const rawList = Array.isArray(src.attachments) ? src.attachments : [];
  if (rawList.length > MAX_ATTACHMENTS) {
    return { ok: false, error: "En fazla " + MAX_ATTACHMENTS + " dosya eklenebilir." };
  }
  const attachments = [];
  let total = 0;
  for (const row of rawList) {
    const filename = safeFilename(row && row.filename);
    const ext = (/\.([a-z0-9]+)$/i.exec(filename) || [])[1];
    const type = ext ? ATTACHMENT_TYPES[ext.toLowerCase()] : null;
    if (!filename || !type) {
      return { ok: false, error: "Desteklenmeyen dosya: " + (filename || "adsız") + ". PDF, Word, Excel, PNG veya JPG ekleyin." };
    }
    const data = String((row && row.dataBase64) || "");
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return { ok: false, error: filename + " okunamadı." };
    }
    const content = Buffer.from(data, "base64");
    if (!content.length) return { ok: false, error: filename + " boş." };
    if (!type.sniff(content)) {
      return { ok: false, error: filename + " içeriği uzantısıyla uyuşmuyor." };
    }
    total += content.length;
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      return { ok: false, error: "Ekler toplamı en fazla 10 MB olabilir." };
    }
    attachments.push({ filename, content, contentType: type.contentType, size: content.length });
  }
  return { ok: true, subject, message, attachments };
}

function formatLeadDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" });
}

function buildLeadReplyMail(lead, input, env) {
  const original = String((lead && lead.mesaj) || "").trim();
  const when = formatLeadDate(lead && lead.createdAt);
  const quoteLabel = "Talebiniz" + (when ? " (" + when + ")" : "") + ":";
  const text = [input.message, "", "—", quoteLabel, original].join("\n");
  const quoteHtml = original
    ? '<div style="margin-top:20px;padding:12px 14px;border-left:3px solid #cbd5e1;background:#f8fafc;border-radius:6px;">' +
      '<p style="margin:0 0 6px;font-size:12px;color:#64748b;">' +
      escapeHtml(quoteLabel) +
      "</p>" +
      textToInnerHtml(original).replace(/color:#334155;/g, "color:#64748b;") +
      "</div>"
    : "";
  return {
    to: String(lead.email || "").trim(),
    bcc: CONTACT_TO,
    replyTo: CONTACT_TO,
    subject: input.subject,
    text,
    html: brandedMailHtml({
      heading: input.subject,
      innerHtml: textToInnerHtml(input.message) + quoteHtml,
      env,
    }),
    attachments: input.attachments.map((file) => ({
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
    })),
  };
}

async function sendLeadReply(lead, input, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (!lead || !isValidEmail(lead.email)) {
    return { ok: false, status: 400, error: "Talepte geçerli bir e-posta yok." };
  }
  if (typeof opts.sendImpl !== "function" && !smtpConfigured(env)) {
    return { ok: false, status: 503, error: "SMTP yapılandırılmamış; panelden talep yanıtı gönderilemez." };
  }
  const mail = buildLeadReplyMail(lead, input, env);
  await deliverSimpleMail(mail, { env, sendImpl: opts.sendImpl });
  return {
    ok: true,
    reply: {
      at: (opts.now instanceof Date ? opts.now : new Date()).toISOString(),
      by: String(opts.by || ""),
      to: mail.to,
      subject: input.subject,
      attachments: input.attachments.map((file) => ({ filename: file.filename, size: file.size })),
    },
  };
}

module.exports = {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_REQUEST_BYTES,
  validateLeadReplyInput,
  buildLeadReplyMail,
  sendLeadReply,
};
