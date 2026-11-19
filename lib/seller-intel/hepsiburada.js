"use strict";

const { assertPublicHttpUrl } = require("../network-guard");

const ORIGIN = "https://www.hepsiburada.com";
const SKIP_SLUG = new Set(["hepsiburada", "giris", "yardim", "magaza"]);

function decodeBasic(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#64;/g, "@")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMerchantLinks(html) {
  const source = String(html || "");
  const found = new Map();
  const pattern = /href="(?:https?:\/\/(?:www\.)?hepsiburada\.com)?(\/magaza\/([a-z0-9-]+))"/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const slug = match[2].toLowerCase();
    if (SKIP_SLUG.has(slug) || found.has(slug)) continue;
    found.set(slug, { yol: `/magaza/${slug}` });
  }
  return [...found.values()];
}

function sellerEmail(value) {
  const email = decodeBasic(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  const host = email.split("@")[1] || "";
  if (host.endsWith("hepsiburada.com") || host.endsWith("hepsiburada.com.tr")) return "";
  return email;
}

function labeledValue(html, label) {
  const pattern = new RegExp(label + "(?:\\s*</[^>]+>)?\\s*<[^>]+>([^<]{3,80})<", "i");
  const match = String(html || "").match(pattern);
  return match ? decodeBasic(match[1]) : "";
}

function parseMerchantPage(html, pageUrl, kategori) {
  const source = String(html || "");
  const mailto = source.match(/mailto:([^"'?\s>]+)/i);
  const jsonMail = source.match(/"(?:email|eMail|eposta)"\s*:\s*"([^"]+)"/i);
  const jsonPhone = source.match(/"(?:phone|phoneNumber|telefon)"\s*:\s*"([^"]+)"/i);
  const nameMatch = source.match(/<h1[^>]*>([^<]{2,120})<\/h1>/i);
  const eposta = sellerEmail(mailto ? mailto[1] : "") || sellerEmail(labeledValue(source, "E-?posta")) || sellerEmail(jsonMail && jsonMail[1]);
  const telefon = decodeBasic(labeledValue(source, "Telefon") || (jsonPhone && jsonPhone[1]) || "");
  return {
    ad: decodeBasic(nameMatch ? nameMatch[1] : ""),
    unvan: decodeBasic(labeledValue(source, "Ünvan") || labeledValue(source, "Unvan")),
    sehir: decodeBasic(labeledValue(source, "İl") || labeledValue(source, "Sehir")),
    kanal: "hepsiburada",
    site: pageUrl,
    telefon,
    eposta,
    kategori: kategori || "",
    kaynak: pageUrl,
  };
}

async function readHepsiburada(url, fetchImpl) {
  const parsed = await assertPublicHttpUrl(url);
  if (!parsed.hostname.toLowerCase().endsWith("hepsiburada.com")) {
    throw new Error("Hepsiburada dışı adres okunmaz.");
  }
  const response = await fetchImpl(url, {
    headers: { accept: "text/html", "user-agent": "PatygoSellerIntel/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`Hepsiburada yanıtı ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function collectHepsiburada(options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl;
  if (typeof fetchImpl !== "function") throw new Error("Hepsiburada okuması fetch olmadan yapılmaz.");
  const query = String(opts.query || "elektronik").slice(0, 80);
  const limit = Math.max(1, Math.min(Number(opts.limit) || 5, 10));
  const searchUrl = new URL("/ara", ORIGIN);
  searchUrl.searchParams.set("q", query);
  const html = await readHepsiburada(searchUrl.href, fetchImpl);
  const links = extractMerchantLinks(html).slice(0, limit);
  const kayitlar = [];
  for (const link of links) {
    const pageUrl = new URL(link.yol, ORIGIN).href;
    try {
      const page = await readHepsiburada(pageUrl, fetchImpl);
      const row = parseMerchantPage(page, pageUrl, opts.kategori || "");
      if (row.ad || row.eposta || row.telefon) kayitlar.push(row);
    } catch (_) {
      kayitlar.push({
        ad: link.yol.split("/").pop(),
        kanal: "hepsiburada",
        site: pageUrl,
        telefon: "",
        eposta: "",
        kategori: opts.kategori || "",
        kaynak: pageUrl,
        not: "sayfa okunamadı",
      });
    }
    if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
  }
  return {
    kayitlar,
    arama: searchUrl.href,
    not: links.length ? "" : "Aramada herkese açık mağaza linki yok.",
  };
}

module.exports = {
  collectHepsiburada,
  extractMerchantLinks,
  parseMerchantPage,
  sellerEmail,
};
