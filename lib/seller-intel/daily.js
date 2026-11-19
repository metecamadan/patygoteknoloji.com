"use strict";

const fs = require("fs");
const path = require("path");
const { deliverSimpleMail, smtpConfigured, SMTP_NOT_CONFIGURED } = require("../contact");
const { CATEGORIES, runTour, writeTourFiles } = require("./tour");
const { collectHepsiburada } = require("./hepsiburada");
const { dedupeSellers, sellerIdentity } = require("./parse");

const DEFAULT_TO = "mete.camadan@patygoteknoloji.com";
const LINKEDIN_NOTE =
  "LinkedIn kişi kaydı alınmadı. Firma yetkilisinin kişisel profili ve çalışan e-postası toplanmaz.";

function istanbulParts(now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => (parts.find((part) => part.type === type) || {}).value || "";
  return {
    day: `${pick("year")}-${pick("month")}-${pick("day")}`,
    hour: Number(pick("hour")) || 0,
  };
}

function categoryForDay(dayKey) {
  const stamp = Number(String(dayKey || "").replace(/\D/g, "")) || 0;
  return CATEGORIES[stamp % CATEGORIES.length];
}

function loadState(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "daily.json"), "utf8"));
  } catch (_) {
    return {};
  }
}

function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "daily.json"), JSON.stringify(state));
}

function buildDailyMail(report, to) {
  const ozet = report.ozet || {};
  const lines = [
    `Satıcı keşif özeti (${ozet.gun || ""})`,
    `Kategori: ${ozet.turKategori || "-"}`,
    `Yeni: ${ozet.buTurYeni || 0}`,
    `Mükerrer: ${ozet.buTurMukerrer || 0}`,
    `Kayıt: ${ozet.bulunan || 0}`,
    `İletişimi tam: ${ozet.tam || 0}`,
    `Eksiği olan: ${ozet.eksik || 0}`,
    `Hepsiburada: ${ozet.hepsiburadaNot || "okundu"}`,
    `Harita: ${(ozet.haritaAtlanan || []).map((row) => row.kaynak + " " + row.neden).join("; ") || "okundu"}`,
    LINKEDIN_NOTE,
    "Faz 2 kapalı: satıcılara teklif gönderilmedi.",
    "",
    "Yayınlanan işletme iletişimi (bu tur, en fazla 30):",
  ];
  const rows = (report.yayin || []).slice(0, 30);
  if (!rows.length) lines.push("Bu turda telefon veya e-posta görünen yeni kayıt yok.");
  for (const row of rows) {
    lines.push(
      [row.ad, row.kanal, row.sehir, row.telefon, row.eposta, row.site].filter(Boolean).join(" | ")
    );
  }
  if ((report.yayin || []).length > 30) lines.push("Kalan kayıt sunucudaki .runtime/seller-intel altında.");
  return {
    to,
    subject: `Satıcı keşif ${ozet.gun || ""}`.trim(),
    text: lines.join("\n"),
  };
}

async function runDaily(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const clock = istanbulParts(now);
  const dir = opts.dir || path.join(process.cwd(), ".runtime", "seller-intel");
  const state = loadState(dir);
  if (!opts.force && (clock.hour < 8 || state.lastDay === clock.day)) {
    return { skipped: true, gun: clock.day };
  }
  saveState(dir, Object.assign({}, state, { lastDay: clock.day, startedAt: now.toISOString() }));
  const category = categoryForDay(clock.day);
  const fetchImpl = opts.fetchImpl || global.fetch;
  const tour = await runTour({
    categoryId: category.id,
    limit: opts.limit || 8,
    delayMs: opts.delayMs || 0,
    fetchImpl,
    sleep: opts.sleep,
    googleKey: env.GOOGLE_MAPS_API_KEY || "",
    yandexKey: env.YANDEX_MAPS_API_KEY || "",
    previous: state.records || [],
  });
  let hepsiburada = { kayitlar: [], not: "" };
  try {
    hepsiburada = await collectHepsiburada({
      query: category.ad,
      kategori: category.ad,
      limit: opts.hepsiburadaLimit || 5,
      delayMs: opts.delayMs || 0,
      fetchImpl,
    });
  } catch (error) {
    hepsiburada = { kayitlar: [], not: String(error && error.message ? error.message : error).slice(0, 180) };
  }
  const previousKeys = new Set((state.records || []).map(sellerIdentity).filter(Boolean));
  const incoming = tour.kayitlar.concat(hepsiburada.kayitlar);
  const merged = dedupeSellers(incoming);
  const yayin = incoming.filter((row) => {
    const key = sellerIdentity(row);
    return key && !previousKeys.has(key) && (row.telefon || row.eposta);
  });
  const ozet = Object.assign({}, tour.ozet, {
    gun: clock.day,
    bulunan: merged.kayitlar.length,
    hepsiburadaNot: hepsiburada.not || `${hepsiburada.kayitlar.length} mağaza`,
    linkedin: LINKEDIN_NOTE,
  });
  const result = { kayitlar: merged.kayitlar, ozet, yayin };
  writeTourFiles(dir, result);
  saveState(dir, {
    lastDay: clock.day,
    finishedAt: new Date().toISOString(),
    records: merged.kayitlar,
  });
  const to = String(env.SELLER_INTEL_TO || DEFAULT_TO).trim() || DEFAULT_TO;
  const mail = buildDailyMail(result, to);
  if (typeof opts.sendImpl === "function" || smtpConfigured(env)) {
    await deliverSimpleMail(mail, { env, sendImpl: opts.sendImpl });
    ozet.mail = "gitti";
  } else {
    ozet.mail = SMTP_NOT_CONFIGURED;
  }
  writeTourFiles(dir, result);
  return { skipped: false, ozet, yayin };
}

function startSellerIntelDaily(options) {
  const opts = options || {};
  const tick = () => {
    runDaily(opts).catch((error) => {
      console.warn("Satıcı keşif turu:", String((error && error.message) || error).slice(0, 200));
    });
  };
  const timer = setInterval(tick, 30 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  const start = setTimeout(tick, 2 * 60 * 1000);
  if (typeof start.unref === "function") start.unref();
  return {
    stop() {
      clearInterval(timer);
      clearTimeout(start);
    },
  };
}

module.exports = {
  DEFAULT_TO,
  LINKEDIN_NOTE,
  buildDailyMail,
  categoryForDay,
  istanbulParts,
  runDaily,
  startSellerIntelDaily,
};
