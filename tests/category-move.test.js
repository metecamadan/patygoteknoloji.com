const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MOVED_PARENTS, movedCategoryPath, REQUIRED_PARENT_SLUGS } = require("../lib/site-category-schema");
const { categoryQueryToPath } = require("../lib/categories");
const { createMultiSupplierManager } = require("../lib/multi-supplier");

const root = path.resolve(__dirname, "..");

test("KARTUŞ TONER is folded into BASKI ÇÖZÜMLERİ and no longer a required parent", () => {
  assert.deepEqual(MOVED_PARENTS["kartus-toner"], {
    into: "baski-cozumleri",
    landingMid: "yazici-tuketim-urunleri-orj",
  });
  assert.equal(REQUIRED_PARENT_SLUGS.includes("kartus-toner"), false);
});

test("movedCategoryPath maps every depth of a moved parent and ignores other paths", () => {
  assert.equal(movedCategoryPath("/urunler/kartus-toner"), "/urunler/baski-cozumleri/yazici-tuketim-urunleri-orj");
  assert.equal(movedCategoryPath("/urunler/kartus-toner/"), "/urunler/baski-cozumleri/yazici-tuketim-urunleri-orj");
  assert.equal(
    movedCategoryPath("/urunler/kartus-toner/fotokopi-tuketim"),
    "/urunler/baski-cozumleri/fotokopi-tuketim"
  );
  assert.equal(
    movedCategoryPath("/urunler/kartus-toner/faks-tuketim-urunleri/faks-tonerler"),
    "/urunler/baski-cozumleri/faks-tuketim-urunleri/faks-tonerler"
  );
  assert.equal(movedCategoryPath("/urunler/baski-cozumleri"), null);
  assert.equal(movedCategoryPath("/urunler/kartus-toner/a/b/c"), null);
  assert.equal(movedCategoryPath("/kartus-toner/hp-85a"), null);
});

test("legacy ?kategori=kartus-toner query lands on the moved path", () => {
  const q = (s) => categoryQueryToPath(new URLSearchParams(s));
  assert.equal(q("kategori=kartus-toner"), "/urunler/baski-cozumleri/yazici-tuketim-urunleri-orj");
  assert.equal(
    q("kategori=kartus-toner&ara=yazici-tuketim-urunleri-muadil"),
    "/urunler/baski-cozumleri/yazici-tuketim-urunleri-muadil"
  );
  assert.equal(q("kategori=bilgisayar-tablet&alt=notebook"), "/urunler/bilgisayar-tablet/notebook");
});

test("moveSiteParents rewrites only the parent slug and keeps panel choices", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-move-parent-"));
  try {
    const runtime = path.join(dir, ".runtime");
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(
      path.join(runtime, "supplier-overrides.json"),
      JSON.stringify({
        T1: { siteParent: "kartus-toner", siteMid: "yazici-tuketim-urunleri-orj", siteChild: "laser-tonerler", active: true },
        T2: {
          siteParent: "kartus-toner",
          siteMid: "fotokopi-tuketim",
          siteChild: "fotokopi-tonerler",
          siteCategoryManual: true,
          deactivated: true,
        },
        P1: { siteParent: "baski-cozumleri", siteMid: "yazici-tarayici", siteChild: "mono-laser" },
        N1: { marginPercent: 5 },
      })
    );
    const manager = createMultiSupplierManager(dir, {
      allowedHosts: ["supplier.example"],
      slots: [{ id: "supplier-1" }, { id: "supplier-2" }],
    });
    assert.deepEqual(manager.moveSiteParents(MOVED_PARENTS), { "supplier-1": 2 });
    const saved = JSON.parse(fs.readFileSync(path.join(runtime, "supplier-overrides.json"), "utf8"));
    assert.deepEqual(saved.T1, {
      siteParent: "baski-cozumleri",
      siteMid: "yazici-tuketim-urunleri-orj",
      siteChild: "laser-tonerler",
      active: true,
    });
    assert.equal(saved.T2.siteParent, "baski-cozumleri");
    assert.equal(saved.T2.siteCategoryManual, true);
    assert.equal(saved.T2.deactivated, true);
    assert.deepEqual(saved.P1, { siteParent: "baski-cozumleri", siteMid: "yazici-tarayici", siteChild: "mono-laser" });
    assert.deepEqual(saved.N1, { marginPercent: 5 });
    assert.deepEqual(manager.moveSiteParents(MOVED_PARENTS), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("server migrates placements at startup and storefront JS mirrors the moved parent", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /supplierManager\.moveSiteParents\(MOVED_PARENTS\)/);
  assert.match(server, /movedCategoryPath\(saved\[segment\]\)/);
  const js = fs.readFileSync(path.join(root, "assets", "js", "catalog.js"), "utf8");
  assert.match(
    js,
    /"kartus-toner": \{ into: "baski-cozumleri", landingMid: "yazici-tuketim-urunleri-orj" \}/
  );
  assert.doesNotMatch(js, /FEATURED_PARENTS = \[[^\]]*kartus-toner/);
});
