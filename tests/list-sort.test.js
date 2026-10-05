const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSort, sortRows } = require("../lib/list-sort");

test("normalizeSort accepts only whitelisted keys and defaults dir to asc", () => {
  const keys = ["name", "stock"];
  assert.deepEqual(normalizeSort("name", "DESC", keys), { key: "name", dir: "desc" });
  assert.deepEqual(normalizeSort("stock", "bogus", keys), { key: "stock", dir: "asc" });
  assert.equal(normalizeSort("", "asc", keys), null);
  assert.equal(normalizeSort("__proto__", "asc", keys), null);
  assert.equal(normalizeSort("price; DROP TABLE", "asc", keys), null);
});

test("sortRows uses Turkish collation with numeric segments", () => {
  const rows = ["Üçüncü", "çanta", "Birinci", "İkinci", "ızgara", "Ürün 10", "Ürün 2"].map((name) => ({ name }));
  assert.deepEqual(
    sortRows(rows, (row) => row.name, "asc").map((row) => row.name),
    ["Birinci", "çanta", "ızgara", "İkinci", "Üçüncü", "Ürün 2", "Ürün 10"]
  );
});

test("sortRows keeps blanks last in both directions and is stable", () => {
  const rows = [
    { id: "a", stock: 5 },
    { id: "b", stock: null },
    { id: "c", stock: 0 },
    { id: "d", stock: 5 },
    { id: "e", stock: "" },
  ];
  assert.deepEqual(sortRows(rows, (row) => row.stock, "asc").map((row) => row.id), ["c", "a", "d", "b", "e"]);
  assert.deepEqual(sortRows(rows, (row) => row.stock, "desc").map((row) => row.id), ["a", "d", "c", "b", "e"]);
  assert.equal(rows[0].id, "a", "input array is not mutated");
});
