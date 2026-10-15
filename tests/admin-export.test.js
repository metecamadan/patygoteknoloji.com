const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");
const { writeCachedRates } = require("../lib/fx");
const { unzipEntries, sheetObjects } = require("./helpers/unzip");

function supplierRow(overrides) {
  return Object.assign(
    {
      brand: "INTEL",
      costPrice: 70,
      stockQty: 9,
      image: "http://cdn.example/cpu.jpg",
      barcode: "8690000000001",
      manufacturerCode: "I3",
      mainCategory: "OEM &amp; ÇEVRE BİRİMLERİ",
      midCategory: "İşlemciler",
      subCategory: "Intel İşlemciler",
      currency: "USD",
      vatPercent: 20,
      unit: "ADET",
      category: "bilgisayar",
    },
    overrides
  );
}

test("Ürünler tabs download as Excel with the on-screen filter applied", async (t) => {
  const password = "test-admin-password";
  const { baseUrl, dataRoot } = await spawnTestServer(t, {
    ADMIN_PASSWORD: password,
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });
  const runtime = path.join(dataRoot, ".runtime");
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(
    path.join(runtime, "supplier-cache.json"),
    JSON.stringify([
      supplierRow({ supplierSku: "CPU-1", id: "sup-cpu-1", name: "Intel Core i3" }),
      supplierRow({ supplierSku: "CPU-2", id: "sup-cpu-2", name: "Intel Core i5", costPrice: 100 }),
    ])
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({
      globalMarginPercent: 3,
      criticalStockQty: 3,
      lastFetchStatus: "ok",
      lastSuccessfulFetchAt: new Date().toISOString(),
      itemCount: 2,
    })
  );
  writeCachedRates(dataRoot, { USD: 40, EUR: 46, fetchedAt: new Date().toISOString(), source: "test" });
  fs.mkdirSync(path.join(dataRoot, "assets", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(dataRoot, "assets", "data", "products.json"),
    JSON.stringify([
      { id: "kahve-1", name: "Filtre Kahve", brand: "CAYKUR", price: 100, vatPercent: 10, stockQty: 5, category: "kucuk-ev" },
      { id: "cay-1", name: "Siyah Çay", brand: "CAYKUR", price: 50, vatPercent: 10, stockQty: 2, category: "kucuk-ev" },
    ])
  );

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { Authorization: "Bearer " + session.token, "Content-Type": "application/json" };

  const published = await fetch(baseUrl + "/api/admin/supplier/publish", {
    method: "POST",
    headers,
    body: JSON.stringify({ slotId: "supplier-1" }),
  });
  assert.equal(published.status, 200);

  const download = async (body) => {
    const res = await fetch(baseUrl + "/api/admin/export", { method: "POST", headers, body: JSON.stringify(body) });
    if (res.status !== 200) return { status: res.status, error: (await res.json()).error };
    assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const files = unzipEntries(Buffer.from(await res.arrayBuffer()));
    return {
      status: 200,
      disposition: res.headers.get("content-disposition"),
      count: Number(res.headers.get("x-export-rows")),
      rows: sheetObjects(files["xl/worksheets/sheet1.xml"]),
    };
  };

  const all = await download({ tab: "xml", query: "page=1&limit=1&sort=price&dir=desc" });
  assert.equal(all.status, 200);
  assert.match(all.disposition, /^attachment; filename="patygo-xml-urunleri-\d{8}-\d{4}\.xlsx"$/);
  assert.equal(all.count, 2, "export ignores paging and returns every filtered row");
  assert.deepEqual(all.rows.map((row) => row["Stok kodu"]), ["CPU-2", "CPU-1"]);
  const i3 = all.rows.find((row) => row["Stok kodu"] === "CPU-1");
  assert.equal(i3["Maliyet (TL)"], "2800");
  assert.equal(i3["Uygulanan marj %"], "3");
  assert.equal(i3["Satış fiyatı (KDV hariç)"], "2884");
  assert.equal(i3["Satış fiyatı (KDV dahil)"], "3460.8");
  assert.equal(i3["Panel durumu"], "Aktif");
  assert.equal(i3["Site durumu"], "Satışta");
  assert.match(i3["Site linki"], /^https?:\/\/[^/]+\/[a-z0-9-]+\/[a-z0-9-]+$/);

  const searched = await download({ tab: "xml", query: "q=i5" });
  assert.deepEqual(searched.rows.map((row) => row["Stok kodu"]), ["CPU-2"]);

  const unlisted = await download({ tab: "unlisted", query: "reason=&stock=1&q=" });
  assert.equal(unlisted.status, 200);
  assert.equal(unlisted.count, 0);
  assert.ok(unlisted.rows.length === 0);

  const manual = await download({ tab: "manual", ids: ["cay-1"] });
  assert.equal(manual.count, 1);
  assert.equal(manual.rows[0]["Ürün kodu"], "cay-1");
  assert.equal(manual.rows[0]["Fiyat (KDV dahil)"], "55");

  const alerts = await download({ tab: "alerts-price" });
  if (alerts.status === 200) {
    assert.equal(alerts.count, 0);
  } else {
    assert.equal(alerts.status, 500);
    assert.match(alerts.error, /Alarm modülü/);
  }

  const unknown = await download({ tab: "orders" });
  assert.equal(unknown.status, 422);

  const anonymous = await fetch(baseUrl + "/api/admin/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab: "xml" }),
  });
  assert.equal(anonymous.status, 401);
});
