const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const bg = require("../lib/image-background");
const off = require("../lib/official-images");
const { mirrorPaths } = require("../lib/product-image-mirror");
const { spawnTestServer } = require("./helpers/spawn-server");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const SITE = "https://patygoteknoloji.com";

async function picture(backdrop, size) {
  const side = size || 600;
  const product = await sharp({ create: { width: side / 2, height: side / 2, channels: 3, background: "#8a5a2b" } }).png().toBuffer();
  return sharp({ create: { width: side, height: side, channels: 3, background: backdrop } })
    .composite([{ input: product, left: side / 4, top: side / 4 }])
    .png()
    .toBuffer();
}

function tempDataRoot() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-official-"));
  fs.mkdirSync(mirrorPaths(dataRoot).mediaDir, { recursive: true });
  return dataRoot;
}

function mirrorEntry(file) {
  return { file, publicPath: "/media/catalog/" + file, placeholder: false };
}

/** Fake network: maps URL prefixes to responses and records every request. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    for (const [prefix, respond] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return respond(String(url));
    }
    return new Response("not found", { status: 404 });
  };
  impl.calls = calls;
  return impl;
}

const imageResponse = (buf) => () => new Response(buf, { status: 200, headers: { "content-type": "image/png" } });

/** Dark card image A (coffee), dark image B shared by two models, dark gallery-only image C, white card D. */
async function catalogFixture(dataRoot) {
  const dir = mirrorPaths(dataRoot).mediaDir;
  const files = { a: "a".repeat(28) + ".jpg", b: "b".repeat(28) + ".jpg", c: "c".repeat(28) + ".jpg", d: "d".repeat(28) + ".jpg" };
  for (const key of ["a", "b", "c"]) fs.writeFileSync(path.join(dir, files[key]), await picture("#101010"));
  fs.writeFileSync(path.join(dir, files.d), await picture("#ffffff"));
  const mirrorIndex = {
    "https://img.example/a.jpg": mirrorEntry(files.a),
    "https://img.example/b.jpg": mirrorEntry(files.b),
    "https://img.example/c.jpg": mirrorEntry(files.c),
    "https://img.example/d.jpg": mirrorEntry(files.d),
  };
  bg.updateBackgroundIndex(dataRoot, {
    [files.a]: { status: "rejected", version: bg.PIPELINE_VERSION },
    [files.b]: { status: "rejected", version: bg.PIPELINE_VERSION },
    [files.c]: { status: "rejected", version: bg.PIPELINE_VERSION },
    [files.d]: { status: "white", version: bg.PIPELINE_VERSION },
  });
  const products = [
    { supplierSku: "KAHVE-1", brand: "M.EFENDİ", manufacturerCode: "KAHVE-1", barcode: "8690627001034", image: "https://img.example/a.jpg" },
    { supplierSku: "RADYO-1", brand: "EVERTON", manufacturerCode: "RT-1", barcode: "", image: "https://img.example/b.jpg" },
    { supplierSku: "RADYO-2", brand: "EVERTON", manufacturerCode: "RT-2", barcode: "", images: ["https://img.example/d.jpg", "https://img.example/b.jpg"] },
    { supplierSku: "TONER-1", brand: "HP", manufacturerCode: "CF283A", barcode: "0886111111111", images: ["https://img.example/d.jpg", "https://img.example/c.jpg"] },
  ];
  return { files, mirrorIndex, products };
}

const coffeeSource = {
  supplierSku: "KAHVE-1",
  barcode: "8690627001034",
  pageUrl: "https://maker.example/ethiopia",
  imageUrl: "https://maker.example/ethiopia.png",
};

