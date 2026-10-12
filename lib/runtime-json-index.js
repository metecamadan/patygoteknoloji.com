"use strict";

const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./supplier");

/**
 * `{ entries, meta }` file under .runtime shared by a worker process and the server.
 * File clocks tick in steps (~15 ms on Windows, ~4 ms on ext4), so two writes can keep
 * the same mtime: the cache key also uses the size, and this process's own writes go
 * straight into the cache with a fresh stamp.
 * A panel decision on disk always wins over an automatic result.
 */
function createRuntimeJsonIndex(indexFileFor) {
  let memo = { file: "", key: "", data: null };
  let localWrites = 0;

  function statKey(file) {
    const st = fs.statSync(file);
    return st.mtimeMs + ":" + st.size;
  }

  function read(dataRoot) {
    const file = indexFileFor(dataRoot);
    let key;
    try {
      key = statKey(file);
    } catch (_) {
      return { entries: {}, meta: {}, stamp: "0" };
    }
    if (memo.data && memo.file === file && memo.key === key) return memo.data;
    let data;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      data = {
        entries: raw && typeof raw.entries === "object" && raw.entries ? raw.entries : {},
        meta: raw && typeof raw.meta === "object" && raw.meta ? raw.meta : {},
      };
    } catch (_) {
      data = { entries: {}, meta: {} };
    }
    data.stamp = key + ":" + localWrites;
    memo = { file, key, data };
    return data;
  }

  function update(dataRoot, patch, meta) {
    const current = read(dataRoot);
    const entries = Object.assign({}, current.entries);
    for (const [file, next] of Object.entries(patch || {})) {
      const existing = entries[file];
      if (existing && existing.decidedBy === "panel" && !(next && next.decidedBy === "panel")) continue;
      entries[file] = next;
    }
    const nextMeta = Object.assign({}, current.meta, meta || {});
    const file = indexFileFor(dataRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWriteJson(file, { version: 1, updatedAt: new Date().toISOString(), meta: nextMeta, entries });
    localWrites += 1;
    const key = statKey(file);
    memo = { file, key, data: { entries, meta: nextMeta, stamp: key + ":" + localWrites } };
    return entries;
  }

  return { read, update };
}

module.exports = { createRuntimeJsonIndex };
