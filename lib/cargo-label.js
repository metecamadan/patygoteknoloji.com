"use strict";

const { code128Svg } = require("./code128");
const { receiverStreet } = require("./yurtici-kargo");

// Same seller identity as mesafeli-satis-sozlesmesi.html.
const SENDER = {
  name: "Patygo Teknoloji ve Bilişim Ltd. Şti.",
  address: "Mevlana Mah. 911. Sk. Karadayı A.P No: 19 İç Kapı No: 8",
  cityLine: "Gaziosmanpaşa / İstanbul",
  phone: "0555 507 07 24",
};

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "").replace(/^90(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
  if (digits.length !== 10) return String(raw || "");
  return "0" + digits.slice(0, 3) + " " + digits.slice(3, 6) + " " + digits.slice(6, 8) + " " + digits.slice(8);
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short" }).format(d);
}

const LABEL_CSS =
  "@page{size:A5 portrait;margin:8mm}" +
  "*{box-sizing:border-box}" +
  "body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}" +
  ".label{width:132mm;margin:0 auto;border:0.6mm solid #000}" +
  ".row{padding:3mm 4mm;border-bottom:0.4mm solid #000}" +
  ".row:last-child{border-bottom:0}" +
  ".head{display:flex;justify-content:space-between;align-items:baseline}" +
  ".carrier{font-size:16pt;font-weight:700}" +
  ".tag{font-size:9pt;font-weight:700;text-transform:uppercase}" +
  ".cap{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 1mm}" +
  ".sender p{margin:0;font-size:9pt;line-height:1.35}" +
  ".to-name{font-size:15pt;font-weight:700;margin:0 0 1.5mm}" +
  ".to p{margin:0;font-size:11pt;line-height:1.4}" +
  ".to .city{font-size:14pt;font-weight:700;margin-top:1.5mm}" +
  ".barcode{text-align:center;padding:4mm 4mm 3mm}" +
  ".barcode svg{display:block;margin:0 auto}" +
  ".key{font-family:'Courier New',monospace;font-size:16pt;font-weight:700;letter-spacing:0.08em;margin:2mm 0 0}" +
  ".meta{display:flex;justify-content:space-between;font-size:9pt}" +
  ".print{display:block;margin:6mm auto;padding:3mm 8mm;font-size:12pt;cursor:pointer}" +
  "@media print{.print{display:none}}";

/** Printable A5 page for a parcel; the branch scans the cargo key barcode. */
function buildCargoLabelHtml(order, shipment) {
  const c = (order && order.customer) || {};
  const s = shipment || {};
  const cargoKey = String(s.cargoKey || "");
  const receiver = String(c.company || c.name || "").trim();
  const desi = Number(s.desi) > 0 ? String(s.desi) : "—";
  const testNote = s.mode === "test" ? "<span class='tag'>TEST ORTAMI</span>" : "<span class='tag'>Gönderici ödemeli</span>";
  return (
    "<!doctype html><html lang='tr'><head><meta charset='utf-8'>" +
    "<title>Kargo etiketi " +
    esc(order.id) +
    "</title><style>" +
    LABEL_CSS +
    "</style></head><body>" +
    "<div class='label'>" +
    "<div class='row head'><span class='carrier'>" +
    esc(s.carrier || "Yurtiçi Kargo") +
    "</span>" +
    testNote +
    "</div>" +
    "<div class='row sender'><p class='cap'>Gönderici</p><p><strong>" +
    esc(SENDER.name) +
    "</strong></p><p>" +
    esc(SENDER.address) +
    "</p><p>" +
    esc(SENDER.cityLine) +
    " · " +
    esc(SENDER.phone) +
    "</p></div>" +
    "<div class='row to'><p class='cap'>Alıcı</p><p class='to-name'>" +
    esc(receiver) +
    "</p><p>" +
    esc(receiverStreet(c)) +
    "</p><p class='city'>" +
    esc(String(c.shippingDistrict || "") + " / " + String(c.shippingCity || "")) +
    "</p><p>Tel: " +
    esc(formatPhone(c.phone)) +
    "</p></div>" +
    "<div class='row barcode'>" +
    code128Svg(cargoKey, { width: "110mm", height: "26mm" }) +
    "<p class='key'>" +
    esc(cargoKey) +
    "</p></div>" +
    "<div class='row meta'><span>Sipariş: <strong>" +
    esc(order.id) +
    "</strong></span><span>Adet: 1 · Desi: " +
    esc(desi) +
    "</span><span>" +
    esc(formatDate(s.createdAt)) +
    "</span></div>" +
    "</div>" +
    "<button type='button' class='print' id='cargoLabelPrint'>Yazdır</button>" +
    "<script src='/assets/js/cargo-label.js?v=cargo-1'></script>" +
    "</body></html>"
  );
}

module.exports = { SENDER, buildCargoLabelHtml, formatPhone };
