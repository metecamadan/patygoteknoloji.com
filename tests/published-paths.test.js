const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resetDbForTests } = require("../lib/db");
const { createPublishedPaths, normalizePath, productPathsFromAccessLog } = require("../lib/published-paths");

test("access log seeding keeps only product URLs served 200 under known segments", () => {
  const line = (method, url, status) =>
    `1.2.3.4 - - [26/Sep/2026:00:00:21 +0000] "${method} ${url} HTTP/1.1" ${status} 2342 "-" "Mozilla/5.0"`;
  const log = [
    line("GET", "/inkjet-kartus/epson-103-magenta?utm=x", 200),
    line("HEAD", "/notebook/hp-250", 200),
    line("GET", "/notebook/uydurma-adres", 301),
    line("GET", "/notebook/olmayan", 404),
    line("GET", "/urunler/bilgisayar-tablet", 200),
    line("GET", "/notebook/resim.jpg", 200),
    line("POST", "/notebook/form", 200),
    "bozuk satır",
  ].join("\n");
  assert.deepEqual(
    [...productPathsFromAccessLog(log, ["inkjet-kartus", "notebook"])].sort(),
    ["/inkjet-kartus/epson-103-magenta", "/notebook/hp-250"]
  );
});

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
