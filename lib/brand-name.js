"use strict";

const { trLowerCase, foldSearchText } = require("./tr-text");

/** Official spellings that casing rules cannot derive. Keys are foldSearchText() of the brand. */
const BRAND_DISPLAY_OVERRIDES = {
  hp: "HP",
  msi: "MSI",
  amd: "AMD",
  lg: "LG",
  aoc: "AOC",
  apc: "APC",
  jbl: "JBL",
  wd: "WD",
  ibm: "IBM",
  nzxt: "NZXT",
  xpg: "XPG",
  benq: "BenQ",
  "tp-link": "TP-Link",
  tplink: "TP-Link",
  "d-link": "D-Link",
  dlink: "D-Link",
  "s-link": "S-Link",
  "g.skill": "G.Skill",
  "g-skill": "G.Skill",
  zyxel: "ZyXEL",
  ezviz: "EZVIZ",
};

const TURKISH_ONLY_LETTERS = /[ĞÜŞÖÇğüşöç]/;
const LETTER = /[A-Za-zİıĞğÜüŞşÖöÇç]/g;

function capitalizeLatin(word) {
  const latin = word.replace(/İ/g, "I").replace(/ı/g, "i");
  return latin.charAt(0).toUpperCase() + latin.slice(1).toLowerCase();
}

function capitalizeTurkish(word) {
  const first = word.charAt(0);
  const upper = first === "i" ? "İ" : first === "ı" ? "I" : first.toLocaleUpperCase("tr-TR");
  return upper + trLowerCase(word.slice(1));
}

function formatBrandWord(word) {
  const letters = word.match(LETTER) || [];
  if (!letters.length) return word;
  if (letters.length <= 2) return word.replace(/İ/g, "I").replace(/ı/g, "I").toUpperCase();
  // Supplier feeds type Latin brands with Turkish İ (FRİSBY, S-LİNK); only real Turkish words keep tr casing.
  return TURKISH_ONLY_LETTERS.test(word) ? capitalizeTurkish(word) : capitalizeLatin(word);
}

/**
 * Storefront brand label: KINGSTON → Kingston, FRİSBY → Frisby, ARÇELİK → Arçelik, HP → HP.
 * Mixed-case input from the feed is kept (only broken dotted-i sequences are repaired).
 */
function formatBrandName(raw) {
  const text = String(raw || "")
    .replace(/[\u00A0\s]+/g, " ")
    .replace(/i\u0307/g, "i")
    .trim();
  if (!text) return "";
  const override = BRAND_DISPLAY_OVERRIDES[foldSearchText(text)];
  if (override) return override;
  const letters = text.match(LETTER) || [];
  if (letters.length <= 3) return text.replace(/ı/g, "I").replace(/İ/g, "I").toUpperCase();
  const hasLower = /[a-zğüşıöç]/.test(text);
  const hasUpper = /[A-ZİĞÜŞÖÇ]/.test(text);
  const upperShare = (text.match(/[A-ZİĞÜŞÖÇ]/g) || []).length / letters.length;
  if (hasLower && hasUpper && upperShare < 0.6) return text;
  return text
    .split(/([\s\-/.&+]+)/)
    .map((part) => (/^[\s\-/.&+]+$/.test(part) ? part : formatBrandWord(part)))
    .join("");
}

module.exports = { formatBrandName, BRAND_DISPLAY_OVERRIDES };
