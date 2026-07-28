const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeCatalogProducts } = require("../lib/catalog");

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
    { includeInactiveManual: false }
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
    details: "Detay",
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
    brand: "TEDARİKÇİ",
    name: "Ürün",
    price: 200,
    category: "bilgisayar",
    description: "Açıklama",
    details: "Detay",
    image: "https://cdn.example/a.jpg",
    images: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    featured: false,
    active: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(publicProduct, "source"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(publicProduct, "costPrice"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(publicProduct, "supplierSku"), false);
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
        category: "bilgisayar",
        active: true,
      },
    ]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "manual");
});
