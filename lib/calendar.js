const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("./supplier");

const MAX_ENTRIES = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const TYPES = new Set(["reminder", "note"]);
const DEFAULT_REMINDER_TIME = "09:00";
const TIMEZONE = "Europe/Istanbul";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isoDate(value) {
  const text = String(value || "").trim();
  return DATE_RE.test(text) ? text : "";
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!TIME_RE.test(text)) return null;
  const [h, m] = text.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return text;
}

function clockInTimezone(nowDate, timeZone) {
  const date = nowDate instanceof Date ? nowDate : new Date(nowDate);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const minute = Number(parts.minute);
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    time: String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"),
    minutes: hour * 60 + minute,
  };
}

function reminderSchedule(entry) {
  const date = isoDate(entry && entry.date);
  if (!date) return null;
  const time = normalizeTime(entry && entry.time) || DEFAULT_REMINDER_TIME;
  const [h, m] = time.split(":").map(Number);
  return { date, time, minutes: h * 60 + m };
}

function isReminderDue(entry, nowDate, windowMinutes) {
  if (!entry || entry.type !== "reminder" || entry.done) return false;
  if (entry.emailNotifiedAt) return false;
  const schedule = reminderSchedule(entry);
  if (!schedule) return false;
  const clock = clockInTimezone(nowDate, TIMEZONE);
  if (clock.date !== schedule.date) return false;
  const window = Math.max(1, Number(windowMinutes) || 15);
  return clock.minutes >= schedule.minutes && clock.minutes < schedule.minutes + window;
}

function isReminderDueForBrowser(entry, nowDate, windowMinutes) {
  if (!entry || entry.type !== "reminder" || entry.done) return false;
  const schedule = reminderSchedule(entry);
  if (!schedule) return false;
  const clock = clockInTimezone(nowDate, TIMEZONE);
  if (clock.date !== schedule.date) return false;
  const window = Math.max(1, Number(windowMinutes) || 2);
  return clock.minutes >= schedule.minutes && clock.minutes < schedule.minutes + window;
}

function createCalendarStore(root) {
  const file = path.join(root, ".runtime", "calendar.json");

  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && value.entries && typeof value.entries === "object") return value;
    } catch (_) {}
    return { version: 1, entries: {} };
  }

  function write(value) {
    const ids = Object.keys(value.entries || {});
    if (ids.length > MAX_ENTRIES) {
      const sorted = ids
        .map((id) => ({ id, at: value.entries[id].updatedAt || value.entries[id].createdAt || "" }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const keep = new Set(sorted.slice(0, MAX_ENTRIES).map((row) => row.id));
      const next = {};
      for (const id of keep) next[id] = value.entries[id];
      value.entries = next;
    }
    atomicWriteJson(file, value);
  }

  function list(from, to) {
    const start = isoDate(from);
    const end = isoDate(to);
    const entries = Object.values(read().entries || {});
    return entries
      .filter((entry) => {
        const date = String(entry.date || "");
        if (!DATE_RE.test(date)) return false;
        if (start && date < start) return false;
        if (end && date > end) return false;
        return true;
      })
      .sort((a, b) => {
        const dateCmp = String(a.date).localeCompare(String(b.date));
        if (dateCmp) return dateCmp;
        return String(a.time || "").localeCompare(String(b.time || ""));
      });
  }

  function normalizeEntry(input, existing) {
    const type = TYPES.has(input && input.type) ? input.type : existing && existing.type;
    if (!TYPES.has(type)) throw new Error("Tür reminder veya note olmalı.");
    const date = isoDate(input && input.date) || (existing && existing.date);
    if (!date) throw new Error("Geçerli bir tarih gerekli (YYYY-MM-DD).");
    const title = String((input && input.title) != null ? input.title : (existing && existing.title) || "")
      .trim()
      .slice(0, 160);
    if (!title) throw new Error("Başlık gerekli.");
    const body = String((input && input.body) != null ? input.body : (existing && existing.body) || "")
      .trim()
      .slice(0, 4000);
    const time =
      input && Object.prototype.hasOwnProperty.call(input, "time")
        ? normalizeTime(input.time)
        : existing
          ? existing.time || null
          : null;
    const done =
      input && Object.prototype.hasOwnProperty.call(input, "done")
        ? Boolean(input.done)
        : existing
          ? Boolean(existing.done)
          : false;
    let notifyEmail = null;
    if (type === "reminder") {
      const raw =
        input && Object.prototype.hasOwnProperty.call(input, "notifyEmail")
          ? input.notifyEmail
          : existing
            ? existing.notifyEmail
            : "";
      notifyEmail = String(raw || "")
        .trim()
        .toLowerCase()
        .slice(0, 160);
      if (!EMAIL_RE.test(notifyEmail)) {
        throw new Error("Hatırlatıcı için geçerli bir e-posta gerekli.");
      }
    } else if (input && Object.prototype.hasOwnProperty.call(input, "notifyEmail") && input.notifyEmail) {
      notifyEmail = String(input.notifyEmail)
        .trim()
        .toLowerCase()
        .slice(0, 160);
      if (notifyEmail && !EMAIL_RE.test(notifyEmail)) {
        throw new Error("Geçerli bir e-posta gerekli.");
      }
      if (!notifyEmail) notifyEmail = null;
    } else if (existing && existing.notifyEmail) {
      notifyEmail = existing.notifyEmail;
    }
    return { type, date, title, body, time, done, notifyEmail };
  }

  function create(input) {
    const fields = normalizeEntry(input, null);
    const now = new Date().toISOString();
    const entry = Object.assign(
      {
        id: crypto.randomBytes(8).toString("hex"),
        createdAt: now,
        updatedAt: now,
        emailNotifiedAt: null,
      },
      fields
    );
    const data = read();
    data.entries[entry.id] = entry;
    write(data);
    return entry;
  }

  function update(id, patch) {
    const key = String(id || "");
    const data = read();
    const current = data.entries[key];
    if (!current) return null;
    const fields = normalizeEntry(Object.assign({}, current, patch || {}), current);
    const scheduleChanged =
      fields.date !== current.date || String(fields.time || "") !== String(current.time || "");
    const next = Object.assign({}, current, fields, {
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      emailNotifiedAt: scheduleChanged ? null : current.emailNotifiedAt || null,
    });
    if (patch && Object.prototype.hasOwnProperty.call(patch, "emailNotifiedAt")) {
      next.emailNotifiedAt = patch.emailNotifiedAt;
    }
    data.entries[next.id] = next;
    write(data);
    return next;
  }

  function remove(id) {
    const key = String(id || "");
    const data = read();
    if (!data.entries[key]) return false;
    delete data.entries[key];
    write(data);
    return true;
  }

  function get(id) {
    return read().entries[String(id || "")] || null;
  }

  function dueForEmail(nowDate, windowMinutes) {
    return Object.values(read().entries || {}).filter((entry) =>
      isReminderDue(entry, nowDate, windowMinutes)
    );
  }

  function markEmailNotified(id, at) {
    const key = String(id || "");
    const data = read();
    const current = data.entries[key];
    if (!current) return null;
    const next = Object.assign({}, current, {
      emailNotifiedAt: at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    data.entries[key] = next;
    write(data);
    return next;
  }

  return {
    list,
    create,
    update,
    remove,
    get,
    read,
    dueForEmail,
    markEmailNotified,
  };
}

module.exports = {
  createCalendarStore,
  isoDate,
  DATE_RE,
  TYPES,
  DEFAULT_REMINDER_TIME,
  TIMEZONE,
  clockInTimezone,
  reminderSchedule,
  isReminderDue,
  isReminderDueForBrowser,
};
