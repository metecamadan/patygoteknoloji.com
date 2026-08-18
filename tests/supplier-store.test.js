const test = require("node:test");
const PUBLIC_DNS = async () => [{ address: "93.184.216.34", family: 4 }];
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  atomicWriteJson,
  createSupplierStore,
  fetchSupplierXml,
  isPrivateIp,
  validateSupplierUrl,
} = require("../lib/supplier");
const { analyzeSupplierFeedIssues } = require("../lib/akakce");
const {
  installTestSiteCategories,
  clearTestSiteCategories,
} = require("./helpers/site-categories");

const SAMPLE_XML = `<?xml version="1.0"?>
<catalog><products><product>
  <StokKodu>SKU-1</StokKodu>
  <UrunAdi>Test Ürünü</UrunAdi>
  <Marka>Patygo</Marka>
  <Fiyat>100</Fiyat>
  <Stok>4</Stok>
  <Kategori>Bilgisayar</Kategori>
  <ResimUrl>https://cdn.example/sku-1.jpg</ResimUrl>
</product></products></catalog>`;

test("supplier host allowlist fails closed", async () => {
  await assert.rejects(
    validateSupplierUrl("https://supplier.example/feed.xml", [], {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    }),
    /izin verilmemiş/i
  );
});

test("IPv4-mapped private IPv6 ranges are blocked", () => {
  assert.equal(isPrivateIp("::ffff:172.16.0.1"), true);
  assert.equal(isPrivateIp("::ffff:169.254.169.254"), true);
});

test("supplier fetch rejects oversized responses before reading the body", async () => {
  const fetchImpl = async () => ({
    ok: true,
    headers: new Map([["content-length", "2049"]]),
    body: null,
    text: async () => SAMPLE_XML,
  });
  await assert.rejects(
    fetchSupplierXml(new URL("https://supplier.example/feed.xml"), {
      fetchImpl,
      maxBytes: 2048,
      timeoutMs: 50,
    }),
    /sınırını aşıyor/i
  );
});

test("supplier fetch upgrades http to https before request", async () => {
  let seen = "";
  const fetchImpl = async (url) => {
    seen = String(url);
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: null,
      text: async () => SAMPLE_XML,
    };
  };
  const xml = await fetchSupplierXml(new URL("http://supplier.example/feed.xml"), {
    fetchImpl,
    allowedHosts: ["supplier.example"],
    maxBytes: 2048,
  });
  assert.equal(seen, "https://supplier.example/feed.xml");
  assert.match(xml, /SKU-1/);
});

test("supplier fetch follows same-host redirects", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).endsWith("/old.xml")) {
      return {
        status: 301,
        ok: false,
        headers: { get: (name) => (name === "location" ? "https://supplier.example/feed.xml" : null) },
        body: null,
      };
    }
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: null,
      text: async () => SAMPLE_XML,
    };
  };
  const xml = await fetchSupplierXml(new URL("https://supplier.example/old.xml"), {
    fetchImpl,
    allowedHosts: ["supplier.example"],
    maxBytes: 2048,
    resolveHost: PUBLIC_DNS,
  });
  assert.equal(calls, 2);
  assert.match(xml, /SKU-1/);
});

test("supplier fetch rejects redirects outside allowlist", async () => {
  const fetchImpl = async () => ({
    status: 302,
    ok: false,
    headers: { get: (name) => (name === "location" ? "https://evil.example/feed.xml" : null) },
    body: null,
  });
  await assert.rejects(
    fetchSupplierXml(new URL("https://supplier.example/feed.xml"), {
      fetchImpl,
      allowedHosts: ["supplier.example"],
      maxBytes: 2048,
    }),
    /izin verilen alan adları dışında/i
  );
});

test("normalizeSupplierFeedUrl upgrades http to https", () => {
  const { normalizeSupplierFeedUrl } = require("../lib/supplier");
  assert.equal(
    normalizeSupplierFeedUrl("http://www.bilgisayarim.com.tr/feed").href,
    "https://www.bilgisayarim.com.tr/feed"
  );
});

