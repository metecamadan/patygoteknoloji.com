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
  });
  const index = loadMirrorIndex(tmp);
  assert.ok(index[source]);
  assert.match(index[source].publicPath, /^\/media\/catalog\//);
  const filePath = path.join(tmp, ".runtime", "media", "catalog", index[source].file);
  assert.ok(fs.existsSync(filePath));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("server exposes mirrored catalog media route and mirror scheduler", () => {
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /\/media\/catalog\//);
  assert.match(serverJs, /scheduleAkakceImageMirror/);
  assert.match(serverJs, /mirrorAkakceCatalogImages/);
});
