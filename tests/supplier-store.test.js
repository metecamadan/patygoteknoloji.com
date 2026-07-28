const test = require("node:test");
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
    await store.saveUrl("https://supplier.example/feed.xml?token=secret");
    await store.refresh();
    let product = store.listProducts()[0];
    assert.equal(product.active, false);
    assert.equal(product.salePrice, 120);

    store.updateOverrides([
      { supplierSku: "SKU-1", active: true, marginPercent: 30 },
    ]);
    product = store.listProducts()[0];
    assert.equal(product.active, true);
    assert.equal(product.marginOverride, 30);
    assert.equal(product.salePrice, 130);
    assert.doesNotMatch(JSON.stringify(store.status()), /secret/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
