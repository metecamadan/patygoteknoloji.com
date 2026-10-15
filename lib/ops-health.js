"use strict";

const { isDailyQuotaError } = require("./supplier-schedule");

function resolveOpsHealth(input) {
  const slots = (input && input.slots) || [];
  const yesterday = input && input.yesterdayAlert;
  const pos = (input && input.pos) || {};

  if (yesterday && yesterday.headline) {
    const quota = Number(yesterday.quotaCount) > 0;
    return {
      tone: "err",
      label: quota ? "Dün XML kotası" : "Dün XML hatası",
      title: yesterday.headline,
      action: "xml",
    };
  }

  const failed = slots.filter((slot) => slot && slot.lastFetchStatus === "error");
  const quotaSlot = failed.find((slot) => isDailyQuotaError(slot.lastError));
  if (quotaSlot) {
    return {
      tone: "err",
      label: "XML kotası doldu",
      title: String(quotaSlot.lastError || "Günlük XML kotası doldu."),
      action: "xml",
    };
  }
  if (failed.length) {
    return {
      tone: "err",
      label: "XML hatası",
      title: String(failed[0].lastError || "XML okunamadı"),
      action: "xml",
    };
  }

  const fx = input && input.fx;
  if (fx && fx.stale) {
    return {
      tone: "err",
      label: "Döviz kuru eski",
      title: fx.ready
        ? "TCMB kuru " + (fx.rateDate || String(fx.fetchedAt || "").slice(0, 10)) +
          " tarihinden beri yenilenmedi; USD/EUR maliyetli ürünler eski kurla fiyatlanıyor."
        : "TCMB kuru alınamadı; USD/EUR maliyetli ürünler fiyatlanamıyor.",
      action: "xml",
    };
  }

  if (pos.enabled === false) {
    return {
      tone: "warn",
      label: "POS kapalı",
      title: "Akbank POS yapılandırılmamış; kart ile tahsilat alınamaz.",
      action: "overview",
    };
  }
  if (pos.testMode === true) {
    return {
      tone: "warn",
      label: "POS test modu",
      title: "Ödeme test ortamında. Canlı tahsilat kapalı.",
      action: "overview",
    };
  }
  return null;
}

module.exports = {
  resolveOpsHealth,
};
