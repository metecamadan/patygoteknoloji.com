#!/usr/bin/env node
/**
 * İletişim mail kanalını test eder.
 * Kullanım: node scripts/send-test-contact-mail.js
 * SMTP .env içinde tanımlıysa SMTP; değilse FormSubmit yedek kanalı.
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { deliverContactMail, smtpConfigured, CONTACT_TO } = require("../lib/contact");

async function main() {
  const data = {
    firma: "Patygo Test",
    vkn: "7230922773",
    email: "info@patygoteknoloji.com",
    tel: "05555070724",
    konu: "Sistem test maili",
    mesaj:
      "Bu otomatik bir test mesajıdır. İletişim formu mail kanalı çalışıyor. Tarih: " +
      new Date().toISOString(),
    _subject: "Patygo — iletişim formu test maili",
  };

  const mode = smtpConfigured(process.env) ? "smtp" : "formsubmit";
  console.log("Kanal:", mode);
  console.log("Alıcı:", process.env.CONTACT_TO || CONTACT_TO);

  const result = await deliverContactMail(data);
  console.log("OK:", result);
}

main().catch((err) => {
  console.error("FAIL:", err && err.message ? err.message : err);
  process.exit(1);
});
