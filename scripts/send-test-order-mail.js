#!/usr/bin/env node
/**
 * Sipariş durum mail şablonlarını test eder (SMTP .env zorunlu).
 * Kullanım:
 *   node scripts/send-test-order-mail.js paid
 *   node scripts/send-test-order-mail.js preparing
 *   node scripts/send-test-order-mail.js cancelled
 *   TEST_ORDER_MAIL_TO=you@example.com node scripts/send-test-order-mail.js paid
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { sendOrderStatusMail } = require("../lib/order-mail");
const { smtpConfigured } = require("../lib/contact");

const template = String(process.argv[2] || "paid").trim();
const allowed = new Set(["paid", "preparing", "shipped", "cancelled"]);

async function main() {
  if (!allowed.has(template)) {
    throw new Error("Geçersiz şablon. paid | preparing | shipped | cancelled");
  }
  if (!smtpConfigured(process.env)) {
    throw new Error("SMTP yapılandırılmamış (.env içinde SMTP_HOST, SMTP_USER, SMTP_PASS gerekli).");
  }

  const to = String(process.env.TEST_ORDER_MAIL_TO || process.env.CONTACT_TO || "info@patygoteknoloji.com").trim();
  const order = {
    id: "PTY-SMTP-TEST",
    total: 1250.5,
    merchandiseTotal: 1150.5,
    shippingFee: 100,
    subtotal: 958.75,
    vat: 191.75,
    customer: {
      name: "Patygo SMTP Test",
      email: to,
    },
    items: [
      {
        productId: "test-1",
        brand: "Patygo",
        name: "Test Ürün",
        qty: 1,
        line: 958.75,
        lineVat: 191.75,
      },
    ],
    shippingCarrier: "Yurtiçi Kargo",
    trackingCode: "TEST123456",
  };

  console.log("Şablon:", template);
  console.log("Alıcı:", to);
  const result = await sendOrderStatusMail(order, template, {});
  console.log("Sonuç:", result);
  if (!result.sent) {
    throw new Error(result.reason || "Mail gönderilemedi");
  }
}

main().catch((err) => {
  console.error("FAIL:", err && err.message ? err.message : err);
  process.exit(1);
});
