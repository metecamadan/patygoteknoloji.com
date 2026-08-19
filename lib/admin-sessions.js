"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

function createAdminSessionStore(root, options) {
  const opts = options || {};
  const idleMs =
    Number.isFinite(Number(opts.idleMs)) && Number(opts.idleMs) > 0
      ? Number(opts.idleMs)
      : 30 * 60 * 1000;
  const file = path.join(root, ".runtime", "admin-sessions.json");
  const sessions = new Map();
  let persistTimer = null;

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const exp = Number(raw.exp);
    if (!Number.isFinite(exp) || exp <= Date.now()) return null;
    return {
      exp,
      userId: raw.userId == null ? null : String(raw.userId),
      mustChangePassword: Boolean(raw.mustChangePassword),
    };
  }

  function load() {
    sessions.clear();
    try {
      if (!fs.existsSync(file)) return;
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!saved || typeof saved !== "object") return;
      for (const [token, raw] of Object.entries(saved)) {
        const entry = normalizeEntry(raw);
        if (entry) sessions.set(String(token), entry);
      }
    } catch (_) {}
  }

  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      const payload = {};
      const now = Date.now();
      for (const [token, raw] of sessions.entries()) {
        const entry = normalizeEntry(raw);
        if (!entry || entry.exp <= now) {
          sessions.delete(token);
          continue;
        }
        payload[token] = entry;
      }
      atomicWriteJson(file, payload);
    } catch (_) {}
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, 120);
    if (typeof persistTimer.unref === "function") persistTimer.unref();
  }

  function create(token, input) {
    const next = {
      exp: Date.now() + idleMs,
      userId: input && input.userId != null ? input.userId : null,
      mustChangePassword: Boolean(input && input.mustChangePassword),
    };
    sessions.set(String(token), next);
    persistNow();
    return next;
  }

  function remove(token) {
    if (!token) return;
    sessions.delete(String(token));
    persistNow();
  }

  function touch(token) {
    const raw = sessions.get(String(token));
    const entry = normalizeEntry(raw);
    if (!entry) {
      if (raw != null) sessions.delete(String(token));
      return null;
    }
    const next = Object.assign({}, entry, { exp: Date.now() + idleMs });
    sessions.set(String(token), next);
    schedulePersist();
    return next;
  }

  function get(token) {
    if (!token) return null;
    return touch(token);
  }

  function replace(token, next) {
    const entry = normalizeEntry(next);
    if (!entry) {
      remove(token);
      return null;
    }
    sessions.set(String(token), entry);
    persistNow();
    return entry;
  }

  load();

  return {
    idleMs,
    file,
    create,
    remove,
    get,
    replace,
    load,
    persistNow,
    size() {
      return sessions.size;
    },
  };
}

module.exports = {
  createAdminSessionStore,
};
