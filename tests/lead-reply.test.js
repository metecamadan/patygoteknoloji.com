"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_ATTACHMENTS,
  validateLeadReplyInput,
  buildLeadReplyMail,
  sendLeadReply,
} = require("../lib/lead-reply");

const PDF = Buffer.from("%PDF-1.4\n%test teklif\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const lead = {
  id: "LEAD-T1",
  createdAt: "2026-09-01T10:00:00.000Z",
  firma: "Acme A.Ş.",
  email: "teklif@acme.example",
  mesaj: "10 adet laptop için teklif rica ederiz.",
};

function input(attachments) {
  return {
    subject: "Teklif talebiniz — Patygo Teknoloji",
    message: "Merhaba,\nTeklifimiz ektedir.",
    attachments: attachments || [],
  };
}

function file(filename, buffer) {
  return { filename, dataBase64: buffer.toString("base64") };
}

test("validateLeadReplyInput requires subject and message", () => {
  assert.match(validateLeadReplyInput({ subject: "a", message: "uzun mesaj" }).error, /Konu/);
  assert.match(validateLeadReplyInput({ subject: "Teklif", message: "" }).error, /Mesaj/);
  const ok = validateLeadReplyInput(input());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.attachments, []);
});

test("validateLeadReplyInput accepts allowed files and sets content type from the extension", () => {
  const result = validateLeadReplyInput(
    input([file("teklif.pdf", PDF), file("C:\\fakepath\\liste.xlsx", XLSX), file("urun.PNG", PNG)])
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.attachments.map((row) => [row.filename, row.contentType, row.size]),
    [
      ["teklif.pdf", "application/pdf", PDF.length],
      ["liste.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", XLSX.length],
      ["urun.PNG", "image/png", PNG.length],
    ]
  );
  assert.ok(Buffer.isBuffer(result.attachments[0].content));
});

test("validateLeadReplyInput rejects unsupported types, spoofed content and too many files", () => {
  assert.match(validateLeadReplyInput(input([file("kurulum.exe", PDF)])).error, /Desteklenmeyen/);
  assert.match(validateLeadReplyInput(input([file("teklif.pdf", PNG)])).error, /uyuşmuyor/);
  assert.match(
    validateLeadReplyInput(input([{ filename: "teklif.pdf", dataBase64: "%%%" }])).error,
    /okunamadı/
  );
  const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => file("t" + i + ".pdf", PDF));
  assert.match(validateLeadReplyInput(input(many)).error, /En fazla 5/);
});

test("validateLeadReplyInput enforces the 10 MB attachment total", () => {
  const big = Buffer.alloc(6 * 1024 * 1024, 0x20);
  PDF.copy(big);
  const result = validateLeadReplyInput(input([file("a.pdf", big), file("b.pdf", big)]));
  assert.equal(result.ok, false);
  assert.match(result.error, /10 MB/);
});

test("buildLeadReplyMail goes to the customer with info@ as bcc and reply-to, quoting the request", () => {
  const parsed = validateLeadReplyInput(input([file("teklif.pdf", PDF)]));
  const mail = buildLeadReplyMail(lead, parsed, {});
  assert.equal(mail.to, "teklif@acme.example");
  assert.equal(mail.bcc, "info@patygoteknoloji.com");
  assert.equal(mail.replyTo, "info@patygoteknoloji.com");
  assert.equal(mail.subject, "Teklif talebiniz — Patygo Teknoloji");
  assert.match(mail.text, /Teklifimiz ektedir/);
  assert.match(mail.text, /Talebiniz \(.+\):\n10 adet laptop/);
  assert.match(mail.html, /10 adet laptop/);
  assert.equal(mail.attachments.length, 1);
  assert.equal(mail.attachments[0].contentType, "application/pdf");
});

test("sendLeadReply sends through the mail hook and returns a reply record without file contents", async () => {
  const sent = [];
  const parsed = validateLeadReplyInput(input([file("teklif.pdf", PDF)]));
  const result = await sendLeadReply(lead, parsed, {
    env: {},
    by: "mete@patygoteknoloji.com",
    now: new Date("2026-10-05T09:00:00.000Z"),
    sendImpl: async (mail) => sent.push(mail),
  });
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "teklif@acme.example");
  assert.equal(sent[0].bcc, "info@patygoteknoloji.com");
  assert.equal(sent[0].attachments.length, 1);
  assert.deepEqual(result.reply, {
    at: "2026-10-05T09:00:00.000Z",
    by: "mete@patygoteknoloji.com",
    to: "teklif@acme.example",
    subject: "Teklif talebiniz — Patygo Teknoloji",
    attachments: [{ filename: "teklif.pdf", size: PDF.length }],
  });
});

test("sendLeadReply refuses without SMTP or without a valid customer email", async () => {
  const parsed = validateLeadReplyInput(input());
  const noSmtp = await sendLeadReply(lead, parsed, { env: {} });
  assert.equal(noSmtp.ok, false);
  assert.equal(noSmtp.status, 503);
  assert.match(noSmtp.error, /SMTP/);

  const noEmail = await sendLeadReply(Object.assign({}, lead, { email: "yok" }), parsed, {
    env: {},
    sendImpl: async () => assert.fail("must not send"),
  });
  assert.equal(noEmail.status, 400);
});
