const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");
const { writeCachedRates } = require("../lib/fx");
const { unzipEntries, sheetObjects } = require("./helpers/unzip");
const { mirrorPaths } = require("../lib/product-image-mirror");

test("Barkodsuz Ürünler lists barcode-less XML products; a panel barcode takes them to Akakçe", async (t) => {
  const password = "test-admin-password";
  const { baseUrl, dataRoot } = await spawnTestServer(t, {
    ADMIN_PASSWORD: password,
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });
  const runtime = path.join(dataRoot, ".runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const cpu = (sku, extra) =>
    Object.assign(
      {
        supplierSku: sku,
        id: "sup-" + sku.toLowerCase(),
        name: "Intel Core " + sku,
        brand: "INTEL",
        costPrice: 70,
        stockQty: 4,
        image: "https://cdn.example/" + sku.toLowerCase() + ".jpg",
        barcode: "",
        manufacturerCode: "I3-" + sku,
        gtipCode: "84.73.30.00.00.00",
        mainCategory: "OEM &amp; ÇEVRE BİRİMLERİ",
        midCategory: "İşlemciler",
        subCategory: "Intel İşlemciler",
        currency: "USD",
        vatPercent: 20,
        unit: "ADET",
        category: "bilgisayar",
      },
      extra || {}
    );
  fs.writeFileSync(
    path.join(runtime, "supplier-cache.json"),
    JSON.stringify([
      cpu("NOBC-1", { stockQty: 9 }),
      cpu("NOBC-2", { stockQty: 0 }),
      cpu("NOBC-3", { stockQty: 2 }),
      cpu("HASBC-1", { barcode: "8690000000005" }),
    ])
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({ globalMarginPercent: 15, lastFetchStatus: "ok", lastSuccessfulFetchAt: new Date().toISOString(), itemCount: 4 })
  );
  writeCachedRates(dataRoot, { USD: 40, EUR: 46, fetchedAt: new Date().toISOString(), source: "test" });
  // Akakçe only takes mirrored images.
  const mediaDir = mirrorPaths(dataRoot).mediaDir;
  fs.mkdirSync(mediaDir, { recursive: true });
  const mirrored = "1".repeat(28) + ".jpg";
  fs.writeFileSync(path.join(mediaDir, mirrored), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const imageUrl = "https://cdn.example/nobc-1.jpg";
  fs.writeFileSync(
    path.join(runtime, "catalog-image-mirror.json"),
    JSON.stringify({ version: 1, entries: { [imageUrl]: { sourceUrl: imageUrl, file: mirrored, publicPath: "/media/catalog/" + mirrored, placeholder: false } } })
  );

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const session = await login.json();
  const headers = { Authorization: "Bearer " + session.token, "Content-Type": "application/json" };
  const published = await fetch(baseUrl + "/api/admin/supplier/publish", {
    method: "POST",
    headers,
    body: JSON.stringify({ slotId: "supplier-1" }),
  });
  assert.equal(published.status, 200);

  const list = async (query) => {
    const res = await fetch(baseUrl + "/api/admin/supplier/products?status=nobarcode&" + query, { headers });
    assert.equal(res.status, 200);
    return (await res.json()).products;
  };

  const waiting = await list("barcode=waiting&stock=1");
  assert.deepEqual(
    waiting.map((item) => item.supplierSku),
    ["NOBC-1", "NOBC-3"],
    "in stock only, biggest stock first; products with an XML barcode are not listed"
  );
  assert.ok(waiting[0].feedIssues.includes("Barkod eksik"));
  assert.equal(waiting[0].feedReady, false);
  assert.deepEqual(
    (await list("barcode=waiting&stock=")).map((item) => item.supplierSku),
    ["NOBC-1", "NOBC-3", "NOBC-2"],
    "Stoksuzlar dahil adds the out-of-stock row"
  );

  const patched = await fetch(baseUrl + "/api/admin/supplier/products", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ updates: [{ supplierSku: "NOBC-1", supplierSlot: "supplier-1", barcode: "4006381333931" }] }),
  });
  assert.equal(patched.status, 200, (await patched.json()).error || "patch");

  assert.deepEqual((await list("barcode=waiting&stock=1")).map((item) => item.supplierSku), ["NOBC-3"]);
  const added = await list("barcode=added&stock=1");
  assert.deepEqual(added.map((item) => [item.supplierSku, item.barcode, item.xmlBarcode]), [["NOBC-1", "4006381333931", ""]]);
  assert.equal(added[0].feedReady, true, "with a barcode nothing else blocks Akakçe: " + added[0].feedIssues.join(", "));
  assert.deepEqual(
    (await list("barcode=&stock=1")).map((item) => item.supplierSku),
    ["NOBC-1", "NOBC-3"],
    "Tümü keeps the panel-barcoded row next to the waiting ones"
  );

  const feed = await (await fetch(baseUrl + "/api/feeds/akakce.xml")).text();
  assert.match(feed, /4006381333931/, "the panel barcode reaches the Akakçe feed");

  const res = await fetch(baseUrl + "/api/admin/export", {
    method: "POST",
    headers,
    body: JSON.stringify({ tab: "nobarcode", query: "barcode=waiting&stock=" }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /patygo-barkodsuz-urunler-\d{8}-\d{4}\.xlsx/);
  assert.equal(res.headers.get("x-export-rows"), "2");
  const rows = sheetObjects(unzipEntries(Buffer.from(await res.arrayBuffer()))["xl/worksheets/sheet1.xml"]);
  assert.deepEqual(rows.map((row) => row["Stok kodu"]), ["NOBC-3", "NOBC-2"]);
});
