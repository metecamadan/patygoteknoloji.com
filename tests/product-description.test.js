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
  assert.equal(
    detectProductKind({
      name: 'Power Boost PowerBoost 24" PB-M24VH 5ms 1920x1080 FHD 75Hz TN Panel VGA+HDMI Slim Frame PC Monitör',
      siteChild: "monitorler",
    }),
    "monitor"
  );
});

test("buildSpecRows extracts monitor fields including response time and ports", () => {
  const rows = buildSpecRows({
    brand: "Power Boost",
    name: 'Power Boost PowerBoost 24" PB-M24VH 5ms 1920x1080 FHD 75Hz TN Panel VGA+HDMI Slim Frame PC Monitör',
    manufacturerCode: "M24VH",
    barcode: "8682016344273",
  });
  assert.ok(rows.some((row) => row.label === "Çözünürlük" && /1920x1080 FHD/.test(row.value)));
  assert.ok(rows.some((row) => row.label === "Tazeleme" && /75 Hz/.test(row.value)));
  assert.ok(rows.some((row) => row.label === "Panel" && row.value === "TN"));
  assert.ok(rows.some((row) => row.label === "Yanıt süresi" && /5 ms/.test(row.value)));
  assert.ok(rows.some((row) => row.label === "Bağlantılar" && /VGA \+ HDMI/.test(row.value)));
});

test("thin spec tables are regenerated with richer monitor rows", () => {
  const product = {
    brand: "Power Boost",
    name: 'Power Boost PowerBoost 24" PB-M24VH 5ms 1920x1080 FHD 75Hz TN Panel VGA+HDMI Slim Frame PC Monitör',
    manufacturerCode: "M24VH",
    barcode: "8682016344273",
    description:
      "Power Boost bellek modülü (PB-M24VH). Teknik satırlar ürün adı ve katalog bilgisinden derlenmiştir.",
    details:
      "__SPEC_TABLE__\nEkran|24\" Ekran\nBarkod|8682016344273\nÜretici kodu|M24VH\nMarka|Power Boost",
  };
  const enriched = enrichProductCopy(product);
  assert.match(enriched.description, /monitör/i);
  assert.match(enriched.details, /Yanıt süresi\|5 ms/);
  assert.match(enriched.details, /Bağlantılar\|VGA \+ HDMI/);
});

test("buildSpecRows extracts notebook and CPU fields from product titles", () => {
  const notebookRows = buildSpecRows({ brand: "LENOVO", name: LENOVO_V15 });
  assert.ok(notebookRows.some((row) => row.label === "Bellek" && /40 GB/i.test(row.value)));
  assert.ok(notebookRows.some((row) => row.label === "İşlemci" && /i7-1355U/i.test(row.value)));
  assert.ok(notebookRows.some((row) => row.label === "İşletim sistemi" && /FreeDOS/i.test(row.value)));
  assert.ok(notebookRows.some((row) => row.label === "Depolama" && /512/i.test(row.value)));

  const cpuRows = buildSpecRows({
    brand: "INTEL",
    name: "Intel Core i3-10100 Soket 1200 3.6GHz 6MB Önbellek 4 Çekirdek UHD630 İşlemci",
    manufacturerCode: "BX8070110100",
  });
  assert.ok(cpuRows.some((row) => row.label === "Soket" && /1200/i.test(row.value)));
  assert.ok(cpuRows.some((row) => row.label === "Üretici kodu" && /BX8070110100/.test(row.value)));
});

test("buildSpecRows covers RAM, storage, GPU and motherboard titles", () => {
  const ramRows = buildSpecRows({
    brand: "Kingston",
    name: "Kingston 16GB DDR5 5600MHz CL40 DIMM Bellek",
  });
  assert.ok(ramRows.some((row) => row.label === "Kapasite" && /16 GB/.test(row.value)));
  assert.ok(ramRows.some((row) => row.label === "Bellek tipi" && /DDR5/.test(row.value)));
  assert.ok(ramRows.some((row) => row.label === "Hız" && /5600 MHz/.test(row.value)));
  assert.ok(ramRows.some((row) => row.label === "Gecikme" && /CL40/.test(row.value)));

  const ssdRows = buildSpecRows({
    brand: "Samsung",
    name: "Samsung 990 PRO 1TB NVMe M.2 PCIe Gen 4 SSD",
  });
  assert.ok(ssdRows.some((row) => row.label === "Kapasite" && /1 TB/.test(row.value)));
  assert.ok(ssdRows.some((row) => row.label === "Arayüz" && /NVMe|PCIe/i.test(row.value)));

  const gpuRows = buildSpecRows({
    brand: "MSI",
    name: "MSI GeForce RTX 4060 Ti 8GB GDDR6 Ekran Kartı",
  });
  assert.ok(gpuRows.some((row) => row.label === "GPU" && /RTX 4060/i.test(row.value)));
  assert.ok(gpuRows.some((row) => row.label === "Bellek" && /8 GB/.test(row.value)));

  const moboRows = buildSpecRows({
    brand: "ASUS",
    name: "ASUS PRIME B760M-A WIFI DDR5 LGA1700 mATX Anakart",
    siteChild: "anakartlar",
  });
  assert.ok(moboRows.some((row) => row.label === "Soket" && /LGA1700/i.test(row.value)));
  assert.ok(moboRows.some((row) => row.label === "Chipset" && /B760/i.test(row.value)));
  assert.ok(moboRows.some((row) => row.label === "Kablosuz" && /Wi-Fi/i.test(row.value)));
});

