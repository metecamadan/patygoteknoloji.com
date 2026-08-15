const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSupplierXml, isPrivateIp, decodeXmlBytes } = require("../lib/supplier");
const { analyzeAkakceProducts, buildAkakceFeedSummary, buildAkakceXml } = require("../lib/akakce");

function feedReadyProduct(overrides) {
  return Object.assign(
    {
      id: "ready",
      supplierSku: "READY-1",
      name: "Hazır Ürün",
      brand: "PATYGO",
      category: "bilgisayar",
      description: "Kısa açıklama",
      price: 100,
      image: "https://cdn.example/ready.jpg",
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
    },
    overrides || {}
  );
}

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
          <custom_label_1>99</custom_label_1>
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

test("bilgisayarim-style records use UrunAciklama as name and Fiyat", () => {
  const xml = `<?xml version="1.0"?>
    <Urunler>
      <Urun>
        <UrunKodu>100.10.10.0008</UrunKodu>
        <UrunAciklama>Intel Core i3 10100</UrunAciklama>
        <UrunAciklama2></UrunAciklama2>
        <UrunID>8</UrunID>
        <UreticiKodu>BX8070110100</UreticiKodu>
        <GtipCode>8473.30</GtipCode>
        <Durum>1</Durum>
        <Marka>INTEL</Marka>
        <OzelKod></OzelKod>
        <AnaKategori>Bilgisayar</AnaKategori>
        <AraKategori>İşlemci</AraKategori>
        <AltKategori>Intel</AltKategori>
        <Fiyat>70,0000</Fiyat>
        <KDV>20</KDV>
        <DovizTuru>USD</DovizTuru>
        <Stok>44</Stok>
      </Urun>
    </Urunler>`;
  const products = parseSupplierXml(xml, new URL("https://www.bilgisayarim.com.tr/feed.xml"));
  assert.equal(products.length, 1);
  assert.equal(products[0].supplierSku, "100.10.10.0008");
  assert.equal(products[0].name, "Intel Core i3 10100");
  assert.equal(products[0].costPrice, 70);
  assert.equal(products[0].stockQty, 44);
  assert.equal(products[0].brand, "INTEL");
  assert.equal(products[0].currency, "USD");
});

test("supplier XML decodes entities, prefers GorselBuyuk and upgrades http images", () => {
  const xml = `<?xml version="1.0"?>
    <Urunler>
      <Urun>
        <UrunKodu>IMG-1</UrunKodu>
        <UrunAciklama>Test işlemci</UrunAciklama>
        <AnaKategori>OEM &amp; ÇEVRE BİRİMLERİ</AnaKategori>
        <AraKategori>İşlemciler</AraKategori>
        <Fiyat>10,0000</Fiyat>
        <DovizTuru>TL</DovizTuru>
        <Stok>2</Stok>
        <GorselKucuk>http://resim.example/th.jpg</GorselKucuk>
        <GorselBuyuk>http://resim.example/big.jpg</GorselBuyuk>
      </Urun>
    </Urunler>`;
  const products = parseSupplierXml(xml, new URL("https://www.bilgisayarim.com.tr/feed.xml"));
  assert.equal(products[0].mainCategory, "OEM & ÇEVRE BİRİMLERİ");
  assert.equal(products[0].currency, "TRY");
  assert.equal(products[0].image, "https://resim.example/big.jpg");
  assert.deepEqual(products[0].images, [
    "https://resim.example/big.jpg",
    "https://resim.example/th.jpg",
  ]);
  assert.equal(products[0].description, "");
  assert.equal(products[0].category, "bilgisayar");
});

test("supplier XML expands thumbnail URLs and keeps a gallery", () => {
  const xml = `<?xml version="1.0"?>
    <Urunler>
      <Urun>
        <UrunKodu>IMG-TH</UrunKodu>
        <UrunAciklama>Intel işlemci</UrunAciklama>
        <UrunAciklama2>Kutu fanlı masaüstü işlemci.</UrunAciklama2>
        <Fiyat>10</Fiyat>
        <GorselKucuk>https://resim.example/91095_th.jpg</GorselKucuk>
      </Urun>
    </Urunler>`;
  const products = parseSupplierXml(xml, new URL("https://www.bilgisayarim.com.tr/feed.xml"));
  assert.equal(products[0].image, "https://resim.example/91095.jpg");
  assert.deepEqual(products[0].images, [
    "https://resim.example/91095.jpg",
    "https://resim.example/91095_th.jpg",
  ]);
  assert.equal(products[0].description, "Kutu fanlı masaüstü işlemci.");
});

