const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("./supplier");

const MAX_ENTRIES = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const TYPES = new Set(["reminder", "note"]);

function isoDate(value) {
  const text = String(value || "").trim();
  return DATE_RE.test(text) ? text : "";
}

function normalizeTime(value, type) {
  const text = String(value || "").trim();
  if (!text) return type === "reminder" ? null : null;
  if (!TIME_RE.test(text)) return null;
  const [h, m] = text.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return text;
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
        ? normalizeTime(input.time, type)
        : existing
          ? existing.time || null
          : null;
    const done =
      input && Object.prototype.hasOwnProperty.call(input, "done")
        ? Boolean(input.done)
        : existing
          ? Boolean(existing.done)
          : false;
    return { type, date, title, body, time, done };
  }

  function create(input) {
    const fields = normalizeEntry(input, null);
    const now = new Date().toISOString();
    const entry = Object.assign(
      {
        id: crypto.randomBytes(8).toString("hex"),
        createdAt: now,
        updatedAt: now,
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
    const next = Object.assign({}, current, fields, {
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
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

  return { list, create, update, remove, get, read };
}

module.exports = {
  createCalendarStore,
  isoDate,
  DATE_RE,
  TYPES,
};