test("buildSpecRows covers PSU, network, UPS and peripheral titles", () => {
  const psuRows = buildSpecRows({
    brand: "Corsair",
    name: "Corsair RM750x 750W 80+ Gold Modüler ATX Güç Kaynağı",
  });
  assert.ok(psuRows.some((row) => row.label === "Güç" && /750 W/.test(row.value)));
  assert.ok(psuRows.some((row) => row.label === "Verimlilik" && /Gold/i.test(row.value)));

  const netRows = buildSpecRows({
    brand: "TP-Link",
    name: "TP-Link TL-SG108 8 Port Gigabit Switch",
    siteChild: "switchler",
  });
  assert.ok(netRows.some((row) => row.label === "Port" && /8/.test(row.value)));
  assert.ok(netRows.some((row) => row.label === "Hız" && /Gigabit/i.test(row.value)));

  const upsRows = buildSpecRows({
    brand: "APC",
    name: "APC Back-UPS 900VA 540W Line-Interactive UPS",
  });
  assert.ok(upsRows.some((row) => row.label === "VA" && /900 VA/.test(row.value)));
  assert.ok(upsRows.some((row) => row.label === "Çıkış gücü" && /540 W/.test(row.value)));

  const mouseRows = buildSpecRows({
    brand: "Logitech",
    name: "Logitech G502 Hero 25600 DPI Kablosuz Gaming Mouse",
  });
  assert.ok(mouseRows.some((row) => row.label === "Tip" && /Mouse/i.test(row.value)));
  assert.ok(mouseRows.some((row) => row.label === "DPI" && /25600/.test(row.value)));
});

test("buildSpecRows pads sparse titles to minimum content rows", () => {
  const rows = buildSpecRows({
    brand: "Patygo",
    name: "Patygo USB-C Kablo 1 Metre",
  });
  const meta = new Set(["barkod", "marka", "üretici kodu", "model"]);
  const contentCount = rows.filter(
    (row) => !meta.has(row.label.toLocaleLowerCase("tr-TR"))
  ).length;
  assert.ok(contentCount >= 4, "expected at least 4 content rows");
  assert.ok(rows.some((row) => row.label === "Ürün tipi"));
});

test("sparse products get expanded spec table on enrich", () => {
  const enriched = enrichProductCopy({
    brand: "CANON",
    name: "Canon CRG-070 Siyah Toner",
    description: "Canon CRG-070 orijinal siyah toner kartuşu.",
    details: "__SPEC_TABLE__\nMarka|Canon\nBarkod|123",
  });
  assert.match(enriched.details, /^__SPEC_TABLE__/);
  const lines = enriched.details.split("\n").filter((line) => line.includes("|") && !line.startsWith("__"));
  assert.ok(lines.length >= 4, "toner table should have at least 4 rows");
  assert.match(enriched.details, /Renk\|Siyah/);
});

test("verify-all-product-specs content row counter treats meta labels separately", () => {
  const { parseProductDetailSpecTable } = require("../lib/product-detail-specs");
  const rows = parseProductDetailSpecTable(
    "__SPEC_TABLE__\nÜrün tipi|Monitör\nÇözünürlük|1920x1080\nMarka|HP\nBarkod|1"
  );
  const meta = new Set(["barkod", "marka", "üretici kodu", "model"]);
  const content = rows.filter((row) => !meta.has(row.label.toLocaleLowerCase("tr-TR"))).length;
  assert.equal(content, 2);
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
  assert.match(xmlLike.details, /^__SPEC_TABLE__/);

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

test("enrichProductCopy replaces title-duplicate XML details with spec table", () => {
  const title =
    "Intel Core i3-10100 Soket 1200 3.6GHz 6MB Önbellek 4 Çekirdek UHD630 İşlemci";
  const enriched = enrichProductCopy({
    brand: "INTEL",
    name: title,
    description: title,
    details: title,
  });
  assert.match(enriched.details, /^__SPEC_TABLE__/);
  assert.match(enriched.description, /katalog bilgisinden/i);
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
