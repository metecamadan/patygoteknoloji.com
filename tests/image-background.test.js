const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const bg = require("../lib/image-background");
const { mirrorPaths } = require("../lib/product-image-mirror");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/** Square product (light grey, so it is not "near white") on a solid backdrop. */
async function productOn(backdrop, file) {
  const product = await sharp({ create: { width: 60, height: 60, channels: 3, background: "#c8c8c8" } }).png().toBuffer();
  await sharp({ create: { width: 120, height: 120, channels: 3, background: backdrop } })
    .composite([{ input: product, left: 30, top: 30 }])
    .jpeg({ quality: 95 })
    .toFile(file);
}

/** Fake model: keeps pixels brighter than the backdrop, drops the rest. */
async function thresholdRemover(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let p = 0; p < info.width * info.height; p++) {
    const keep = data[p * 3] > 120;
    out[p * 4] = data[p * 3];
    out[p * 4 + 1] = data[p * 3 + 1];
    out[p * 4 + 2] = data[p * 3 + 2];
    out[p * 4 + 3] = keep ? 255 : 0;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Fake model that turns everything half transparent (the "ghost" failure seen on packaging). */
async function ghostRemover(png) {
  return sharp(png).ensureAlpha(0.5).png().toBuffer();
}

function tempDataRoot() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-bg-"));
  fs.mkdirSync(mirrorPaths(dataRoot).mediaDir, { recursive: true });
  return dataRoot;
}

test("acceptCutout: only crisp cut-outs of a real backdrop are used", () => {
  const good = { semi: 0.08, ringBackground: 0.95, foreground: 0.33, foreignRemoved: 0.05 };
  assert.equal(bg.acceptCutout(good), true);
  assert.equal(bg.acceptCutout(Object.assign({}, good, { semi: 0.84 })), false, "yarı saydam hayalet");
  assert.equal(bg.acceptCutout(Object.assign({}, good, { ringBackground: 0.4 })), false, "ürün kenara taşıyor");
  assert.equal(bg.acceptCutout(Object.assign({}, good, { foreground: 0.01 })), false, "ürün neredeyse silinmiş");
  assert.equal(bg.acceptCutout(Object.assign({}, good, { foreground: 0.9 })), false, "zemin yok sayılmış");
  assert.equal(bg.acceptCutout(Object.assign({}, good, { foreignRemoved: 0.4 })), false, "kutu/yazı silinmiş");
  assert.equal(
    bg.acceptCutout(Object.assign({}, good, { foreignRemoved: 0.134 })),
    false,
    "kahve paketinin mor üst kısmı silinmiş"
  );
  assert.equal(bg.acceptCutout(null), false);
});

