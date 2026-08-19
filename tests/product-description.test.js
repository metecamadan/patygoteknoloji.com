const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectProductKind,
  buildSpecRows,
  buildGeneratedDescription,
  buildGeneratedDetails,
  enrichProductCopy,
  isUsableCopy,
  formatSpecTable,
} = require("../lib/product-description");

const LENOVO_V15 =
  'Lenovo V15 83A100KXTR_40 Intel Core I7 1355U 40gb Ram 512GB SSD 15.6" FreeDOS Notebook (Upg)';

test("detectProductKind maps notebooks and CPUs", () => {
  assert.equal(
    detectProductKind({ name: LENOVO_V15, siteChild: "notebooklar" }),
    "notebook"
  );
  assert.equal(
    detectProductKind({
      name: "Intel Core i3-10100 Soket 1200 3.6GHz 6MB 4 Çekirdek İşlemci",
      siteChild: "intel-islemciler",
    }),
    "cpu"
  );
  assert.equal(
    detectProductKind({ name: "Kingston 16GB DDR5 5600MHz CL40 DIMM Bellek" }),
    "ram"
  );
});

test("buildSpecRows extracts notebook and CPU fields from product titles", () => {
  const notebookRows = buildSpecRows({ brand: "LENOVO", name: LENOVO_V15 });
  assert.ok(notebookRows.some((row) => row.label === "Bellek" && /40 GB/i.test(row.value)));
  assert.ok(notebookRows.some((row) => row.label === "İşlemci" && /i7-1355U/i.test(row.value)));
  assert.ok(notebookRows.some((row) => row.label === "İşletim sistemi" && /FreeDOS/i.test(row.value)));

  const cpuRows = buildSpecRows({
    brand: "INTEL",
    name: "Intel Core i3-10100 Soket 1200 3.6GHz 6MB Önbellek 4 Çekirdek UHD630 İşlemci",
    manufacturerCode: "BX8070110100",
  });
  assert.ok(cpuRows.some((row) => row.label === "Soket" && /1200/i.test(row.value)));
  assert.ok(cpuRows.some((row) => row.label === "Üretici kodu" && /BX8070110100/.test(row.value)));
});

test("generated copy uses spec table prefix and honest sourcing note", () => {
  const product = {
    brand: "HP",
    name: "HP ProBook 450 G10 Intel Core i5 16GB 512GB SSD 15.6 FreeDOS Notebook",
  };
  const description = buildGeneratedDescription(product);
  const details = buildGeneratedDetails(product);
  assert.match(description, /ürün adı ve katalog bilgisinden/i);
  assert.match(details, /^__SPEC_TABLE__/);
  assert.ok(details.includes("Bellek|16 GB RAM") || details.includes("Bellek|16GB"));
});

test("enrichProductCopy keeps usable XML text and manual overrides", () => {
  const xmlLike = enrichProductCopy({
    brand: "CANON",
    name: "Canon CRG-070 Siyah Toner",
    description: "Canon CRG-070 orijinal siyah toner kartuşu.",
    details: "Canon CRG-070 orijinal siyah toner kartuşu.",
  });
  assert.equal(xmlLike.description, "Canon CRG-070 orijinal siyah toner kartuşu.");

  const manual = enrichProductCopy(
    {
      brand: "LENOVO",
      name: LENOVO_V15,
      description: "",
      details: "",
    },
    { skipDescription: true, skipDetails: true }
  );
  assert.equal(manual.description, "");
  assert.equal(manual.details, "");

  const generated = enrichProductCopy({
    brand: "LENOVO",
    name: LENOVO_V15,
    description: LENOVO_V15,
    details: "",
  });
  assert.ok(isUsableCopy(generated.description, LENOVO_V15));
  assert.match(generated.details, /^__SPEC_TABLE__/);
});

test("formatSpecTable renders pipe rows", () => {
  const text = formatSpecTable([
    { label: "Bellek", value: "16 GB RAM" },
    { label: "Depolama", value: "512 GB SSD" },
  ]);
  assert.match(text, /^__SPEC_TABLE__/);
  assert.match(text, /Bellek\|16 GB RAM/);
});

test("supplier hydrate keeps curated Lenovo override untouched", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const content = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "scripts", "content", "sup-150-20-10-0738-237e44a9.json"),
      "utf8"
    )
  );
  const { createSupplierStore } = require("../lib/supplier");
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-desc-"));
  const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<urunler>
  <urun>
    <UrunKodu>150.20.10.0738</UrunKodu>
    <UrunAciklama>${content.name || "Lenovo V15"}</UrunAciklama>
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
        supplierSku: content.supplierSku,
        active: true,
        siteParent: "bilgisayar-tablet",
        siteMid: "tasinabilir-bilgisayarlar",
        siteChild: "notebooklar",
        description: content.description,
        details: content.details,
      },
    ]);
    const product = store.listProducts().find((row) => row.supplierSku === content.supplierSku);
    assert.ok(product);
    assert.equal(product.description, content.description);
    assert.equal(product.details, content.details);
    assert.match(product.details, /^__SPEC_TABLE__/);
    assert.match(product.description, /PSREF|doğrulanmış/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
