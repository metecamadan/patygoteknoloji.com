const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeCatalogProducts } = require("../lib/catalog");
const { TEST_SITE_CATEGORIES } = require("./helpers/site-categories");

test("manual and active supplier products form one public catalog", () => {
  const result = mergeCatalogProducts(
    [
      {
        id: "manual-1",
        name: "Manuel Ürün",
        brand: "PATYGO",
        price: 100,
        category: "bilgisayar",
        active: true,
      },
      {
        id: "manual-hidden",
        name: "Gizli Ürün",
        brand: "PATYGO",
        price: 50,
        category: "bilgisayar",
        active: false,
      },
    ],
    [
      {
        id: "sup-1",
        supplierSku: "SUP-1",
        name: "Tedarikçi Ürünü",
        brand: "TEDARİKÇİ",
        salePrice: 200,
        costPrice: 150,
        stockQty: 5,
        category: "bilgisayar",
        image: "https://cdn.example/sup-1.jpg",
        active: true,
        siteParent: "oem-cevre-birimleri",
        siteChild: "notebook",
      },
      {
        id: "sup-hidden",
        supplierSku: "SUP-2",
        name: "Pasif Tedarikçi Ürünü",
        brand: "TEDARİKÇİ",
        salePrice: 250,
        category: "bilgisayar",
        active: false,
      },
    ],
    { includeInactiveManual: false, categories: TEST_SITE_CATEGORIES }
  );

  assert.deepEqual(
    result.map((item) => [item.id, item.source, item.price]),
    [
      ["manual-1", "manual", 100],
      ["sup-1", "supplier", 200],
    ]
  );
  assert.equal(result[1].supplierSku, "SUP-1");
  assert.equal(result[1].stockQty, 5);
});

