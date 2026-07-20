const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSupplierXml, isPrivateIp } = require("../lib/supplier");
const { buildAkakceXml } = require("../lib/akakce");

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