test("borderProfile tells a light backdrop from a black one", async () => {
  const dataRoot = tempDataRoot();
  const dir = mirrorPaths(dataRoot).mediaDir;
  await productOn("#ffffff", path.join(dir, "w.jpg"));
  await productOn("#dcdcdc", path.join(dir, "g.jpg"));
  await productOn("#101010", path.join(dir, "b.jpg"));
  const w = await bg.borderProfile(sharp, path.join(dir, "w.jpg"));
  const g = await bg.borderProfile(sharp, path.join(dir, "g.jpg"));
  const b = await bg.borderProfile(sharp, path.join(dir, "b.jpg"));
  assert.ok(w.light >= bg.LIGHT_BORDER_MIN);
  assert.ok(g.white < 0.05 && g.light >= bg.LIGHT_BORDER_MIN, "açık gri zemin de açık sayılır");
  assert.ok(b.light < 0.05);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("processBackgrounds leaves pale grey backdrops alone (silver parts would be cut)", async () => {
  const dataRoot = tempDataRoot();
  const dir = mirrorPaths(dataRoot).mediaDir;
  const pale = "e".repeat(28) + ".jpg";
  await productOn("#dcdcdc", path.join(dir, pale));
  const mirrorIndex = {
    "https://cdn.example/p.jpg": { file: pale, publicPath: "/media/catalog/" + pale, placeholder: false },
  };
  let calls = 0;
  const result = await bg.processBackgrounds({
    dataRoot,
    sharp,
    removeBackground: async (png) => {
      calls += 1;
      return thresholdRemover(png);
    },
    mirrorIndex,
  });
  assert.equal(calls, 0, "açık zeminli görsel modele gönderilmez");
  assert.equal(result.white, 1);
  assert.equal(bg.loadBackgroundIndex(dataRoot)[pale].status, "white");
  assert.equal(bg.storefrontMirrorIndex(dataRoot, mirrorIndex)["https://cdn.example/p.jpg"].file, pale);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("processBackgrounds whitens dark backdrops, skips white ones, keeps originals and panel decisions", async () => {
  const dataRoot = tempDataRoot();
  const dir = mirrorPaths(dataRoot).mediaDir;
  const white = "a".repeat(28) + ".jpg";
  const dark = "b".repeat(28) + ".jpg";
  const ghost = "c".repeat(28) + ".jpg";
  await productOn("#ffffff", path.join(dir, white));
  await productOn("#101010", path.join(dir, dark));
  await productOn("#101010", path.join(dir, ghost));
  const darkBytes = fs.readFileSync(path.join(dir, dark));
  const mirrorIndex = {
    "https://cdn.example/w.jpg": { file: white, publicPath: "/media/catalog/" + white, placeholder: false },
    "https://cdn.example/d.jpg": { file: dark, publicPath: "/media/catalog/" + dark, placeholder: false },
    "https://cdn.example/g.jpg": { file: ghost, publicPath: "/media/catalog/" + ghost, placeholder: false },
  };
  let calls = 0;
  const remover = async (png) => {
    calls += 1;
    return calls === 2 ? ghostRemover(png) : thresholdRemover(png);
  };
  const thumbs = [];
  const result = await bg.processBackgrounds({
    dataRoot,
    sharp,
    removeBackground: remover,
    mirrorIndex,
    priority: [dark, ghost],
    onWhiteFile: async (_, name) => thumbs.push(name),
  });
  assert.deepEqual(
    { checked: result.checked, white: result.white, whitened: result.whitened, rejected: result.rejected, remaining: result.remaining },
    { checked: 3, white: 1, whitened: 1, rejected: 1, remaining: 0 }
  );
  assert.equal(calls, 2, "beyaz zeminli görsel modele gönderilmez");
  const entries = bg.loadBackgroundIndex(dataRoot);
  assert.equal(entries[white].status, "white");
  assert.equal(entries[dark].status, "whitened");
  assert.equal(entries[ghost].status, "rejected");
  assert.ok(entries[ghost].whiteFile, "reddedilen sonuç panelde önizleme olarak durur");
  assert.deepEqual(darkBytes, fs.readFileSync(path.join(dir, dark)), "orijinal dosyaya dokunulmaz");
  assert.notEqual(entries[dark].whiteFile, dark);
  assert.deepEqual(thumbs.sort(), [entries[dark].whiteFile, entries[ghost].whiteFile].sort());
  const whiteProfile = await bg.borderProfile(sharp, path.join(dir, entries[dark].whiteFile));
  assert.ok(whiteProfile.white >= 0.99, "zemin beyaz");

  const again = await bg.processBackgrounds({ dataRoot, sharp, removeBackground: remover, mirrorIndex });
  assert.equal(again.checked, 0, "işlenmiş görsel tekrar işlenmez");
  assert.equal(calls, 2);

  assert.equal(bg.setBackgroundDecision(dataRoot, dark, "original").ok, true);
  assert.equal(bg.setBackgroundDecision(dataRoot, ghost, "white").ok, true);
  assert.equal(bg.setBackgroundDecision(dataRoot, white, "white").ok, false, "beyaz sürümü olmayan seçilemez");
  // An automatic result written later (e.g. by a worker started before the click) must not undo the panel.
  bg.updateBackgroundIndex(dataRoot, { [dark]: { status: "whitened", version: 0, whiteFile: entries[dark].whiteFile } });
  // Threshold changes re-run automatic results only.
  bg.updateBackgroundIndex(dataRoot, { [white]: Object.assign({}, entries[white], { version: 0 }) });
  const rerun = await bg.processBackgrounds({ dataRoot, sharp, removeBackground: remover, mirrorIndex });
  assert.equal(rerun.checked, 1);
  const after = bg.loadBackgroundIndex(dataRoot);
  assert.equal(after[dark].status, "reverted");
  assert.equal(after[ghost].status, "whitened");
  assert.equal(after[ghost].decidedBy, "panel");
  assert.deepEqual(bg.backgroundCounts(dataRoot), { white: 1, whitened: 1, rejected: 0, reverted: 1, error: 0 });
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("processBackgrounds stops at the deadline and reports what is left", async () => {
  const dataRoot = tempDataRoot();
  const dir = mirrorPaths(dataRoot).mediaDir;
  const mirrorIndex = {};
  for (const ch of ["d", "e", "f"]) {
    const file = ch.repeat(28) + ".jpg";
    await productOn("#ffffff", path.join(dir, file));
    mirrorIndex["https://cdn.example/" + ch] = { file, publicPath: "/media/catalog/" + file };
  }
  let clock = 0;
  const result = await bg.processBackgrounds({
    dataRoot,
    sharp,
    removeBackground: thresholdRemover,
    mirrorIndex,
    now: () => (clock += 10),
    deadline: 35,
  });
  assert.equal(result.checked, 2);
  assert.equal(result.remaining, 1);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("a broken model stops the pass after 5 failures; failed images are retried next pass", async () => {
  const dataRoot = tempDataRoot();
  const dir = mirrorPaths(dataRoot).mediaDir;
  const mirrorIndex = {};
  for (let i = 0; i < 8; i++) {
    const file = String(i).repeat(28) + ".jpg";
    await productOn("#101010", path.join(dir, file));
    mirrorIndex["https://cdn.example/" + i] = { file, publicPath: "/media/catalog/" + file };
  }
  const broken = async () => {
    throw new Error("ENOENT resources.json");
  };
  await assert.rejects(
    bg.processBackgrounds({ dataRoot, sharp, removeBackground: broken, mirrorIndex }),
    /üst üste 5 görselde hata verdi: ENOENT resources\.json/
  );
  assert.equal(bg.backgroundCounts(dataRoot).error, 5, "durmadan önce yalnızca 5 hata yazılır");
  const fixed = await bg.processBackgrounds({ dataRoot, sharp, removeBackground: thresholdRemover, mirrorIndex });
  assert.equal(fixed.checked, 8, "hatalı görseller sonraki turda yeniden denenir");
  assert.equal(bg.backgroundCounts(dataRoot).error, 0);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("worker points the model at its own install, not the app root it is started from", () => {
  const worker = read("tools/image-bg/run.js");
  assert.match(worker, /path\.dirname\(require\.resolve\("@imgly\/background-removal-node"\)\)/);
  assert.match(worker, /publicPath: MODEL_PUBLIC_PATH/);
});

test("storefrontMirrorIndex swaps in white copies only while they are chosen and on disk", () => {
  const dataRoot = tempDataRoot();
  const dir = mirrorPaths(dataRoot).mediaDir;
  const a = "1".repeat(28) + ".jpg";
  const b = "2".repeat(28) + ".jpg";
  const aw = bg.whiteFileFor(a);
  fs.writeFileSync(path.join(dir, aw), "x");
  const mirrorIndex = {
    "https://cdn.example/a.jpg": { file: a, publicPath: "/media/catalog/" + a },
    "https://cdn.example/b.jpg": { file: b, publicPath: "/media/catalog/" + b },
  };
  assert.equal(bg.storefrontMirrorIndex(dataRoot, mirrorIndex), mirrorIndex, "kayıt yokken aynı nesne");
  bg.updateBackgroundIndex(dataRoot, {
    [a]: { status: "whitened", version: 1, whiteFile: aw },
    [b]: { status: "whitened", version: 1, whiteFile: bg.whiteFileFor(b) },
  });
  const view = bg.storefrontMirrorIndex(dataRoot, mirrorIndex);
  assert.equal(view["https://cdn.example/a.jpg"].publicPath, "/media/catalog/" + aw);
  assert.equal(view["https://cdn.example/a.jpg"].originalFile, a);
  assert.equal(view["https://cdn.example/b.jpg"].publicPath, "/media/catalog/" + b, "dosyası olmayan beyaz kullanılmaz");
  assert.equal(mirrorIndex["https://cdn.example/a.jpg"].publicPath, "/media/catalog/" + a, "asıl kayıt değişmez");
  bg.setBackgroundDecision(dataRoot, a, "original");
  assert.equal(bg.storefrontMirrorIndex(dataRoot, mirrorIndex)["https://cdn.example/a.jpg"].publicPath, "/media/catalog/" + a);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("card images come first; files map back to their products", () => {
  const mirrorIndex = {
    "https://cdn.example/1.jpg": { file: "f1.jpg" },
    "https://cdn.example/1_2.jpg": { file: "f2.jpg" },
    "https://cdn.example/2.jpg": { file: "f3.jpg" },
  };
  const products = [
    { id: "p1", images: ["https://cdn.example/1.jpg", "https://cdn.example/1_2.jpg"] },
    { id: "p2", image: "https://cdn.example/2.jpg" },
    { id: "p3", image: "https://cdn.example/1.jpg" },
  ];
  assert.deepEqual(bg.cardImageFiles(products, mirrorIndex, "https://site.example"), ["f1.jpg", "f3.jpg"]);
  const byFile = bg.productsByImageFile(products, mirrorIndex, "https://site.example");
  assert.deepEqual(byFile.get("f1.jpg").map((p) => p.id), ["p1", "p3"]);
  assert.deepEqual(bg.orderedMirrorFiles(mirrorIndex, ["f3.jpg"]), ["f3.jpg", "f1.jpg", "f2.jpg"]);
});

test("server: storefront, thumbnails and Akakçe read the white-background view; worker is optional", () => {
  const server = read("server.js");
  assert.match(server, /function catalogImageContext\(\) \{\s*const mirrorIndex = storefrontMirror\(\);/);
  assert.match(server, /function storefrontAkakceXml\(\) \{[\s\S]{0,120}const mirrorIndex = storefrontMirror\(\);/);
  assert.match(server, /generateMissingThumbnails\(DATA_ROOT, storefrontMirror\(\)/);
  assert.match(
    server,
    /return mirrorMtime \+ ":" \+ storefrontImageStamp\(DATA_ROOT\);/,
    "Akakçe XML önbelleği beyaz zemin ve resmî görsel değişiminde tazelenir"
  );
  assert.match(server, /function scheduleImageBackgroundRun[\s\S]{0,80}if \(!imageBackgroundToolInstalled\(\)\) return;/);
  assert.match(server, /\["-n", "19", process\.execPath/);
  const workflow = read(".github/workflows/ci-deploy.yml");
  assert.match(workflow, /ensure-image-bg-tool\.sh/);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!JSON.stringify(pkg).includes("background-removal"), "model ana projeye ve CI'a girmez");
});

test("admin: white-background images can be switched back to the original and the storefront follows", async (t) => {
  const password = "test-admin-password";
  const { baseUrl, dataRoot } = await spawnTestServer(t, { ADMIN_PASSWORD: password, SUPPLIER_ALLOWED_HOSTS: "supplier.example" });
  const { writeCachedRates } = require("../lib/fx");
  const runtime = path.join(dataRoot, ".runtime");
  const dir = mirrorPaths(dataRoot).mediaDir;
  fs.mkdirSync(dir, { recursive: true });
  const original = "9".repeat(28) + ".jpg";
  await productOn("#101010", path.join(dir, original));
  const whiteFile = bg.whiteFileFor(original);
  await productOn("#ffffff", path.join(dir, whiteFile));
  const imageUrl = "https://cdn.example/KAHVE-1.jpg";
  fs.writeFileSync(
    path.join(runtime, "catalog-image-mirror.json"),
    JSON.stringify({ version: 1, entries: { [imageUrl]: { sourceUrl: imageUrl, file: original, publicPath: "/media/catalog/" + original, placeholder: false } } })
  );
  bg.updateBackgroundIndex(dataRoot, { [original]: { status: "whitened", version: bg.PIPELINE_VERSION, at: new Date().toISOString(), whiteFile } });
  fs.writeFileSync(
    path.join(runtime, "supplier-cache.json"),
    JSON.stringify([
      {
        supplierSku: "KAHVE-1",
        id: "sup-kahve-1",
        name: "Ethiopian Filtre Kahve 250 Gr",
        brand: "M.EFENDI",
        costPrice: 70,
        stockQty: 5,
        image: imageUrl,
        barcode: "8690000000001",
        manufacturerCode: "MK-1",
        mainCategory: "OEM &amp; ÇEVRE BİRİMLERİ",
        midCategory: "İşlemciler",
        subCategory: "Intel İşlemciler",
        currency: "USD",
        vatPercent: 20,
        unit: "ADET",
        category: "bilgisayar",
      },
    ])
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({ globalMarginPercent: 15, lastFetchStatus: "ok", lastSuccessfulFetchAt: new Date().toISOString(), itemCount: 1 })
  );
  writeCachedRates(dataRoot, { USD: 40, EUR: 46, fetchedAt: new Date().toISOString(), source: "test" });
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const headers = { Authorization: "Bearer " + (await login.json()).token, "Content-Type": "application/json" };
  const published = await fetch(baseUrl + "/api/admin/supplier/publish", {
    method: "POST",
    headers,
    body: JSON.stringify({ slotId: "supplier-1" }),
  });
  assert.equal(published.status, 200);

  const imageOf = async () => {
    const body = await (await fetch(baseUrl + "/api/products?ids=sup-kahve-1")).json();
    return String((body.products[0] || {}).image || "");
  };
  assert.ok((await imageOf()).endsWith("/media/catalog/" + whiteFile), "vitrin beyaz zeminli kopyayı gösterir");

  assert.equal((await fetch(baseUrl + "/api/admin/image-backgrounds")).status, 401, "liste yalnızca panelde");
  const list = await (await fetch(baseUrl + "/api/admin/image-backgrounds?status=whitened", { headers })).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].file, original);
  assert.equal(list.items[0].white, "/media/catalog/" + whiteFile);
  assert.equal(list.items[0].products[0].name, "Ethiopian Filtre Kahve 250 Gr");
  assert.equal(list.tool.installed, false, "testte araç kurulu değil; panel bunu açıkça söyler");

  const bad = await fetch(baseUrl + "/api/admin/image-backgrounds/decision", {
    method: "POST",
    headers,
    body: JSON.stringify({ file: "../../.env", use: "original" }),
  });
  assert.equal(bad.status, 422);
  const reverted = await fetch(baseUrl + "/api/admin/image-backgrounds/decision", {
    method: "POST",
    headers,
    body: JSON.stringify({ file: original, use: "original" }),
  });
  assert.equal(reverted.status, 200);
  assert.equal((await reverted.json()).status, "reverted");
  assert.ok((await imageOf()).endsWith("/media/catalog/" + original), "orijinale dönünce vitrin orijinali gösterir");
  const revertedList = await (await fetch(baseUrl + "/api/admin/image-backgrounds?status=reverted", { headers })).json();
  assert.equal(revertedList.total, 1);
});

test("admin panel: white-background tab sits under Ürünler", () => {
  const html = read("admin.html");
  assert.match(html, /data-admin-tab="whitebg">Beyaz Zemin Görselleri</);
  assert.match(html, /id="adminTabWhiteBg"/);
  const js = read("assets/js/admin-panel.js");
  assert.match(js, /PRODUCTS_GROUP_TABS = new Set\(\[[^\]]*"whitebg"/);
  assert.match(js, /\/api\/admin\/image-backgrounds\/decision/);
});
