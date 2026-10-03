const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolveFeedImageUrl,
  mirrorAkakceCatalogImages,
  loadMirrorIndex,
  exposesSupplierHost,
} = require("../lib/product-image-mirror");
const { buildAkakceXml, analyzeAkakceProducts } = require("../lib/akakce");

function feedReadyProduct(overrides) {
  return Object.assign(
    {
      id: "ready",
      supplierSku: "READY-1",
      name: "Hazır Ürün",
      brand: "PATYGO",
      category: "bilgisayar-tablet",
      siteParent: "bilgisayar-tablet",
      siteMid: "tasinabilir-bilgisayarlar",
      siteChild: "notebooklar",
      description: "Kısa açıklama",
      price: 100,
      image: "https://cdn.bilgisayarim.com.tr/images/ready.jpg",
      images: ["https://cdn.bilgisayarim.com.tr/images/ready.jpg"],
      stockQty: 3,
      active: true,
      source: "supplier",
      manufacturerCode: "READY-MPN",
      barcode: "8690000000001",
      gtipCode: "84.71.30.00.00.00",
      mainCategory: "KİŞİSEL BİLGİSAYARLAR",
      midCategory: "Taşınabilir Bilgisayarlar",
      subCategory: "Notebooklar",
      vatPercent: 20,
      currency: "TRY",
      unit: "ADET",
      lastSuccessfulFetchAt: new Date().toISOString(),
    },
    overrides || {}
  );
}

test("resolveFeedImageUrl hides supplier CDN when mirror entry exists", () => {
  const index = {
    "https://cdn.bilgisayarim.com.tr/images/ready.jpg": {
      publicPath: "/media/catalog/abc123.jpg",
      file: "abc123.jpg",
    },
  };
  const url = resolveFeedImageUrl(
    "https://cdn.bilgisayarim.com.tr/images/ready.jpg",
    "https://patygoteknoloji.com",
    index
  );
  assert.equal(url, "https://patygoteknoloji.com/media/catalog/abc123.jpg");
  assert.equal(exposesSupplierHost(url), false);
});

test("Akakce XML never exposes bilgisayarim hosts when mirror index is used", () => {
  const mirrorIndex = {
    "https://cdn.bilgisayarim.com.tr/images/ready.jpg": {
      publicPath: "/media/catalog/abc123.jpg",
      file: "abc123.jpg",
    },
  };
  const xml = buildAkakceXml([feedReadyProduct()], {
    siteBaseUrl: "https://patygoteknoloji.com",
    mirrorIndex,
  });
  assert.match(xml, /patygoteknoloji\.com\/media\/catalog\/abc123\.jpg/);
  assert.doesNotMatch(xml, /bilgisayarim/i);
});

test("Akakce analysis excludes supplier products without mirrored image", () => {
  const analysis = analyzeAkakceProducts([feedReadyProduct()], {
    siteBaseUrl: "https://patygoteknoloji.com",
    mirrorIndex: {},
  });
  assert.equal(analysis.eligible.length, 0);
  assert.match(analysis.excluded[0].reasons.join("|"), /Görsel aynası hazır değil/);
});