test("supplier catalog stays in memory after first read so disk parse does not block the storefront", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cache-memo-"));
  const cacheFile = path.join(root, ".runtime", "supplier-cache.json");
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const store = createSupplierStore(root, {
      allowedHosts: ["supplier.example"],
      defaultMarginPercent: 20,
      validateUrl: async (raw) => new URL(raw),
      fetchXml: async () => SAMPLE_XML,
    });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify([
        {
          supplierSku: "SKU-MEMO",
          name: "Bellekte kalan",
          brand: "Patygo",
          costPrice: 10,
          currency: "TRY",
          stockQty: 2,
        },
      ]),
      "utf8"
    );
    const first = store.listProducts();
    assert.equal(first.length, 1);
    assert.equal(first[0].supplierSku, "SKU-MEMO");
    const second = store.listProducts();
    assert.equal(second[0].name, "Bellekte kalan");
    fs.writeFileSync(
      cacheFile,
      JSON.stringify([
        {
          supplierSku: "SKU-NEW",
          name: "Diskten yeni",
          brand: "Patygo",
          costPrice: 10,
          currency: "TRY",
          stockQty: 2,
        },
      ]),
      "utf8"
    );
    const third = store.listProducts();
    assert.equal(third[0].supplierSku, "SKU-NEW");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("atomic JSON writes leave one complete target and no temp file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-atomic-"));
  const target = path.join(root, "state.json");
  try {
    atomicWriteJson(target, { active: true, count: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), {
      active: true,
      count: 2,
    });
    assert.deepEqual(
      fs.readdirSync(root).filter((name) => name.endsWith(".tmp")),
      []
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("supplier store stages products as passive and applies margin overrides", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-store-"));
  const store = createSupplierStore(root, {
    allowedHosts: ["supplier.example"],
    defaultMarginPercent: 20,
    validateUrl: async (raw) => new URL(raw),
    fetchXml: async () => SAMPLE_XML,
  });
  try {
    installTestSiteCategories(root);
    await store.saveUrl("https://supplier.example/feed.xml?token=secret");
    await store.refresh();
    let product = store.listProducts()[0];
    assert.equal(product.active, false);
    assert.equal(product.salePrice, 120);

    store.updateOverrides([
      {
        supplierSku: "SKU-1",
        active: true,
        marginPercent: 30,
        name: "Özel Ürün Adı",
        siteParent: "oem-cevre-birimleri",
        siteChild: "notebook",
      },
    ]);
    product = store.listProducts()[0];
    assert.equal(product.active, true);
    assert.equal(product.name, "Özel Ürün Adı");
    assert.equal(product.nameOverride, "Özel Ürün Adı");
    assert.equal(product.marginOverride, 30);
    assert.equal(product.salePrice, 130);
    assert.doesNotMatch(JSON.stringify(store.status()), /secret/);

    store.updateOverrides([
      {
        supplierSku: "SKU-1",
        description: "Revize kısa açıklama",
        details: "Revize detay metni",
        images: [
          "https://cdn.example/sku-1-b.jpg",
          "https://cdn.example/sku-1.jpg",
        ],
      },
    ]);
    product = store.listProducts()[0];
    assert.equal(product.description, "Revize kısa açıklama");
    assert.equal(product.details, "Revize detay metni");
    assert.equal(product.image, "https://cdn.example/sku-1-b.jpg");
    assert.deepEqual(product.images, [
      "https://cdn.example/sku-1-b.jpg",
      "https://cdn.example/sku-1.jpg",
    ]);

    store.updateOverrides([
      {
        supplierSku: "SKU-1",
        barcode: "8690000000001",
        gtipCode: "84.71.30.00.00.00",
        mainCategory: "KİŞİSEL BİLGİSAYARLAR",
        midCategory: "Taşınabilir Bilgisayarlar",
        subCategory: "Notebooklar",
        vatPercent: 20,
      },
    ]);
    product = store.listProducts()[0];
    assert.deepEqual(
      analyzeSupplierFeedIssues(product, { siteBaseUrl: "https://patygoteknoloji.com" }),
      []
    );
  } finally {
    clearTestSiteCategories();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed XML refresh keeps last catalog and does not empty the pool", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-stale-"));
  let round = 0;
  const store = createSupplierStore(root, {
    allowedHosts: ["supplier.example"],
    defaultMarginPercent: 15,
    validateUrl: async (raw) => new URL(raw),
    fetchXml: async () => {
      round += 1;
      if (round === 1) return SAMPLE_XML;
      throw new Error("Tedarikçi XML bağlantısı zaman aşımına uğradı.");
    },
  });
  try {
    installTestSiteCategories(root);
    await store.saveUrl("https://supplier.example/feed.xml");
    await store.refresh();
    store.updateOverrides([
      {
        supplierSku: "SKU-1",
        active: true,
        siteParent: "oem-cevre-birimleri",
        siteChild: "notebook",
      },
    ]);
    await assert.rejects(() => store.refresh(), /zaman aşımı/);
    const status = store.status();
    const product = store.listProducts()[0];
    assert.equal(status.lastFetchStatus, "error");
    assert.equal(status.catalogStale, true);
    assert.equal(status.itemCount, 1);
    assert.equal(product.supplierSku, "SKU-1");
    assert.equal(product.stockQty, 4);
    assert.equal(product.active, true);
    assert.equal(product.catalogStale, true);
  } finally {
    clearTestSiteCategories();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("supplier settings persist XML schedule start and interval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sched-"));
  const store = createSupplierStore(root, {
    allowedHosts: ["supplier.example"],
    defaultMarginPercent: 15,
  });
  try {
    const initial = store.status();
    assert.equal(initial.scheduleStartMinute, 8 * 60);
    assert.equal(initial.scheduleIntervalMinutes, 180);
    assert.deepEqual(initial.scheduleTimes, ["08:00", "11:00", "14:00", "17:00", "20:00"]);
    const saved = store.setSettings({
      scheduleStart: "09:00",
      scheduleIntervalMinutes: 120,
    });
    assert.equal(saved.scheduleStartMinute, 9 * 60);
    assert.equal(saved.scheduleIntervalMinutes, 120);
    assert.deepEqual(store.status().scheduleTimes, [
      "09:00",
      "11:00",
      "13:00",
      "15:00",
      "17:00",
      "19:00",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("supplier store blocks publish without a valid site category", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sitecat-"));
  const store = createSupplierStore(root, {
    allowedHosts: ["supplier.example"],
    defaultMarginPercent: 20,
    validateUrl: async (raw) => new URL(raw),
    fetchXml: async () => SAMPLE_XML,
  });
  try {
    installTestSiteCategories(root);
    await store.saveUrl("https://supplier.example/feed.xml");
    await store.refresh();
    assert.throws(
      () => store.updateOverrides([{ supplierSku: "SKU-1", active: true }]),
      /Site kategorisi seçilmeden ürün yayına alınamaz/
    );
    store.updateOverrides([
      {
        supplierSku: "SKU-1",
        siteParent: "oem-cevre-birimleri",
        siteChild: "notebook",
        active: true,
      },
    ]);
    assert.equal(store.listProducts()[0].active, true);
    assert.equal(store.listProducts()[0].siteCategoryAssigned, true);
    const listed = store.listProducts()[0];
    const byId = store.getProductById(listed.id);
    assert.ok(byId);
    assert.equal(byId.id, listed.id);
    assert.equal(byId.name, listed.name);
    assert.equal(byId.salePrice, listed.salePrice);
    assert.equal(store.getProductById("missing-id"), null);
    store.updateOverrides([
      { supplierSku: "SKU-1", siteParent: "", siteChild: "" },
    ]);
    const cleared = store.listProducts()[0];
    assert.equal(cleared.active, false);
    assert.equal(cleared.siteCategoryAssigned, false);
  } finally {
    clearTestSiteCategories();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("disallowed stored feed host is dropped and cache is emptied", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-dropfeed-"));
  const runtime = path.join(root, ".runtime");
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(
    path.join(runtime, "supplier-2-config.json"),
    JSON.stringify({ url: "https://xml.avansas.com/feed.xml", name: "Test XML" }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-2-cache.json"),
    JSON.stringify([{ id: "x", name: "Test", costPrice: 10 }]),
    "utf8"
  );
  try {
    const store = createSupplierStore(root, {
      filePrefix: "supplier-2",
      allowedHosts: ["www.bilgisayarim.com.tr", "xml.avansas.com"],
      defaultName: "XML Kaynağı 2",
    });
    assert.equal(store.status().configured, false);
    assert.equal(store.listProducts().length, 0);
    const saved = JSON.parse(fs.readFileSync(path.join(runtime, "supplier-2-config.json"), "utf8"));
    assert.equal(saved.url, "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed parse keeps last XML on disk for later import", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-lastxml-"));
  const store = createSupplierStore(root, {
    allowedHosts: ["supplier.example"],
    defaultMarginPercent: 15,
    validateUrl: async (raw) => new URL(raw),
    fetchXml: async () =>
      `<?xml version="1.0"?><Urunler><Urun><StokKodu>A1</StokKodu><Not>Yok</Not></Urun><Urun><StokKodu>A2</StokKodu><Not>Yok</Not></Urun></Urunler>`,
  });
  try {
    await store.saveUrl("https://supplier.example/feed.xml");
    await assert.rejects(() => store.refresh(), /fiyatı ve adı geçerli|ürün listesi tespit edilemedi/);
    const last = fs.readFileSync(path.join(root, ".runtime", "supplier-last.xml"), "utf8");
    assert.match(last, /<StokKodu>A1<\/StokKodu>/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
