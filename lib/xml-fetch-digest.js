"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");
const { istanbulParts, isDailyQuotaError } = require("./supplier-schedule");

function dayKey(parts) {
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function createXmlFetchDigestStore(root) {
  const file = path.join(root, ".runtime", "xml-fetch-digest.json");
  const maxDays = 14;

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : { days: {}, dismissedAlerts: [] };
    } catch (_) {
      return { days: {}, dismissedAlerts: [] };
    }
  }

  function write(data) {
    atomicWriteJson(
      file,
      Object.assign({ days: {}, dismissedAlerts: [] }, data, { updatedAt: new Date().toISOString() })
    );
  }

  function pruneDays(data) {
    const keys = Object.keys(data.days || {}).sort();
    while (keys.length > maxDays) {
      const drop = keys.shift();
      delete data.days[drop];
      data.dismissedAlerts = (data.dismissedAlerts || []).filter((row) => row !== drop);
    }
  }

  function recordAttempt(options) {
    const settings = options || {};
    const now = settings.at ? new Date(settings.at) : new Date();
    const key = dayKey(istanbulParts(now));
    const data = read();
    if (!data.days[key]) data.days[key] = { attempts: [] };
    const message = String(settings.error || "").slice(0, 240);
    data.days[key].attempts.push({
      slotId: String(settings.slotId || "supplier-1").slice(0, 32),
      dueKey: String(settings.dueKey || "").slice(0, 32),
      ok: Boolean(settings.ok),
      quota: Boolean(settings.quota) || isDailyQuotaError(message),
      error: message,
      at: now.toISOString(),
    });
    pruneDays(data);
    write(data);
    return data.days[key];
  }

  function previousDayKey(now) {
    const date = new Date((now || new Date()).getTime() - 24 * 60 * 60 * 1000);
    return dayKey(istanbulParts(date));
  }

  function summarizeDay(day) {
    if (!day || !Array.isArray(day.attempts) || !day.attempts.length) return null;
    const failures = day.attempts.filter((row) => !row.ok);
    if (!failures.length) return null;
    const quotaHits = failures.filter((row) => row.quota);
    const otherFails = failures.filter((row) => !row.quota);
    return {
      totalAttempts: day.attempts.length,
      failureCount: failures.length,
      quotaCount: quotaHits.length,
      otherFailureCount: otherFails.length,
      failures: failures.slice(0, 12).map((row) => ({
        slotId: row.slotId,
        dueKey: row.dueKey,
        quota: row.quota,
        error: row.error,
        at: row.at,
      })),
      headline:
        quotaHits.length && !otherFails.length
          ? "Dün XML kotası doldu; otomatik okumalar atlandı."
          : quotaHits.length
            ? "Dün XML okumalarında kota ve bağlantı sorunları vardı."
            : "Dün XML otomatik okumaları başarısız oldu.",
    };
  }

  function getYesterdayAlert(now) {
    const data = read();
    const key = previousDayKey(now);
    if ((data.dismissedAlerts || []).includes(key)) return null;
    const summary = summarizeDay(data.days[key]);
    if (!summary) return null;
    return Object.assign({ date: key }, summary);
  }

  function dismissAlert(dateKey) {
    const key = String(dateKey || "").slice(0, 16);
    if (!key) return;
    const data = read();
    const dismissed = new Set(data.dismissedAlerts || []);
    dismissed.add(key);
    data.dismissedAlerts = [...dismissed].slice(-maxDays);
    write(data);
  }

  return {
    recordAttempt,
    getYesterdayAlert,
    dismissAlert,
    summarizeDay,
    previousDayKey,
  };
}

module.exports = {
  createXmlFetchDigestStore,
};
