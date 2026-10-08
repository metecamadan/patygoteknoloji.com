"use strict";

/** Plate order (01 Adana … 81 Düzce); odeme.html <select> options must stay in sync (tests/checkout-billing.test.js). */
const TR_PROVINCES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin", "Aydın",
  "Balıkesir", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı",
  "Çorum", "Denizli", "Diyarbakır", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir",
  "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Isparta", "Mersin", "İstanbul", "İzmir",
  "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir", "Kocaeli", "Konya", "Kütahya", "Malatya",
  "Manisa", "Kahramanmaraş", "Mardin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Rize", "Sakarya",
  "Samsun", "Siirt", "Sinop", "Sivas", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Şanlıurfa", "Uşak",
  "Van", "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman", "Kırıkkale", "Batman", "Şırnak",
  "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye", "Düzce",
];

const PROVINCE_SET = new Set(TR_PROVINCES);

/** { "İstanbul": ["Adalar", …], … } — 81 il, 973 ilçe; checkout.js fetches the same file for the ilçe <select>. */
const TR_DISTRICTS = require("../assets/geo/tr-districts.json");

const trKey = (value) => String(value || "").toLocaleLowerCase("tr-TR");

const DISTRICT_LOOKUP = new Map(
  Object.entries(TR_DISTRICTS).map(([city, names]) => [city, new Map(names.map((name) => [trKey(name), name]))])
);

/** Official spelling of the district when it belongs to the province; otherwise "". */
function canonicalDistrict(city, district) {
  const names = DISTRICT_LOOKUP.get(city);
  return (names && names.get(trKey(district))) || "";
}

function clean(value, max) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Structured address from checkout → validated parts plus the single-line text stored on the order
 * (admin panel and e-invoice read the string form).
 */
function normalizeAddress(raw, label) {
  const parts = raw && typeof raw === "object" ? raw : {};
  const line = clean(parts.line, 300);
  const rawDistrict = clean(parts.district, 60);
  const city = clean(parts.city, 40);
  const prefix = label ? label + ": " : "";
  if (line.length < 10) return { ok: false, error: prefix + "açık adresi (mahalle, sokak, no) yazın." };
  if (!rawDistrict) return { ok: false, error: prefix + "ilçe gerekli." };
  if (!PROVINCE_SET.has(city)) return { ok: false, error: prefix + "il seçin." };
  const district = canonicalDistrict(city, rawDistrict);
  if (!district) return { ok: false, error: prefix + "ilçeyi " + city + " ilçeleri listesinden seçin." };
  const text = line + ", " + district + " / " + city;
  return { ok: true, value: { line, district, city, text } };
}

function isValidTckn(value) {
  const s = String(value || "");
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== d[9]) return false;
  return d.slice(0, 10).reduce((sum, n) => sum + n, 0) % 10 === d[10];
}

function isValidVkn(value) {
  return /^\d{10}$/.test(String(value || ""));
}

/**
 * bireysel: T.C. kimlik no optional (validated when given).
 * kurumsal: company title, tax office and VKN (or sole-proprietor TCKN) required.
 */
function normalizeInvoiceIdentity(raw) {
  const c = raw || {};
  const type = c.customerType === "kurumsal" ? "kurumsal" : "bireysel";
  const taxId = String(c.taxId || "").replace(/\D/g, "").slice(0, 11);
  const company = clean(c.company, 120);
  const taxOffice = clean(c.taxOffice, 80);
  if (type === "bireysel") {
    if (taxId && !isValidTckn(taxId)) return { ok: false, error: "T.C. kimlik numarası geçersiz." };
    return { ok: true, value: { customerType: type, taxId, company, taxOffice: "" } };
  }
  if (company.length < 2) return { ok: false, error: "Kurumsal fatura için firma ünvanı gerekli." };
  if (taxOffice.length < 2) return { ok: false, error: "Kurumsal fatura için vergi dairesi gerekli." };
  if (!isValidVkn(taxId) && !isValidTckn(taxId)) {
    return { ok: false, error: "Vergi numarası 10 haneli olmalı (şahıs şirketinde 11 haneli T.C. no)." };
  }
  return { ok: true, value: { customerType: type, taxId, company, taxOffice } };
}

module.exports = {
  TR_PROVINCES,
  TR_DISTRICTS,
  canonicalDistrict,
  normalizeAddress,
  normalizeInvoiceIdentity,
  isValidTckn,
  isValidVkn,
};