test("supplier XML accepts Adi and BayiFiyat field names", () => {
  const xml = `<?xml version="1.0"?>
    <Stoklar>
      <Stok>
        <StokKodu>ST-9</StokKodu>
        <Adi>Ofis Mouse</Adi>
        <BayiFiyat>199,90</BayiFiyat>
      </Stok>
    </Stoklar>`;
  const products = parseSupplierXml(xml, new URL("https://supplier.example/feed.xml"));
  assert.equal(products.length, 1);
  assert.equal(products[0].supplierSku, "ST-9");
  assert.equal(products[0].name, "Ofis Mouse");
  assert.equal(products[0].costPrice, 199.9);
});

test("empty priced catalog explains detected field names", () => {
  assert.throws(
    () =>
      parseSupplierXml(
        `<?xml version="1.0"?><Urunler><Urun><StokKodu>A1</StokKodu><Not>Yok</Not></Urun><Urun><StokKodu>A2</StokKodu><Not>Yok</Not></Urun></Urunler>`,
        new URL("https://supplier.example/feed.xml")
      ),
    /Alanlar:.*StokKodu/i
  );
});

test("supplier fault XML is shown as the real error", () => {
  assert.throws(
    () =>
      parseSupplierXml(
        '<?xml version="1.0" encoding="windows-1254"?><Hata><HataAciklama>Günlük erişim sınırınız aşılmış.</HataAciklama></Hata>',
        new URL("https://supplier.example/feed.xml")
      ),
    /Günlük erişim sınırınız aşılmış/
  );
});

test("utf-8 fault XML declared as windows-1254 still reads Turkish text", () => {
  const xml = decodeXmlBytes(
    Buffer.from(
      '<?xml version="1.0" encoding="windows-1254"?><Hata><HataAciklama>Günlük erişim sınırınız aşılmış.</HataAciklama></Hata>',
      "utf8"
    )
  );
  assert.match(xml, /Günlük erişim sınırınız aşılmış/);
  assert.throws(
    () => parseSupplierXml(xml, new URL("https://supplier.example/feed.xml")),
    /Günlük erişim sınırınız aşılmış/
  );
});

