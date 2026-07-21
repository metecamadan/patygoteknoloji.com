const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSupplierXml, isPrivateIp } = require("../lib/supplier");
const { analyzeAkakceProducts, buildAkakceFeedSummary, buildAkakceXml } = require("../lib/akakce");

test("supplier XML products are normalized", () => {
  const xml = `<?xml version="1.0"?>
    <catalog>
      <products>
        <product>
          <StokKodu>ABC-100</StokKodu>
          <UrunAdi>Test Bilgisayar</UrunAdi>
          <Marka>Örnek</Marka>
          <Fiyat>12.345,50</Fiyat>
          <Stok>7</Stok>
          <Kategori>Bilgisayar</Kategori>
          <ResimUrl>/images/test.jpg</ResimUrl>
        </product>
      </products>
    </catalog>`;
  const products = parseSupplierXml(xml, new URL("https://supplier.example/feed.xml"));
  assert.equal(products.length, 1);
  assert.equal(products[0].supplierSku, "ABC-100");
  assert.equal(products[0].costPrice, 12345.5);
  assert.equal(products[0].stockQty, 7);
  assert.equal(products[0].image, "https://supplier.example/images/test.jpg");
});

test("broken supplier XML is rejected without changing data", () => {
  assert.throws(
    () =>
      parseSupplierXml(
        "<catalog><products><product><name>Eksik",
        new URL("https://supplier.example/feed.xml")
      ),
    /ürün listesi|XML/i
  );
});

test("private network addresses are rejected", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.2.3.4"), true);
  assert.equal(isPrivateIp("192.168.1.10"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("::1"), true);
});

test("Akakce feed escapes text and includes VAT", () => {
  const xml = buildAkakceXml(
    [
      {
        id: "test-1",
        name: "Ekran & Klavye <Set>",
        brand: "PATYGO",
        category: "bilgisayar",
        description: 'Kurumsal "set"',
        price: 100,
        image: "assets/img/test.jpg",
        active: true,
        source: "manual",
      },
      { id: "hidden", name: "Gizli", price: 10, active: false },
    ],
    {
      siteBaseUrl: "https://patygoteknoloji.com",
      vatRate: 0.2,
      generatedAt: "2026-07-20T00:00:00.000Z",
    }
  );
  assert.match(xml, /<price>120\.00<\/price>/);
  assert.match(xml, /Ekran &amp; Klavye &lt;Set&gt;/);
  assert.match(xml, /Kurumsal &quot;set&quot;/);
  assert.doesNotMatch(xml, /Gizli/);
});

test("Akakce feed excludes out-of-stock and incomplete products with diagnostics", () => {
  const products = [
    {
      id: "ready",
      supplierSku: "READY-1",
      name: "Hazır Ürün",
      brand: "PATYGO",
      category: "bilgisayar",
      price: 100,
      image: "https://cdn.example/ready.jpg",
      stockQty: 3,
      active: true,
      source: "supplier",
    },
    {
      id: "no-stock",
      supplierSku: "NO-STOCK",
      name: "Stoksuz Ürün",
      brand: "PATYGO",
      category: "bilgisayar",
      price: 100,
      image: "https://cdn.example/no-stock.jpg",
      stockQty: 0,
      active: true,
      source: "supplier",
    },
    {
      id: "no-image",
      name: "Görselsiz Ürün",
      brand: "PATYGO",
      category: "bilgisayar",
      price: 100,
      active: true,
      source: "manual",
    },
  ];
  const analysis = analyzeAkakceProducts(products, {
    siteBaseUrl: "https://patygoteknoloji.com",
  });
  assert.equal(analysis.eligible.length, 1);
  assert.equal(analysis.excluded.length, 2);
  assert.deepEqual(
    analysis.excluded.map((item) => item.reasons[0]).sort(),
    ["Görsel eksik", "Stok yok"]
  );
  assert.equal(analysis.reasonCounts["Görsel eksik"], 1);
  assert.equal(analysis.reasonCounts["Stok yok"], 1);

  const summary = buildAkakceFeedSummary(products, {
    siteBaseUrl: "https://patygoteknoloji.com",
  });
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.excludedCount, 2);
  assert.equal(summary.catalogActiveCount, 3);
  assert.equal(summary.publicUrl, "https://patygoteknoloji.com/api/feeds/akakce.xml");
  assert.equal(summary.reasonCounts["Görsel eksik"], 1);

  const xml = buildAkakceXml(products, {
    siteBaseUrl: "https://patygoteknoloji.com",
    vatRate: 0.2,
  });
  assert.match(xml, /Hazır Ürün/);
  assert.doesNotMatch(xml, /Stoksuz Ürün|Görselsiz Ürün/);
});
