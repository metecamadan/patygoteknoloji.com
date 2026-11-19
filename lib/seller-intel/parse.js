"use strict";

const AKAKCE_ORIGIN = "https://www.akakce.com";
const SKIP_STORE = new Set(["degerlendir"]);

function decodeBasic(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStoreLinks(html) {
  const source = String(html || "");
  const found = new Map();
  const pattern = /<a\b[^>]*href="(\/magaza\/([a-z0-9-]+)\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const slug = match[2].toLowerCase();
    if (SKIP_STORE.has(slug)) continue;
    const title = match[0].match(/\btitle="([^"]+)"/i);
    const text = decodeBasic(match[3].replace(/<[^>]+>/g, " "));
    const name = decodeBasic(title ? title[1] : text);
    if (!name || found.has(slug)) continue;
    found.set(slug, {
      ad: name,
      yol: `/magaza/${slug}.html`,
    });
  }
  return [...found.values()];
}

function extractProductLinks(html, categoryPath) {
  const source = String(html || "");
  const prefix = String(categoryPath || "").replace(/^\/|\/$/g, "");
  const pattern = new RegExp(`href="(/(?:${prefix})/en-ucuz-[^"#?]+\\.html)"`, "gi");
  const found = new Set();
  let match;
  while ((match = pattern.exec(source))) found.add(match[1]);
  return [...found];
}

function extractPublishedContacts(html) {
  const source = String(html || "");
  const mail = source.match(/mailto:([^"'?\s>]+)/i);
  const tel = source.match(/tel:([^"'?\s>]+)/i);
  const labeledPhone = source.match(/Telefon[^<]{0,40}<[^>]+>([^<]{6,20})</i);
  const labeledMail = source.match(/E-?posta[^<]{0,40}<[^>]+>([^<@\s]+@[^<\s]+)</i);
  let site = "";
  const links = source.match(/href="(https?:\/\/[^"]+)"/gi) || [];
  for (const raw of links) {
    const href = raw.slice(6, -1);
    let host = "";
    try {
      host = new URL(href).hostname.toLowerCase();
    } catch (_) {
      continue;
    }
    if (
      host.endsWith("akakce.com") ||
      host.endsWith("akamaized.net") ||
      host.endsWith("google.com") ||
      host.endsWith("gstatic.com") ||
      host.endsWith("googleapis.com") ||
      host.endsWith("doubleclick.net") ||
      host.endsWith("googlesyndication.com") ||
      host.endsWith("efilli.com")
    ) {
      continue;
    }
    site = href;
    break;
  }
  return {
    telefon: decodeBasic(tel ? tel[1] : labeledPhone ? labeledPhone[1] : ""),
    eposta: decodeBasic(mail ? mail[1] : labeledMail ? labeledMail[1] : "").toLowerCase(),
    site,
  };
}

function parseStorePage(html, pageUrl, kategori) {
  const source = String(html || "");
  const heading = source.match(/<h1>([^<]+)<\/h1>(?:\s*([^<]{2,160}))?/i);
  const contacts = extractPublishedContacts(source);
  const ad = decodeBasic(heading ? heading[1] : "");
  const unvan = decodeBasic(heading && heading[2] ? heading[2] : "");
  return {
    ad: ad || unvan,
    unvan,
    sehir: "",
    kanal: "pazaryeri",
    site: contacts.site || pageUrl,
    telefon: contacts.telefon,
    eposta: contacts.eposta,
    kategori: kategori || "",
    kaynak: pageUrl,
  };
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function hostKey(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.endsWith("akakce.com")) return "";
    return host;
  } catch (_) {
    return "";
  }
}

function nameKey(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sellerIdentity(record) {
  return phoneKey(record.telefon) || hostKey(record.site) || nameKey(record.ad || record.unvan);
}

function completeness(record) {
  return {
    telefon: Boolean(phoneKey(record.telefon)),
    eposta: Boolean(record.eposta && record.eposta.includes("@")),
    site: Boolean(record.site),
  };
}

function dedupeSellers(records) {
  const kept = [];
  const seen = new Set();
  let duplicates = 0;
  for (const record of records || []) {
    const key = sellerIdentity(record);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    kept.push(record);
  }
  return { kayitlar: kept, mukerrer: duplicates };
}

function summarizeSellers(records, extra) {
  const rows = records || [];
  const sehir = {};
  const kanal = {};
  let tam = 0;
  let eksik = 0;
  for (const row of rows) {
    const doluluk = completeness(row);
    if (doluluk.telefon && doluluk.eposta && doluluk.site) tam += 1;
    else eksik += 1;
    const city = row.sehir || "bilinmiyor";
    sehir[city] = (sehir[city] || 0) + 1;
    const channel = row.kanal || "bilinmiyor";
    kanal[channel] = (kanal[channel] || 0) + 1;
  }
  return Object.assign(
    {
      bulunan: rows.length,
      tam,
      eksik,
      sehir,
      kanal,
      faz2: "kapali",
    },
    extra || {}
  );
}

function refuseOffer() {
  throw new Error("Faz 2 kapalı: otomatik teklif gönderilmez.");
}

module.exports = {
  AKAKCE_ORIGIN,
  completeness,
  dedupeSellers,
  extractProductLinks,
  extractPublishedContacts,
  extractStoreLinks,
  hostKey,
  nameKey,
  parseStorePage,
  phoneKey,
  refuseOffer,
  sellerIdentity,
  summarizeSellers,
};
