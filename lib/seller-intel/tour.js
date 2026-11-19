"use strict";

const fs = require("fs");
const path = require("path");
const { assertPublicHttpUrl } = require("../network-guard");
const {
  AKAKCE_ORIGIN,
  dedupeSellers,
  extractProductLinks,
  extractStoreLinks,
  parseStorePage,
  sellerIdentity,
  summarizeSellers,
} = require("./parse");
const { collectMapSellers } = require("./maps");

const CATEGORIES = [
  { id: "laptop-notebook", ad: "Dizüstü bilgisayar", yol: "/laptop-notebook.html" },
  { id: "cep-telefonu", ad: "Cep telefonu", yol: "/cep-telefonu.html" },
  { id: "masaustu-bilgisayar", ad: "Masaüstü bilgisayar", yol: "/masaustu-bilgisayar.html" },
  { id: "tablet", ad: "Tablet", yol: "/tablet.html" },
  { id: "monitor", ad: "Monitör", yol: "/monitor.html" },
];

function priceListHtml(html) {
  const source = String(html || "");
  const start = source.search(/class="pl_v\d+/i);
  if (start < 0) return "";
  const sectionEnd = source.indexOf("</section>", start);
  const footer = source.search(/id="F_v|Tüm Satıcılar/i);
  let end = source.length;
  if (sectionEnd > start) end = sectionEnd;
  if (footer > start && footer < end) end = footer;
  return source.slice(start, end);
}

async function readText(url, fetchImpl) {
  await assertPublicHttpUrl(url);
  const response = await fetchImpl(url, {
    headers: { accept: "text/html", "user-agent": "PatygoSellerIntel/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`Kaynak yanıtı ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTour(options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || global.fetch;
  const pause = opts.sleep || sleep;
  const category = CATEGORIES.find((row) => row.id === (opts.categoryId || CATEGORIES[0].id));
  if (!category) throw new Error("Elektronik kategori listede yok.");
  const limit = Math.max(1, Math.min(Number(opts.limit) || 8, 20));
  const listUrl = new URL(category.yol, AKAKCE_ORIGIN).href;
  const listHtml = await readText(listUrl, fetchImpl);
  const products = extractProductLinks(listHtml, category.id).slice(0, limit);
  const seen = new Map();
  let unreadable = 0;
  for (const productPath of products) {
    const productUrl = new URL(productPath, AKAKCE_ORIGIN).href;
    let html = "";
    try {
      html = await readText(productUrl, fetchImpl);
    } catch (_) {
      unreadable += 1;
      await pause(opts.delayMs || 0);
      continue;
    }
    const slice = priceListHtml(html);
    if (!slice) unreadable += 1;
    for (const store of extractStoreLinks(slice)) {
      if (!seen.has(store.yol)) {
        seen.set(store.yol, {
          ad: store.ad,
          unvan: "",
          sehir: "",
          kanal: "pazaryeri",
          site: new URL(store.yol, AKAKCE_ORIGIN).href,
          telefon: "",
          eposta: "",
          kategori: category.ad,
          kaynak: productUrl,
        });
      }
    }
    await pause(opts.delayMs || 0);
  }
  const sellers = [...seen.values()].slice(0, limit);
  for (const seller of sellers) {
    try {
      const page = await readText(seller.site, fetchImpl);
      const parsed = parseStorePage(page, seller.site, category.ad);
      if (parsed.ad) seller.ad = parsed.ad;
      seller.unvan = parsed.unvan;
      if (parsed.telefon) seller.telefon = parsed.telefon;
      if (parsed.eposta) seller.eposta = parsed.eposta;
      if (parsed.site && parsed.site !== seller.site) {
        seller.site = parsed.site;
        seller.kanal = "kendi sitesi";
      }
    } catch (_) {
      unreadable += 1;
    }
    await pause(opts.delayMs || 0);
  }
  const maps = await collectMapSellers({
    googleKey: opts.googleKey || "",
    yandexKey: opts.yandexKey || "",
    query: `${category.ad} mağazası`,
    kategori: category.ad,
    fetchImpl,
  });
  const previous = Array.isArray(opts.previous) ? opts.previous : [];
  const previousKeys = new Set(previous.map(sellerIdentity).filter(Boolean));
  const incoming = sellers.concat(maps.kayitlar);
  const merged = dedupeSellers(previous.concat(incoming));
  const fresh = incoming.filter((row) => {
    const key = sellerIdentity(row);
    return key && !previousKeys.has(key);
  });
  const ozet = summarizeSellers(merged.kayitlar, {
    turKategori: category.ad,
    buTurYeni: dedupeSellers(fresh).kayitlar.length,
    buTurMukerrer: dedupeSellers(incoming).mukerrer,
    okunamayanSayfa: unreadable,
    gidilmeyenKategori: CATEGORIES.filter((row) => row.id !== category.id).map((row) => row.ad),
    haritaAtlanan: maps.atlanan,
    faz2: "kapali",
  });
  return { kayitlar: merged.kayitlar, ozet };
}

function writeTourFiles(dir, result) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "records.json"), JSON.stringify(result.kayitlar));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(result.ozet, null, 2));
}

module.exports = { CATEGORIES, priceListHtml, runTour, writeTourFiles };
