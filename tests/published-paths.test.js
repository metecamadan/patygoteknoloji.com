const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resetDbForTests } = require("../lib/db");
const { createPublishedPaths, normalizePath } = require("../lib/published-paths");

test("published product paths are kept across restarts and only product-shaped paths count", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-published-"));
  t.after(() => {
    resetDbForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(normalizePath("/Notebook/HP-250/"), "/notebook/hp-250");
  assert.equal(normalizePath("/urunler"), "", "tek seviye adres ürün adresi değildir");
  assert.equal(normalizePath("/a/b/c"), "");

  const first = createPublishedPaths(root);
  assert.equal(first.record(["/notebook/hp-250", "/notebook/hp-250", "", null, "/urunler"]), 1);
  assert.equal(first.has("/notebook/hp-250/"), true);
  assert.equal(first.has("/notebook/hic-olmayan"), false);

  resetDbForTests();
  const reopened = createPublishedPaths(root);
  assert.equal(reopened.has("/NOTEBOOK/hp-250"), true, "kayıt yeniden başlatmadan sonra da durur");
});