test("mirrorAkakceCatalogImages downloads supplier images to local media", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-mirror-"));
  const source = "https://cdn.bilgisayarim.com.tr/images/unit.jpg";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => png,
  });
  await mirrorAkakceCatalogImages([feedReadyProduct({ image: source, images: [source] })], {
    dataRoot: tmp,
    siteBaseUrl: "https://patygoteknoloji.com",
    fetchImpl,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const index = loadMirrorIndex(tmp);
  assert.ok(index[source]);
  assert.match(index[source].publicPath, /^\/media\/catalog\//);
  const filePath = path.join(tmp, ".runtime", "media", "catalog", index[source].file);
  assert.ok(fs.existsSync(filePath));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("mirrorAkakceCatalogImages does not retry 404 images until the retry window passes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-mirror-404-"));
  const missing = "https://cdn.bilgisayarim.com.tr/images/missing.jpg";
  const flaky = "https://cdn.bilgisayarim.com.tr/images/flaky.jpg";
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: false, status: url === missing ? 404 : 500, headers: { get: () => "" } };
  };
  const products = [
    feedReadyProduct({ id: "a", image: missing, images: [missing] }),
    feedReadyProduct({ id: "b", image: flaky, images: [flaky] }),
  ];
  const base = {
    dataRoot: tmp,
    siteBaseUrl: "https://patygoteknoloji.com",
    fetchImpl,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  };
  const now = Date.parse("2026-10-03T00:00:00Z");

  await mirrorAkakceCatalogImages(products, Object.assign({ now }, base));
  assert.deepEqual(calls.sort(), [flaky, missing].sort());

  calls.length = 0;
  const second = await mirrorAkakceCatalogImages(products, Object.assign({ now: now + 60000 }, base));
  assert.deepEqual(calls, [flaky], "404 skipped, transient 500 retried");
  assert.equal(second.skippedNotFound, 1);

  calls.length = 0;
  await mirrorAkakceCatalogImages(products, Object.assign({ now: now + 8 * 24 * 60 * 60 * 1000 }, base));
  assert.deepEqual(calls.sort(), [flaky, missing].sort(), "retried after 7 days");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("server exposes mirrored catalog media route and mirror scheduler", () => {
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /\/media\/catalog\//);
  assert.match(serverJs, /scheduleAkakceImageMirror/);
  assert.match(serverJs, /mirrorAkakceCatalogImages/);
});

test("mirror scheduler feeds on storefront candidates, not the image-gated merged catalog", () => {
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = serverJs.indexOf("function scheduleAkakceImageMirror");
  const end = serverJs.slice(start).search(/\r?\n\}\r?\n/);
  const body = serverJs
    .slice(start, start + end)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.match(body, /supplierStorefrontCandidates\(supplierManager\.listProducts\(\)\)/);
  assert.doesNotMatch(body, /mergedProducts\(|storefrontCatalogMemo/);
});

test("new XML product without a mirrored image is mirrored and then reaches the storefront", async () => {
  const { mergeCatalogProducts, supplierStorefrontCandidates } = require("../lib/catalog");
  const { TEST_SITE_CATEGORIES } = require("./helpers/site-categories");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-mirror-new-"));
  const oldSrc = "https://cdn.bilgisayarim.com.tr/images/old.jpg";
  const newSrc = "https://cdn.bilgisayarim.com.tr/images/new.jpg";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => png };
  };
  const base = {
    dataRoot: tmp,
    siteBaseUrl: "https://patygoteknoloji.com",
    fetchImpl,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  };
  const row = (id, src) =>
    feedReadyProduct({
      id,
      supplierSku: id,
      salePrice: 100,
      image: src,
      images: [src],
      siteParent: "oem-cevre-birimleri",
      siteMid: "",
      siteChild: "notebook",
    });
  try {
    await mirrorAkakceCatalogImages([row("old", oldSrc)], base);
    const supplier = [row("old", oldSrc), row("new", newSrc)];
    const ctx = () => ({
      categories: TEST_SITE_CATEGORIES,
      mirrorIndex: loadMirrorIndex(tmp),
      siteBaseUrl: "https://patygoteknoloji.com",
      dataRoot: tmp,
    });
    const before = mergeCatalogProducts([], supplier, ctx());
    assert.deepEqual(before.map((p) => p.id), ["old"]);

    const candidates = supplierStorefrontCandidates(supplier, { categories: TEST_SITE_CATEGORIES });
    assert.deepEqual(candidates.map((p) => p.id), ["old", "new"]);
    fetched.length = 0;
    await mirrorAkakceCatalogImages(candidates, base);
    assert.deepEqual(fetched, [newSrc]);

    const after = mergeCatalogProducts([], supplier, ctx());
    assert.deepEqual(after.map((p) => p.id), ["old", "new"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("mirror downloads the full-size URL the storefront gate looks up, not the thumbnail", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-mirror-th-"));
  const thumb = "https://cdn.bilgisayarim.com.tr/images/115392_th.jpg";
  const full = "https://cdn.bilgisayarim.com.tr/images/115392.jpg";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => png };
  };
  try {
    await mirrorAkakceCatalogImages([feedReadyProduct({ image: thumb, images: [thumb] })], {
      dataRoot: tmp,
      siteBaseUrl: "https://patygoteknoloji.com",
      fetchImpl,
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    assert.deepEqual(fetched, [full]);
    assert.ok(loadMirrorIndex(tmp)[full]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
