"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeMerchantProducts,
  toMerchantProductInput,
  buildMerchantProductInputs,
  priceToMicros,
  merchantGtin,
} = require("../lib/google-merchant");

function feedReadyProduct(overrides) {
  return Object.assign(
    {
      id: "ready",
      supplierSku: "READY-1",
      name: "Hazır Ürün",
      brand: "PATYGO",
      category: "bilgisayar-tablet",
      siteParent: "bilgisayar-tablet",
      siteMid: "tasinabilir-bilgisayarlar",
      siteChild: "notebooklar",
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
      lastSuccessfulFetchAt: new Date().toISOString(),
    },
    overrides || {}
  );
}

test("priceToMicros converts TRY gross to micros", () => {
  assert.equal(priceToMicros(120), "120000000");
  assert.equal(priceToMicros(15.99), "15990000");
  assert.equal(priceToMicros(-1), null);
});

test("merchantGtin accepts 8-14 digit barcodes only", () => {
  assert.equal(merchantGtin({ barcode: "8690000000001" }), "8690000000001");
  assert.equal(merchantGtin({ barcode: "ABC" }), "");
  assert.equal(merchantGtin({ barcode: "123" }), "");
});

test("toMerchantProductInput maps eligible product fields", () => {
  const product = feedReadyProduct();
  const input = toMerchantProductInput(product, {
    siteBaseUrl: "https://patygoteknoloji.com",
    shipPrice: 49.9,
  });
  assert.ok(input);
  assert.equal(input.offerId, "ready");
  assert.equal(input.contentLanguage, "tr");
  assert.equal(input.feedLabel, "TR");
  assert.equal(input.productAttributes.availability, "IN_STOCK");
  assert.equal(input.productAttributes.condition, "NEW");
  assert.equal(input.productAttributes.price.currencyCode, "TRY");
  assert.equal(input.productAttributes.price.amountMicros, "120000000");
  assert.equal(input.productAttributes.gtins[0], "8690000000001");
  assert.match(input.productAttributes.link, /^https:\/\/patygoteknoloji\.com\//);
  assert.equal(input.productAttributes.imageLink, "https://cdn.example/ready.jpg");
  assert.equal(input.productAttributes.shipping[0].country, "TR");
  assert.equal(input.productAttributes.shipping[0].price.amountMicros, "49900000");
  assert.ok(input.productAttributes.productTypes[0].includes("Notebook"));
});

test("buildMerchantProductInputs excludes out-of-stock like Akakçe", () => {
  const products = [
    feedReadyProduct(),
    feedReadyProduct({ id: "no-stock", stockQty: 0, barcode: "8690000000002" }),
    feedReadyProduct({ id: "bad-gtin-ok", barcode: "NOTAGTIN", stockQty: 2 }),
  ];
  // bad barcode still eligible for Akakçe (any non-empty barcode) — Merchant drops gtins field only
  const built = buildMerchantProductInputs(products, {
    siteBaseUrl: "https://patygoteknoloji.com",
  });
  assert.equal(built.eligible, 2);
  assert.equal(built.inputs.length, 2);
  const ids = built.inputs.map((row) => row.offerId).sort();
  assert.deepEqual(ids, ["bad-gtin-ok", "ready"]);
  const noGtin = built.inputs.find((row) => row.offerId === "bad-gtin-ok");
  assert.equal(noGtin.productAttributes.gtins, undefined);

  const analysis = analyzeMerchantProducts(products, {
    siteBaseUrl: "https://patygoteknoloji.com",
  });
  assert.ok(analysis.excluded.some((row) => row.id === "no-stock"));
});

test("toMerchantProductInput returns null without image or site", () => {
  assert.equal(
    toMerchantProductInput(feedReadyProduct({ image: "" }), {
      siteBaseUrl: "https://patygoteknoloji.com",
    }),
    null
  );
  assert.equal(toMerchantProductInput(feedReadyProduct(), { siteBaseUrl: "" }), null);
});
