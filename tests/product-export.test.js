const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPORT_TABS,
  columnsForTab,
  buildExportRows,
  exportFileName,
  manualAsListed,
  plainText,
} = require("../lib/product-export");

const ctx = {
  siteBaseUrl: "https://patygoteknoloji.com",
  siteState: (p) =>
    p.id === "sup-live" ? { state: "live", path: "/islemciler/intel-core-i3" } : p.id === "sup-out" ? { state: "soldout", path: "/x/y" } : { state: "", path: "" },
  categoryLabel: (p) => (p.siteParent === "bilgisayar" ? "Bilgisayar › Notebook" : ""),
};

async function rowObject(tab, item, options) {
  const columns = columnsForTab(tab, options);
  const [row] = await buildExportRows(columns, [item], ctx);
  return Object.fromEntries(columns.map((column, i) => [column.header, row[i]]));
}

test("every Ürünler tab has an export definition with unique headers", () => {
  assert.deepEqual(Object.keys(EXPORT_TABS), [
    "manual",
    "xml",
    "unlisted",
    "noimage",
    "whitebg",
    "alerts-price",
    "alerts-stock",
  ]);
  for (const tab of Object.keys(EXPORT_TABS)) {
    for (const official of [false, true]) {
      const headers = columnsForTab(tab, { official }).map((column) => column.header);
      assert.equal(new Set(headers).size, headers.length, tab + " has duplicate headers");
    }
  }
});

test("XML product row carries pricing, margin sources, stock rules, site state and Akakçe status", async () => {
  const row = await rowObject("xml", {
    id: "sup-live",
    supplierSku: "CPU-1",
    name: "Intel Core i3",
    brand: "INTEL",
    supplierName: "bilgisayarim.com.tr",
    active: true,
    stockQty: 7,
    criticalStockQty: 4,
    criticalStockSource: "category",
    criticalStockCategory: "Notebooklar",
    sourceCostPrice: 70,
    sourceCurrency: "USD",
    costPrice: 2800,
    fxReady: true,
    marginBasePercent: 3,
    categoryMarginPercent: 8,
    marginCategory: "İşlemciler",
    marginOverride: null,
    marginPercent: 11,
    marginSource: "category",
    salePriceOverride: null,
    salePrice: 3108,
    vatPercent: 20,
    barcode: "8690000000001",
    siteCategoryAssigned: true,
    siteCategoryLabel: "Bilgisayar Bileşenleri › İşlemciler",
    siteParent: "bilgisayar-bilesenleri",
    siteChild: "islemciler",
    xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
    feedReady: false,
    feedIssues: ["Barkod eksik", "GTIP kodu eksik"],
    images: ["/media/catalog/a.jpg", "https://cdn.example/b.jpg"],
    description: "<p>Hızlı&nbsp;işlemci</p><ul><li>4 çekirdek</li></ul>",
    lastSuccessfulFetchAt: "2026-10-15T13:00:00.000Z",
  });
  assert.equal(row["Stok kodu"], "CPU-1");
  assert.equal(row["Panel durumu"], "Aktif");
  assert.equal(row["Site durumu"], "Satışta");
  assert.equal(row["Site linki"], "https://patygoteknoloji.com/islemciler/intel-core-i3");
  assert.equal(row["Kritik stok"], 4);
  assert.equal(row["Kritik stok kaynağı"], "Kategori: Notebooklar");
  assert.equal(row["Maliyet (XML)"], 70);
  assert.equal(row["Maliyet (TL)"], 2800);
  assert.equal(row["Taban marj %"], 3);
  assert.equal(row["Kategori ek marj %"], 8);
  assert.equal(row["Ürüne özel marj %"], null);
  assert.equal(row["Uygulanan marj %"], 11);
  assert.equal(row["Marj kaynağı"], "Taban + kategori");
  assert.equal(row["Satış fiyatı (KDV hariç)"], 3108);
  assert.equal(row["Satış fiyatı (KDV dahil)"], 3729.6);
  assert.equal(row["Akakçe"], "Eksik");
  assert.equal(row["Akakçe eksikleri"], "Barkod eksik; GTIP kodu eksik");
  assert.equal(row["Görsel sayısı"], 2);
  assert.equal(row["Ana görsel"], "https://patygoteknoloji.com/media/catalog/a.jpg");
  assert.equal(row["Tüm görseller"], "https://patygoteknoloji.com/media/catalog/a.jpg\nhttps://cdn.example/b.jpg");
  assert.equal(row["Kısa açıklama"], "Hızlı işlemci\n4 çekirdek");
  assert.equal(row["Son XML okuma"], "15.10.2026 16:00");
  assert.equal(row["Site kategori kodu"], "bilgisayar-bilesenleri / islemciler");
});