test("officialTargets: only dark card images, and a picture shared by two models is held back", async () => {
  const dataRoot = tempDataRoot();
  const { files, mirrorIndex, products } = await catalogFixture(dataRoot);
  const targets = off.officialTargets({
    products,
    mirrorIndex,
    siteBaseUrl: SITE,
    backgroundEntries: bg.loadBackgroundIndex(dataRoot),
  });
  const byFile = Object.fromEntries(targets.map((t) => [t.file, t]));
  assert.deepEqual(Object.keys(byFile).sort(), [files.a, files.b].sort(), "galerideki koyu görsel ve beyaz kart hedef değil");
  assert.equal(byFile[files.a].shared, false);
  assert.equal(byFile[files.b].shared, true, "RT-1 ve RT-2 aynı görseli kullanıyor");
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("manualCandidate: a changed barcode cancels the hand-checked match", () => {
  const product = { supplierSku: "KAHVE-1", barcode: "8690627001034" };
  assert.equal(off.manualCandidate(product, [coffeeSource]).imageUrl, coffeeSource.imageUrl);
  assert.equal(off.manualCandidate({ supplierSku: "KAHVE-1", barcode: "8690000000000" }, [coffeeSource]), null);
  assert.equal(off.manualCandidate({ supplierSku: "BASKA" }, [coffeeSource]), null);
  assert.equal(off.manualCandidate({ supplierSku: "KAHVE-1", supplierSlot: "supplier-2" }, [coffeeSource]), null, "başka tedarikçi slotu");
});

test("pickIcecatImage prefers the main picture", () => {
  assert.equal(off.pickIcecatImage([{ Pic: "https://x/1.jpg" }, { Pic: "https://x/2.jpg", IsMain: "Y" }]), "https://x/2.jpg");
  assert.equal(off.pickIcecatImage([{ Pic500x500: "https://x/3.jpg" }]), "https://x/3.jpg");
  assert.equal(off.pickIcecatImage([]), "");
});

test("processOfficialImages applies the verified picture, skips shared ones and keeps the original file", async () => {
  const dataRoot = tempDataRoot();
  const { files, mirrorIndex, products } = await catalogFixture(dataRoot);
  const originalBytes = fs.readFileSync(path.join(mirrorPaths(dataRoot).mediaDir, files.a));
  const fetchImpl = fakeFetch({ "https://maker.example/ethiopia.png": imageResponse(await picture("#ffffff")) });
  const run = (extra) =>
    off.processOfficialImages(
      Object.assign(
        { dataRoot, sharp, fetch: fetchImpl, products, mirrorIndex, siteBaseUrl: SITE, manualSources: [coffeeSource], pause: async () => {} },
        extra
      )
    );
  const result = await run();
  assert.deepEqual(
    { checked: result.checked, applied: result.applied, skipped: result.skipped, notFound: result.notFound },
    { checked: 2, applied: 1, skipped: 1, notFound: 0 }
  );
  assert.deepEqual(fetchImpl.calls, [coffeeSource.imageUrl], "Icecat kullanıcı adı yokken Icecat'e gidilmez");
  const entries = off.loadOfficialIndex(dataRoot);
  assert.equal(entries[files.a].status, "applied");
  assert.equal(entries[files.a].source, "manufacturer");
  assert.equal(entries[files.a].pageUrl, coffeeSource.pageUrl);
  assert.equal(entries[files.b].status, "skipped");
  const officialPath = path.join(mirrorPaths(dataRoot).mediaDir, entries[files.a].officialFile);
  assert.ok((await bg.borderProfile(sharp, officialPath)).light >= 0.99, "resmî görsel beyaz zeminli kaydedilir");
  assert.deepEqual(fs.readFileSync(path.join(mirrorPaths(dataRoot).mediaDir, files.a)), originalBytes, "orijinal dosyaya dokunulmaz");

  const again = await run();
  assert.equal(again.checked, 0, "uygulanmış ve ortak görsel her turda yeniden aranmaz");
  assert.equal(fetchImpl.calls.length, 1);

  const view = off.storefrontImageIndex(dataRoot, mirrorIndex);
  assert.equal(view["https://img.example/a.jpg"].file, entries[files.a].officialFile);
  assert.equal(view["https://img.example/a.jpg"].originalFile, files.a);
  assert.equal(view["https://img.example/b.jpg"].file, files.b);

  assert.equal(off.setOfficialDecision(dataRoot, files.a, "original").ok, true);
  assert.equal(off.storefrontImageIndex(dataRoot, mirrorIndex)["https://img.example/a.jpg"].file, files.a, "panel orijinale döndürür");
  // A later automatic pass must not undo the panel.
  const later = await run({ manualSources: [Object.assign({}, coffeeSource, { imageUrl: "https://maker.example/new.png" })] });
  assert.equal(later.applied, 0);
  assert.equal(off.loadOfficialIndex(dataRoot)[files.a].status, "reverted");
  assert.equal(off.setOfficialDecision(dataRoot, files.a, "official").ok, true);
  assert.equal(off.setOfficialDecision(dataRoot, files.a, "maybe").ok, false);
  assert.deepEqual(off.officialCounts(dataRoot), { applied: 1, notfound: 0, skipped: 1, reverted: 0, error: 0 });
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("processOfficialImages: Icecat by barcode, dark official pictures refused, not-found retried after two weeks", async () => {
  const dataRoot = tempDataRoot();
  const { files, mirrorIndex } = await catalogFixture(dataRoot);
  const products = [
    { supplierSku: "TONER-1", brand: "HP", manufacturerCode: "CF283A", barcode: "0886111111111", image: "https://img.example/a.jpg" },
    { supplierSku: "PIL-1", brand: "GP", manufacturerCode: "GP-1", barcode: "", image: "https://img.example/c.jpg" },
  ];
  const icecatJson = (gallery) => () =>
    new Response(JSON.stringify({ msg: "OK", data: { GeneralInfo: { IcecatId: 42 }, Gallery: gallery } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  let clock = Date.parse("2026-10-12T10:00:00Z");
  const fetchImpl = fakeFetch({
    "https://live.icecat.biz/api?lang=EN&shopname=patygo&content=gallery&GTIN=0886111111111": icecatJson([{ Pic: "https://images.icecat.biz/main.png", IsMain: "Y" }]),
    "https://live.icecat.biz/api?": icecatJson([]),
    "https://images.icecat.biz/main.png": imageResponse(await picture("#ffffff")),
  });
  const run = () =>
    off.processOfficialImages({
      dataRoot,
      sharp,
      fetch: fetchImpl,
      products,
      mirrorIndex,
      siteBaseUrl: SITE,
      manualSources: [],
      icecatUsername: "patygo",
      pause: async () => {},
      now: () => clock,
    });
  const first = await run();
  assert.equal(first.applied, 1);
  assert.equal(first.notFound, 1);
  const entries = off.loadOfficialIndex(dataRoot);
  assert.equal(entries[files.a].source, "icecat");
  assert.equal(entries[files.a].pageUrl, "https://icecat.biz/p/product/42");
  assert.equal(entries[files.c].status, "notfound");
  assert.ok(fetchImpl.calls.some((u) => u.includes("Brand=GP") && u.includes("ProductCode=GP-1")), "barkod yoksa marka + kod");

  clock += 24 * 60 * 60 * 1000;
  assert.equal((await run()).checked, 0, "bulunamayan ürün ertesi gün tekrar sorulmaz");
  clock += 14 * 24 * 60 * 60 * 1000;
  assert.equal((await run()).checked, 1, "iki hafta sonra tekrar sorulur");

  const darkRoot = tempDataRoot();
  const dark = await catalogFixture(darkRoot);
  const darkFetch = fakeFetch({ "https://maker.example/ethiopia.png": imageResponse(await picture("#111111")) });
  const refused = await off.processOfficialImages({
    dataRoot: darkRoot,
    sharp,
    fetch: darkFetch,
    products: dark.products.slice(0, 1),
    mirrorIndex: dark.mirrorIndex,
    siteBaseUrl: SITE,
    manualSources: [coffeeSource],
    pause: async () => {},
  });
  assert.equal(refused.failed, 1);
  assert.match(off.loadOfficialIndex(darkRoot)[dark.files.a].error, /zemini de koyu/);
  assert.equal(off.storefrontImageIndex(darkRoot, dark.mirrorIndex)["https://img.example/a.jpg"].file, dark.files.a);
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.rmSync(darkRoot, { recursive: true, force: true });
});

test("processOfficialImages: switching Icecat on re-asks not-found products at once", async () => {
  const dataRoot = tempDataRoot();
  const { files, mirrorIndex } = await catalogFixture(dataRoot);
  const products = [{ supplierSku: "TONER-1", brand: "HP", manufacturerCode: "CF283A", barcode: "0886111111111", image: "https://img.example/a.jpg" }];
  const fetchImpl = fakeFetch({
    "https://live.icecat.biz/api?": () =>
      new Response(JSON.stringify({ msg: "OK", data: { GeneralInfo: { IcecatId: 7 }, Gallery: [{ Pic: "https://images.icecat.biz/t.png" }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    "https://images.icecat.biz/t.png": imageResponse(await picture("#ffffff")),
  });
  const run = (icecatUsername) =>
    off.processOfficialImages({ dataRoot, sharp, fetch: fetchImpl, products, mirrorIndex, siteBaseUrl: SITE, manualSources: [], icecatUsername, pause: async () => {} });

  assert.equal((await run("")).notFound, 1);
  assert.equal((await run("")).checked, 0, "kaynak değişmeden tekrar sorulmaz");
  const withIcecat = await run("patygo");
  assert.equal(withIcecat.applied, 1, "Icecat açılınca iki hafta beklenmez");
  assert.equal(off.loadOfficialIndex(dataRoot)[files.a].source, "icecat");
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("storefrontImageIndex: an explicit white-background choice in the panel outranks an automatic official picture", async () => {
  const dataRoot = tempDataRoot();
  const { files, mirrorIndex } = await catalogFixture(dataRoot);
  const officialFile = off.officialFileFor(files.a, "https://maker.example/x.png");
  fs.writeFileSync(path.join(mirrorPaths(dataRoot).mediaDir, officialFile), await picture("#ffffff"));
  off.updateOfficialIndex(dataRoot, { [files.a]: { status: "applied", version: off.PIPELINE_VERSION, officialFile } });
  assert.equal(off.storefrontImageIndex(dataRoot, mirrorIndex)["https://img.example/a.jpg"].file, officialFile);
  bg.updateBackgroundIndex(dataRoot, { [files.a]: { status: "reverted", version: bg.PIPELINE_VERSION, decidedBy: "panel" } });
  assert.equal(off.storefrontImageIndex(dataRoot, mirrorIndex)["https://img.example/a.jpg"].file, files.a);
  bg.updateBackgroundIndex(dataRoot, { [files.a]: { status: "rejected", version: bg.PIPELINE_VERSION, decidedBy: "panel" } });
  fs.unlinkSync(path.join(mirrorPaths(dataRoot).mediaDir, officialFile));
  off.updateOfficialIndex(dataRoot, { [files.a]: { status: "applied", version: off.PIPELINE_VERSION, officialFile, decidedBy: "panel" } });
  assert.equal(off.storefrontImageIndex(dataRoot, mirrorIndex)["https://img.example/a.jpg"].file, files.a, "diskte olmayan resmî görsel kullanılmaz");
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("verified source list: every row is checkable (sku, barcode, https manufacturer page and picture)", () => {
  const rows = off.loadManualSources();
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.ok(String(row.supplierSku || "").trim(), "tedarikçi kodu");
    assert.match(String(row.barcode || ""), /^\d{8,14}$/, row.supplierSku + ": barkod");
    assert.match(String(row.pageUrl || ""), /^https:\/\//, row.supplierSku + ": üretici sayfası");
    assert.match(String(row.imageUrl || ""), /^https:\/\//, row.supplierSku + ": görsel adresi");
    assert.ok(row.verifiedAt, row.supplierSku + ": kontrol tarihi");
  }
  const coffee = rows.find((row) => row.supplierSku === "600.20.50.0015");
  assert.equal(coffee.barcode, "8690627001034");
  assert.ok(!read("lib/official-image-sources.json").includes("bilgisayarim.com.tr"), "tedarikçi adresi listede yok");
});

test("server wiring: official pictures reach storefront, thumbnails and Akakçe; Icecat only with a username", () => {
  const server = read("server.js");
  assert.match(server, /function storefrontMirror\(\) \{\s*return storefrontImageIndex\(DATA_ROOT, loadMirrorIndex\(DATA_ROOT\)\);/);
  assert.match(server, /icecatUsername: String\(process\.env\.ICECAT_USERNAME \|\| ""\)\.trim\(\)/);
  assert.match(server, /scheduleOfficialImagesRun\(7 \* 60 \* 1000\);/);
  assert.match(server, /deadline: startedAt \+ OFFICIAL_IMAGES_PASS_MS/);
  assert.match(read("scripts/regenerate-home-featured.js"), /storefrontImageIndex\(DATA_ROOT, loadMirrorIndex\(DATA_ROOT\)\)/);
  assert.match(read(".env.example"), /^ICECAT_USERNAME=/m);
});

test("admin: official pictures are listed and can be switched back; the storefront follows", async (t) => {
  const password = "test-admin-password";
  const { baseUrl, dataRoot } = await spawnTestServer(t, { ADMIN_PASSWORD: password, SUPPLIER_ALLOWED_HOSTS: "supplier.example" });
  const { writeCachedRates } = require("../lib/fx");
  const runtime = path.join(dataRoot, ".runtime");
  const dir = mirrorPaths(dataRoot).mediaDir;
  fs.mkdirSync(dir, { recursive: true });
  const original = "7".repeat(28) + ".jpg";
  fs.writeFileSync(path.join(dir, original), await picture("#101010"));
  const officialFile = off.officialFileFor(original, coffeeSource.imageUrl);
  fs.writeFileSync(path.join(dir, officialFile), await sharp(await picture("#ffffff")).jpeg().toBuffer());
  const imageUrl = "https://cdn.example/KAHVE-1.jpg";
  fs.writeFileSync(
    path.join(runtime, "catalog-image-mirror.json"),
    JSON.stringify({ version: 1, entries: { [imageUrl]: { sourceUrl: imageUrl, file: original, publicPath: "/media/catalog/" + original, placeholder: false } } })
  );
  bg.updateBackgroundIndex(dataRoot, { [original]: { status: "rejected", version: bg.PIPELINE_VERSION } });
  off.updateOfficialIndex(dataRoot, {
    [original]: {
      status: "applied",
      version: off.PIPELINE_VERSION,
      at: new Date().toISOString(),
      source: "manufacturer",
      pageUrl: coffeeSource.pageUrl,
      imageUrl: coffeeSource.imageUrl,
      officialFile,
    },
  });
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
        barcode: "8690627001034",
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
  assert.ok((await imageOf()).endsWith("/media/catalog/" + officialFile), "vitrin resmî görseli gösterir");

  assert.equal((await fetch(baseUrl + "/api/admin/official-images")).status, 401, "liste yalnızca panelde");
  const list = await (await fetch(baseUrl + "/api/admin/official-images?status=applied", { headers })).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].official, "/media/catalog/" + officialFile);
  assert.equal(list.items[0].original, "/media/catalog/" + original);
  assert.equal(list.items[0].pageUrl, coffeeSource.pageUrl);
  assert.equal(list.items[0].products[0].sku, "KAHVE-1");
  assert.equal(list.tool.icecat, false, "testte Icecat kullanıcı adı yok");

  const bad = await fetch(baseUrl + "/api/admin/official-images/decision", {
    method: "POST",
    headers,
    body: JSON.stringify({ file: "../../.env", use: "original" }),
  });
  assert.equal(bad.status, 422);
  const reverted = await fetch(baseUrl + "/api/admin/official-images/decision", {
    method: "POST",
    headers,
    body: JSON.stringify({ file: original, use: "original" }),
  });
  assert.equal(reverted.status, 200);
  assert.equal((await reverted.json()).status, "reverted");
  assert.ok((await imageOf()).endsWith("/media/catalog/" + original), "orijinale dönünce vitrin orijinali gösterir");
});

test("admin panel: official pictures sit in the white-background tab with a revert button", () => {
  const js = read("assets/js/admin-panel.js");
  assert.match(js, /\/api\/admin\/official-images\?/);
  assert.match(js, /\/api\/admin\/official-images\/decision/);
  assert.match(read("admin.html"), /<option value="official">/);
});
