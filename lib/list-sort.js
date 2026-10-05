"use strict";

const collator = new Intl.Collator("tr", { numeric: true, sensitivity: "base" });

function isBlank(value) {
  return value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
}

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

function normalizeSort(sort, dir, allowedKeys) {
  const key = String(sort || "").trim();
  if (!key || !allowedKeys.includes(key)) return null;
  return { key, dir: String(dir || "").toLowerCase() === "desc" ? "desc" : "asc" };
}

// Stable sort; blank values stay at the bottom in both directions so "desc" never
// opens with a page of empty cells.
function sortRows(rows, valueOf, dir) {
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((x, y) => {
      const xBlank = isBlank(x.value);
      const yBlank = isBlank(y.value);
      if (xBlank || yBlank) return xBlank === yBlank ? x.index - y.index : xBlank ? 1 : -1;
      return sign * compareValues(x.value, y.value) || x.index - y.index;
    })
    .map((entry) => entry.row);
}

module.exports = { normalizeSort, sortRows };
