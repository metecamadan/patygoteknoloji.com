const TIMEZONE = "Europe/Istanbul";
const DEFAULT_START_MINUTE = 8 * 60;
const DEFAULT_INTERVAL_MINUTES = 180;
const SCHEDULE_END_MINUTE = 20 * 60;
const MAX_DAILY_PULLS = 16;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeScheduleConfig(input) {
  const settings = input || {};
  return {
    scheduleStartMinute: clampInt(
      settings.scheduleStartMinute,
      0,
      23 * 60 + 59,
      DEFAULT_START_MINUTE
    ),
    scheduleIntervalMinutes: clampInt(
      settings.scheduleIntervalMinutes,
      30,
      720,
      DEFAULT_INTERVAL_MINUTES
    ),
  };
}

function buildScheduleMinutes(startMinute, intervalMinutes) {
  const cfg = normalizeScheduleConfig({
    scheduleStartMinute: startMinute,
    scheduleIntervalMinutes: intervalMinutes,
  });
  const times = [];
  for (
    let t = cfg.scheduleStartMinute;
    t <= SCHEDULE_END_MINUTE;
    t += cfg.scheduleIntervalMinutes
  ) {
    times.push(t);
    if (times.length >= MAX_DAILY_PULLS) break;
  }
  if (!times.length) times.push(cfg.scheduleStartMinute);
  return times;
}

function minuteToLabel(minuteValue) {
  const hour = Math.floor(minuteValue / 60);
  const minute = minuteValue % 60;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function parseTimeInput(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DEFAULT_START_MINUTE;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return DEFAULT_START_MINUTE;
  }
  return hour * 60 + minute;
}

/** Default daily windows: 08:00 first, then every 180 minutes through 20:00. */
const SCHEDULE_MINUTES = buildScheduleMinutes(DEFAULT_START_MINUTE, DEFAULT_INTERVAL_MINUTES);

function istanbulParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function dayKey(parts) {
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function scheduleKey(parts, minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return (
    dayKey(parts) +
    " " +
    String(hour).padStart(2, "0") +
    ":" +
    String(minute).padStart(2, "0")
  );
}

function isDailyQuotaError(message) {
  return /g[uü]nl[uü]k\s+eri[sş]im|s[iı]n[iı]r[iı]n[iı]z a[sş]|kota|daily (access )?limit/i.test(
    String(message || "")
  );
}

function sameIstanbulDay(iso, now) {
  if (!iso) return false;
  const left = istanbulParts(new Date(iso));
  const right = istanbulParts(now || new Date());
  return dayKey(left) === dayKey(right);
}

function minuteOfDay(parts) {
  return parts.hour * 60 + parts.minute;
}

function findDueScheduleKey(now, scheduleMinutes) {
  const minutes = Array.isArray(scheduleMinutes) && scheduleMinutes.length
    ? scheduleMinutes
    : SCHEDULE_MINUTES;
  const parts = istanbulParts(now);
  const current = minuteOfDay(parts);
  for (const slotMinute of minutes) {
    if (current === slotMinute) {
      return scheduleKey(parts, slotMinute);
    }
  }
  return "";
}

function getNextScheduledAt(now, scheduleMinutes) {
  const minutes = Array.isArray(scheduleMinutes) && scheduleMinutes.length
    ? scheduleMinutes
    : SCHEDULE_MINUTES;
  const parts = istanbulParts(now);
  const current = minuteOfDay(parts);
  let nextMinute = minutes.find((value) => value > current);
  let dayOffset = 0;
  if (nextMinute === undefined) {
    nextMinute = minutes[0];
    dayOffset = 1;
  }
  const hour = Math.floor(nextMinute / 60);
  const minute = nextMinute % 60;
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() + dayOffset);
  const nextParts = istanbulParts(date);
  const labelDay = dayOffset ? nextParts : parts;
  return {
    key: scheduleKey(labelDay, nextMinute),
    label:
      labelDay.day +
      "." +
      labelDay.month +
      "." +
      labelDay.year +
      " " +
      String(hour).padStart(2, "0") +
      ":" +
      String(minute).padStart(2, "0"),
    timezone: TIMEZONE,
  };
}