test("google merchant RSS items fill the supplier pool without publishing", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
      <channel>
        <title>Avansas products</title>
        <link>https://www.avansas.com/</link>
        <item>
          <g:id>73213</g:id>
          <title>Mühlen Sage MT-402</title>
          <g:brand>Mühlen</g:brand>
          <g:price>2524,00 TRY</g:price>
          <g:availability>in stock</g:availability>
          <g:custom_label_1>195</g:custom_label_1>
          <g:image_link>https://cdnsta.avansas.com/urun/73213.jpg</g:image_link>
          <link>https://www.avansas.com/p-73213</link>
          <g:gtin>1974199720221</g:gtin>
          <g:product_type>Teknoloji &gt; Ofis Teknolojisi &gt; Kağıt Kesme Makinesi</g:product_type>
          <description>Giyotin</description>
        </item>
        <item>
          <g:id>50129</g:id>
          <title>Çaykur Tiryaki 1000 g</title>
          <g:brand>Çaykur</g:brand>
          <g:price>389,90</g:price>
          <g:availability>out of stock</g:availability>
          <g:image_link>https://cdnsta.avansas.com/urun/50129.jpg</g:image_link>
        </item>
      </channel>
    </rss>`;
  const products = parseSupplierXml(
    xml,
    new URL("https://cdnsta.avansas.com/export/google/product/merchant.xml")
  );
  assert.equal(products.length, 2);
  assert.equal(products[0].supplierSku, "73213");
  assert.equal(products[0].costPrice, 2524);
  assert.equal(products[0].stockQty, 195);
  assert.equal(products[0].currency, "TRY");
  assert.equal(products[0].barcode, "1974199720221");
  assert.equal(products[0].mainCategory, "Teknoloji");
  assert.match(products[0].image, /73213\.jpg/);
  assert.equal(products[1].stockQty, 0);
  assert.equal(products[1].costPrice, 389.9);
});

test("google merchant in-stock without quantity still maps to 1", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
      <channel>
        <item>
          <g:id>1</g:id>
          <title>Kalem</title>
          <g:brand>Test</g:brand>
          <g:price>10,00 TRY</g:price>
          <g:availability>in stock</g:availability>
          <g:image_link>https://cdnsta.avansas.com/urun/1.jpg</g:image_link>
        </item>
      </channel>
    </rss>`;
  const products = parseSupplierXml(
    xml,
    new URL("https://cdnsta.avansas.com/export/google/product/merchant.xml")
  );
  assert.equal(products[0].stockQty, 1);
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

test("Akakce feed uses Urunler schema and escapes text", () => {
  const xml = buildAkakceXml(
    [
      feedReadyProduct({
        id: "test-1",
        name: "Ekran & Klavye <Set>",
        description: 'Kurumsal "set"',
        price: 100,
        image: "assets/img/test.jpg",
        source: "manual",
        stockQty: 5,
      }),
      { id: "hidden", name: "Gizli", price: 10, active: false },
    ],
    {
      siteBaseUrl: "https://patygoteknoloji.com",
      generatedAt: "2026-07-20T00:00:00.000Z",
    }
  );
  assert.match(xml, /<Urunler>/);
  assert.match(xml, /<Urun>/);
  assert.match(xml, /<UrunUrl>https:\/\/patygoteknoloji\.com\/urun-detay\?id=test-1<\/UrunUrl>/);
  assert.match(xml, /<Fiyat>100,0000<\/Fiyat>/);
  assert.match(xml, /<KDV>20<\/KDV>/);
  assert.match(xml, /Ekran &amp; Klavye &lt;Set&gt;/);
  assert.match(xml, /Kurumsal &quot;set&quot;/);
  assert.doesNotMatch(xml, /Gizli/);
});

test("Akakce feed excludes out-of-stock and incomplete products with diagnostics", () => {
  const products = [
    feedReadyProduct(),
    feedReadyProduct({
      id: "no-stock",
      supplierSku: "NO-STOCK",
      name: "Stoksuz Ürün",
      image: "https://cdn.example/no-stock.jpg",
      stockQty: 0,
    }),
    feedReadyProduct({
      id: "no-image",
      name: "Görselsiz Ürün",
      image: "",
      images: [],
      source: "manual",
      barcode: "8690000000099",
      stockQty: 2,
    }),
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

  const summary = buildAkakceFeedSummary(products, {
    siteBaseUrl: "https://patygoteknoloji.com",
  });
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.excludedCount, 2);
  assert.equal(summary.publicUrl, "https://patygoteknoloji.com/api/feeds/akakce.xml");

  const xml = buildAkakceXml(products, {
    siteBaseUrl: "https://patygoteknoloji.com",
  });
  assert.match(xml, /Hazır Ürün/);
  assert.doesNotMatch(xml, /Stoksuz Ürün|Görselsiz Ürün/);
});

test("stale supplier catalog does not force critical-stock out of stock", () => {
  const { productStock } = require("../lib/akakce");
  assert.equal(
    productStock({
      source: "supplier",
      stockQty: 3,
      criticalStockQty: 5,
      catalogStale: true,
    }),
    3
  );
  assert.equal(
    productStock({
      source: "supplier",
      stockQty: 3,
      criticalStockQty: 5,
      catalogStale: false,
    }),
    0
  );
});

test("Akakce feed drops supplier products unread for 7 days even if last stock was positive", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const stale = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const analysis = analyzeAkakceProducts(
    [
      feedReadyProduct({
        lastSuccessfulFetchAt: now.toISOString(),
      }),
      feedReadyProduct({
        id: "old-stock",
        supplierSku: "OLD-1",
        name: "Eski Stok",
        stockQty: 20,
        catalogStale: true,
        lastSuccessfulFetchAt: stale,
      }),
    ],
    { siteBaseUrl: "https://patygoteknoloji.com", now }
  );
  assert.equal(analysis.eligible.length, 1);
  assert.equal(analysis.excluded.length, 1);
  assert.ok(analysis.excluded[0].reasons.includes("Son 7 günde stok okunamadı"));
  const xml = buildAkakceXml(
    [
      feedReadyProduct({ lastSuccessfulFetchAt: now.toISOString() }),
      feedReadyProduct({
        id: "old-stock",
        supplierSku: "OLD-1",
        name: "Eski Stok",
        stockQty: 20,
        catalogStale: true,
        lastSuccessfulFetchAt: stale,
      }),
    ],
    { siteBaseUrl: "https://patygoteknoloji.com", now }
  );
  assert.match(xml, /Hazır Ürün/);
  assert.doesNotMatch(xml, /Eski Stok/);
});