test("unpriced FX and missing site page leave cells empty instead of inventing values", async () => {
  const row = await rowObject("unlisted", {
    id: "sup-gone",
    active: false,
    unlisted: true,
    unlistedReason: "Yanlış ürün",
    costPrice: 70,
    sourceCostPrice: 70,
    fxReady: false,
    salePrice: 0,
    vatPercent: 20,
  });
  assert.equal(row["Panel durumu"], "Pasif");
  assert.equal(row["Site durumu"], "Sitede yok");
  assert.equal(row["Site linki"], "");
  assert.equal(row["Listelenmeme nedeni"], "Listeden çıkarıldı: Yanlış ürün");
  assert.equal(row["Maliyet (TL)"], null);
  assert.equal(row["Satış fiyatı (KDV dahil)"], null);
  assert.equal(row["Akakçe"], "");
});

test("manual, no-image, image decision and alert sheets add their own columns", async () => {
  const manual = await rowObject("manual", {
    id: "kahve-1",
    name: "Kahve",
    brand: "X",
    price: 100,
    vatPercent: 10,
    stockQty: 0,
    siteParent: "bilgisayar",
    featured: true,
    active: false,
    restockedAt: "2026-10-01T09:30:00.000Z",
  });
  assert.equal(manual["Panel durumu"], "Pasif");
  assert.equal(manual["Fiyat (KDV dahil)"], 110);
  assert.equal(manual["Site kategorisi"], "Bilgisayar › Notebook");
  assert.equal(manual["Ana sayfada"], true);
  assert.equal(manual["Stoğa giriş tarihi"], "01.10.2026 12:30");

  const noImage = await rowObject("noimage", { id: "sup-x", xmlImageState: "broken" });
  assert.equal(noImage["XML görsel durumu"], "Görsel açılmıyor");

  const official = await rowObject(
    "whitebg",
    {
      image: { file: "a.jpg", status: "reverted", original: "/media/catalog/a.jpg", official: "/media/catalog/b.jpg", source: "hp.com" },
      product: { id: "sup-out", supplierSku: "HP-1", name: "HP Toner" },
    },
    { official: true }
  );
  assert.equal(official["Görsel durumu"], "Resmî görselden orijinale döndürüldü");
  assert.equal(official["Resmî görsel"], "https://patygoteknoloji.com/media/catalog/b.jpg");
  assert.equal(official["Stok kodu"], "HP-1");
  assert.equal(official["Site durumu"], "Tükendi (sayfa açık)");

  const price = await rowObject("alerts-price", {
    group: { productId: "kahve-1", name: "Kahve", state: "live", priceIncl: 110, urlPath: "/kahve/kahve-1" },
    request: { id: 7, email: "musteri@example.com", createdAt: "2026-10-10T10:00:00.000Z", basePrice: 120, targetPrice: null, status: "active", notifyCount: 0 },
    product: manualAsListed({ id: "kahve-1", name: "Kahve", price: 100, vatPercent: 10, stockQty: 3 }),
  });
  assert.equal(price["E-posta"], "musteri@example.com");
  assert.equal(price["Hedef fiyat"], "%2 düşüş");
  assert.equal(price["Talep durumu"], "Takipte");
  assert.equal(price["Ürün linki"], "https://patygoteknoloji.com/kahve/kahve-1");
  assert.equal(price["XML kaynağı"], "Manuel ürün");
  assert.equal(price["Satış fiyatı (KDV dahil)"], 110);

  const stockHeaders = columnsForTab("alerts-stock").map((column) => column.header);
  assert.ok(!stockHeaders.includes("Hedef fiyat"));
  assert.ok(stockHeaders.includes("E-posta"));
});

test("plain text and file names are Excel friendly", () => {
  assert.equal(plainText("A<br>B &amp; C<script>x</script>"), "A\nB & Cx");
  assert.equal(
    exportFileName("xml", new Date("2026-10-15T19:05:00.000Z")),
    "patygo-xml-urunleri-20261015-2205.xlsx"
  );
});