function scheduleSummary(scheduleMinutes, intervalMinutes) {
  const minutes = Array.isArray(scheduleMinutes) && scheduleMinutes.length
    ? scheduleMinutes
    : SCHEDULE_MINUTES;
  const interval = Number(intervalMinutes) || DEFAULT_INTERVAL_MINUTES;
  const labels = minutes.map(minuteToLabel);
  return {
    timezone: TIMEZONE,
    intervalMinutes: interval,
    dailyPullCount: minutes.length,
    times: labels,
    summary:
      labels[0] +
      " – " +
      labels[labels.length - 1] +
      " (" +
      interval +
      " dk arayla, günde " +
      labels.length +
      " kez)",
  };
}

function createSupplierScheduler(options) {
  const settings = options || {};
  const manager = settings.manager;
  if (!manager || typeof manager.refresh !== "function") {
    throw new Error("Supplier scheduler için manager gerekli.");
  }
  const intervalMs = Number(settings.intervalMs) || 60 * 1000;
  const log = settings.log || console.log;
  const logError = settings.logError || console.error;
  let running = false;
  let timer = null;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const slots = manager.listSlots().filter((slot) => slot.configured);
      const now = new Date();
      for (const slot of slots) {
        const cfg = normalizeScheduleConfig(slot);
        const minutes = buildScheduleMinutes(cfg.scheduleStartMinute, cfg.scheduleIntervalMinutes);
        const dueKey = findDueScheduleKey(now, minutes);
        if (!dueKey) continue;
        if (slot.lastScheduledFetchKey === dueKey) continue;
        if (isDailyQuotaError(slot.lastError) && sameIstanbulDay(slot.lastFetchAt, new Date())) {
          log("XML günlük kota doldu, bugünkü kalan okuma atlandı:", slot.id, dueKey);
          if (typeof manager.markScheduledFetch === "function") {
            manager.markScheduledFetch(slot.id, dueKey);
          }
          continue;
        }
        if (sameIstanbulDay(slot.holdScheduledFetchesAt, now)) {
          log("XML otomatik okuma bugün durduruldu:", slot.id, dueKey);
          if (typeof manager.markScheduledFetch === "function") {
            manager.markScheduledFetch(slot.id, dueKey);
          }
          continue;
        }
        try {
          await manager.refresh(slot.id);
          log("XML otomatik senkron tamamlandı:", slot.id, dueKey);
        } catch (err) {
          logError(
            "XML otomatik senkron başarısız:",
            slot.id,
            dueKey,
            err && err.message ? err.message : err
          );
        } finally {
          if (typeof manager.markScheduledFetch === "function") {
            manager.markScheduledFetch(slot.id, dueKey);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      tick().catch((err) => logError("XML scheduler tick hatası:", err.message || err));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    setTimeout(() => {
      tick().catch((err) => logError("XML scheduler ilk tick hatası:", err.message || err));
    }, 12 * 1000);
  }

  return {
    TIMEZONE,
    SCHEDULE_MINUTES,
    findDueScheduleKey,
    getNextScheduledAt,
    scheduleSummary,
    tick,
    start,
  };
}

module.exports = {
  TIMEZONE,
  SCHEDULE_MINUTES,
  DEFAULT_START_MINUTE,
  DEFAULT_INTERVAL_MINUTES,
  istanbulParts,
  findDueScheduleKey,
  getNextScheduledAt,
  scheduleSummary,
  createSupplierScheduler,
  isDailyQuotaError,
  sameIstanbulDay,
  buildScheduleMinutes,
  normalizeScheduleConfig,
  parseTimeInput,
  minuteToLabel,
};