test("toPublicProduct strips supplier internals and cost", () => {
  const { toPublicProduct } = require("../lib/catalog");
  const publicProduct = toPublicProduct({
    id: "sup-1",
    brand: "TEDARİKÇİ",
    name: "Ürün",
    price: 200,
    category: "bilgisayar",
    description: "Açıklama",
    details: "Detay metni vitrinde özellik tablosu yerine korunur: " + "x".repeat(80),
    image: "https://cdn.example/a.jpg",
    images: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    featured: false,
    active: true,
    source: "supplier",
    supplierSku: "SUP-1",
    barcode: "869000",
    stockQty: 5,
    costPrice: 150,
  });
  assert.deepEqual(publicProduct, {
    id: "sup-1",
    brand: "Tedarikçi",
    name: "Tedarikçi Ürün",
    price: 200,
    vatPercent: 20,
    category: "bilgisayar",
    mid: "",
    alt: "",
    description: "Açıklama",
    details: "Detay metni vitrinde özellik tablosu yerine korunur: " + "x".repeat(80),
    image: "https://cdn.example/a.jpg",
    images: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    featured: false,
    active: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(publicProduct, "source"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(publicProduct, "costPrice"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(publicProduct, "supplierSku"), false);
});

test("list catalog omits details while id lookup keeps full copy", () => {
  const { queryPublicCatalog, toPublicProduct } = require("../lib/catalog");
  const longDetails = "D".repeat(400);
  const products = [
    {
      id: "p1",
      brand: "HP",
      name: "Notebook",
      price: 100,
      category: "bilgisayar-tablet",
      description: "Kısa özet",
      details: longDetails,
      images: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg", "https://cdn.example/c.jpg"],
      active: true,
    },
  ];
  const listed = queryPublicCatalog(products, { limit: 48 });
  assert.equal(listed.products[0].details, undefined);
  assert.equal(listed.products[0].description, "Kısa özet");
  assert.equal(listed.products[0].images.length, 2);
  const one = queryPublicCatalog(products, { id: "p1" });
  assert.equal(one.products[0].details, longDetails);
  const compact = toPublicProduct(products[0], { compact: true });
  assert.equal(compact.details, undefined);
  assert.ok(compact.description.length <= 160);
});

test("supplier IDs cannot overwrite manual products", () => {
  const result = mergeCatalogProducts(
    [
      {
        id: "same-id",
        name: "Manuel",
        brand: "PATYGO",
        price: 100,
        category: "bilgisayar",
        active: true,
      },
    ],
    [
      {
        id: "same-id",
        supplierSku: "SUP-1",
        name: "Tedarikçi",
        brand: "TEDARİKÇİ",
        salePrice: 200,
        stockQty: 4,
        category: "bilgisayar",
        active: true,
        siteParent: "oem-cevre-birimleri",
        siteChild: "notebook",
      },
    ],
    { categories: TEST_SITE_CATEGORIES }
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "manual");
});

test("active supplier products without site category stay off the public catalog", () => {
  const result = mergeCatalogProducts(
    [],
    [
      {
        id: "sup-1",
        supplierSku: "SUP-1",
        name: "Kategorisiz",
        brand: "TEDARİKÇİ",
        salePrice: 200,
        category: "bilgisayar",
        active: true,
      },
      {
        id: "sup-2",
        supplierSku: "SUP-2",
        name: "Kategorili",
        brand: "TEDARİKÇİ",
        salePrice: 220,
        stockQty: 4,
        category: "bilgisayar",
        active: true,
        siteParent: "oem-cevre-birimleri",
        siteChild: "notebook",
      },
    ],
    { categories: TEST_SITE_CATEGORIES }
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["sup-2"]
  );
  assert.equal(result[0].category, "oem-cevre-birimleri");
  assert.equal(result[0].siteChild, "notebook");
});

test("supplier out of stock and unread stock in last 7 days stay off the public catalog", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const fresh = now.toISOString();
  const stale = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const result = mergeCatalogProducts(
    [],
    [
      {
        id: "oos",
        supplierSku: "OOS",
        name: "Stoksuz",
        brand: "INTEL",
        salePrice: 200,
        stockQty: 0,
        lastSuccessfulFetchAt: fresh,
        active: true,
        siteParent: "oem-cevre-birimleri",
        siteChild: "islemciler",
      },
      {
        id: "unread",
        supplierSku: "UNREAD",
        name: "Okunamadı",
        brand: "INTEL",
        salePrice: 200,
        stockQty: 12,
        catalogStale: true,
        lastSuccessfulFetchAt: stale,
        active: true,
        siteParent: "oem-cevre-birimleri",
        siteChild: "islemciler",
      },
      {
        id: "live",
        supplierSku: "LIVE",
        name: "Stoklu",
        brand: "INTEL",
        salePrice: 200,
        stockQty: 8,
        lastSuccessfulFetchAt: fresh,
        active: true,
        siteParent: "oem-cevre-birimleri",
        siteChild: "islemciler",
      },
    ],
    { categories: TEST_SITE_CATEGORIES, now }
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["live"]
  );
});

test("toPublicProduct uses the same title format as the Akakce feed", () => {
  const { toPublicProduct } = require("../lib/catalog");
  const { formatAkakceProductName, formatAkakceBrand, buildAkakceXml } = require("../lib/akakce");
  const product = {
    id: "sup-1",
    brand: "INTEL",
    name: "INTEL CORE I3 10100 SOKET 1200 İŞLEMCİ BOX",
    price: 200,
    vatPercent: 20,
    category: "bilgisayar-bilesenleri",
    siteParent: "bilgisayar-bilesenleri",
    siteMid: "islemciler",
    siteChild: "intel-islemciler",
    description: "Açıklama",
    image: "https://cdn.example/a.jpg",
    stockQty: 5,
    active: true,
    source: "supplier",
    barcode: "8690000000001",
    lastSuccessfulFetchAt: new Date().toISOString(),
  };
  const publicProduct = toPublicProduct(product);
  assert.equal(publicProduct.brand, formatAkakceBrand(product.brand));
  assert.equal(publicProduct.name, formatAkakceProductName(product));
  assert.equal(publicProduct.name, "Intel Core i3 10100 Soket 1200 İşlemci Box");
  const xml = buildAkakceXml([product], { siteBaseUrl: "https://patygoteknoloji.com" });
  assert.match(xml, /<name>Intel Core i3 10100 Soket 1200 İşlemci Box<\/name>/);
});

test("toPublicProduct exposes site child as alt for storefront filters", () => {
  const { toPublicProduct } = require("../lib/catalog");
  const publicProduct = toPublicProduct({
    id: "sup-1",
    brand: "HP",
    name: "Notebook",
    price: 200,
    category: "oem-cevre-birimleri",
    siteChild: "notebook",
    active: true,
  });
  assert.equal(publicProduct.category, "oem-cevre-birimleri");
  assert.equal(publicProduct.alt, "notebook");
});
