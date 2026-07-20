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

test("supplier fetch aborts when the timeout is exceeded", async () => {
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  await assert.rejects(
    fetchSupplierXml(new URL("https://supplier.example/feed.xml"), {
      fetchImpl,
      timeoutMs: 10,
      maxBytes: 2048,
    }),
    /zaman aşımına uğradı/i
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
