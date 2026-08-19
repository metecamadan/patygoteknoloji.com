const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createSupplierStore } = require("../lib/supplier");

const root = path.resolve(__dirname, "..");
const contentPath = path.join(
  root,
  "scripts",
  "content",
  "sup-150-20-10-0738-237e44a9.json"
);
const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));

test("Lenovo V15 SEO content is verified and honest about RAM upgrade", () => {
  assert.match(content.description, /83A100KXTR/i);
  assert.match(content.details, /i7-1355U/i);
  assert.match(content.description, /40 GB/i);
  assert.match(content.details, /^__SPEC_TABLE__/);
  assert.match(content.details, /Bellek\|40 GB \(yükseltmeli/);
  assert.match(content.details, /FreeDOS/i);
  assert.ok(content.description.length <= 2000);
  assert.ok(content.details.length <= 8000);
  assert.ok(Array.isArray(content.sources) && content.sources.length >= 2);
});

test("apply-supplier-seo-override writes description and details override", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-seo-"));
  const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<urunler>
  <urun>
    <UrunKodu>150.20.10.0738</UrunKodu>
    <UrunAciklama>Lenovo V15 Test</UrunAciklama>
    <Marka>Lenovo</Marka>
    <Stok>5</Stok>
    <BayiFiyat>1000</BayiFiyat>
    <ParaBirimi>TRY</ParaBirimi>
    <KdvOrani>20</KdvOrani>
    <GorselBuyuk>https://cdn.example/lenovo-v15.jpg</GorselBuyuk>
  </urun>
</urunler>`;
  const store = createSupplierStore(tmp, {
    allowedHosts: ["supplier.example"],
    defaultMarginPercent: 15,
    validateUrl: async (raw) => new URL(raw),
    fetchXml: async () => SAMPLE_XML,
  });
  try {
    await store.saveUrl("https://supplier.example/feed.xml");
    await store.refresh();
    store.updateOverrides([
      {
        supplierSku: "150.20.10.0738",
        active: true,
        siteParent: "bilgisayar-tablet",
        siteMid: "tasinabilir-bilgisayarlar",
        siteChild: "notebooklar",
      },
    ]);
    store.updateOverrides([
      {
        supplierSku: content.supplierSku,
        description: content.description,
        details: content.details,
      },
    ]);
    const product = store.listProducts().find((row) => row.supplierSku === content.supplierSku);
    assert.ok(product);
    assert.equal(product.description, content.description);
    assert.equal(product.details, content.details);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
