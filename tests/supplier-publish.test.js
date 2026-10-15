const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");
const { writeCachedRates } = require("../lib/fx");

test("publishing XML slot 1 assigns site categories and lists products on the storefront", async (t) => {
  const password = "test-admin-password";
  const { baseUrl, dataRoot } = await spawnTestServer(t, {
    ADMIN_PASSWORD: password,
    SUPPLIER_ALLOWED_HOSTS: "supplier.example",
  });
  const runtime = path.join(dataRoot, ".runtime");
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(
    path.join(runtime, "supplier-cache.json"),
    JSON.stringify(
      [
        {
          supplierSku: "CPU-1",
          id: "sup-cpu-1",
          name: "Intel Core i3",
          brand: "INTEL",
          costPrice: 70,
          stockQty: 4,
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
      ],
      null,
      2
    )
  );
  const fetchedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify(
      {
        globalMarginPercent: 15,
        lastFetchStatus: "ok",
        lastSuccessfulFetchAt: fetchedAt,
        itemCount: 1,
      },
      null,
      2
    )
  );
  writeCachedRates(dataRoot, {
    USD: 40,
    EUR: 46,
    fetchedAt: new Date().toISOString(),
    source: "test",
  });

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
  const payload = await published.json();
  assert.equal(published.status, 200, payload.error || "publish");
  assert.equal(payload.result.assigned, 1);

  const mapped = await fetch(baseUrl + "/api/admin/supplier/products?status=active", { headers });
  const mappedBody = await mapped.json();
  const mappedCpu = mappedBody.products.find((item) => item.supplierSku === "CPU-1");
  assert.ok(mappedCpu);
  assert.equal(mappedCpu.siteParent, "bilgisayar-bilesenleri");
  assert.equal(mappedCpu.siteMid, "islemciler");
  assert.equal(mappedCpu.siteChild, "intel-islemciler");
  assert.equal(mappedCpu.active, true);

  const catalog = await fetch(baseUrl + "/api/products?page=1&limit=48");
  const body = await catalog.json();
  assert.equal(catalog.status, 200);
  assert.ok(body.total >= 1);
  const cpu = body.products.find((item) => item.id === "sup-cpu-1");
  assert.ok(cpu);
  assert.equal(cpu.price, 3220);
  assert.match(cpu.image, /^https:\/\//);
  assert.equal(cpu.category, "bilgisayar-bilesenleri");
  assert.equal(cpu.mid, "islemciler");
  assert.equal(cpu.alt, "intel-islemciler");
});

test("category margin and critical stock reprice the live storefront and report the impact", async (t) => {
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
      {
        supplierSku: "CPU-1",
        id: "sup-cpu-1",
        name: "Intel Core i3",
        brand: "INTEL",
        costPrice: 70,
        stockQty: 4,
        image: "https://cdn.example/cpu.jpg",
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
    ])
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({
      globalMarginPercent: 3,
      criticalStockQty: 0,
      lastFetchStatus: "ok",
      lastSuccessfulFetchAt: new Date().toISOString(),
      itemCount: 1,
    })
  );
  writeCachedRates(dataRoot, { USD: 40, EUR: 46, fetchedAt: new Date().toISOString(), source: "test" });

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

  const publicPrice = async () => {
    const res = await fetch(baseUrl + "/api/products?page=1&limit=48");
    const cpu = (await res.json()).products.find((item) => item.id === "sup-cpu-1");
    return cpu ? cpu.price : null;
  };
  assert.equal(await publicPrice(), 2884, "2800 TL cost × 1.03");

  const tree = (await (await fetch(baseUrl + "/api/admin/categories", { headers })).json()).categories;
  const parent = tree.find((row) => row.slug === "bilgisayar-bilesenleri");
  const mid = parent.children.find((row) => row.slug === "islemciler");
  mid.marginPercent = 8;
  const saveTree = async () => {
    const res = await fetch(baseUrl + "/api/admin/categories", {
      method: "PUT",
      headers,
      body: JSON.stringify({ categories: tree }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, body.error);
    return body;
  };
  let saved = await saveTree();
  assert.deepEqual(saved.pricing, { changed: 1, up: 1, down: 0, averagePercent: 7.8, opened: 0, closed: 0 });
  assert.equal(await publicPrice(), 3108, "3% base + 8% İşlemciler, inherited by Intel İşlemciler");

  const admin = await (await fetch(baseUrl + "/api/admin/supplier/products?status=active", { headers })).json();
  const row = admin.products.find((item) => item.supplierSku === "CPU-1");
  assert.equal(row.marginSource, "category");
  assert.equal(row.marginCategory, "İşlemciler");

  mid.children.find((leaf) => leaf.slug === "intel-islemciler").criticalStockQty = 4;
  saved = await saveTree();
  assert.equal(saved.pricing.closed, 1, "stock 4 at a category critical stock of 4 leaves the storefront");
  assert.equal(await publicPrice(), null);

  saved = await saveTree();
  assert.equal(saved.pricing, null, "saving an unchanged tree reprices nothing");

  const rejected = await fetch(baseUrl + "/api/admin/categories", {
    method: "PUT",
    headers,
    body: JSON.stringify({ categories: [Object.assign({}, parent, { marginPercent: 900 })] }),
  });
  assert.equal(rejected.status, 422);

  const settings = await fetch(baseUrl + "/api/admin/supplier/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({ slotId: "supplier-1", globalMarginPercent: 3, criticalStockQty: 0 }),
  });
  const settingsBody = await settings.json();
  assert.equal(settings.status, 200);
  assert.equal(settingsBody.pricing.changed, 0);

  mid.children.find((leaf) => leaf.slug === "intel-islemciler").criticalStockQty = null;
  await saveTree();
  assert.equal(await publicPrice(), 3108);
  const putSettings = (patch) =>
    fetch(baseUrl + "/api/admin/supplier/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify(Object.assign({ slotId: "supplier-1" }, patch)),
    });
  const buffered = await putSettings({ fxBufferPercent: 1 });
  const bufferedBody = await buffered.json();
  assert.equal(buffered.status, 200, bufferedBody.error);
  assert.equal(bufferedBody.settings.fxBufferPercent, 1);
  assert.equal(bufferedBody.pricing.changed, 1);
  assert.equal(bufferedBody.pricing.up, 1);
  assert.equal(await publicPrice(), 3139.08, "70 USD × 40 × 1.01 kur payı × 1.11");

  const tooHigh = await putSettings({ fxBufferPercent: 12 });
  assert.equal(tooHigh.status, 422);
  assert.match((await tooHigh.json()).error, /Kur payı/);
});

test("XML products endpoint sorts by Export badge across the whole catalog", async (t) => {
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
        image: "https://cdn.example/" + sku + ".jpg",
        barcode: "869000000000" + sku.slice(-1),
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
    JSON.stringify([cpu("CPU-1"), cpu("CPU-2", { barcode: "" })])
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({ globalMarginPercent: 15, lastFetchStatus: "ok", lastSuccessfulFetchAt: new Date().toISOString(), itemCount: 2 })
  );
  writeCachedRates(dataRoot, { USD: 40, EUR: 46, fetchedAt: new Date().toISOString(), source: "test" });

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
    const res = await fetch(baseUrl + "/api/admin/supplier/products?limit=50" + query, { headers });
    assert.equal(res.status, 200);
    return (await res.json()).products.map((item) => [item.supplierSku, item.feedReady ? "Hazır" : item.active ? "Eksik" : "—"]);
  };
  assert.deepEqual(await list(""), [["CPU-1", "Hazır"], ["CPU-2", "Eksik"]]);
  assert.deepEqual(await list("&sort=feed&dir=asc"), [["CPU-2", "Eksik"], ["CPU-1", "Hazır"]]);
  assert.deepEqual(await list("&sort=feed&dir=desc"), [["CPU-1", "Hazır"], ["CPU-2", "Eksik"]]);
  assert.deepEqual(await list("&status=stock&sort=feed&dir=asc"), [["CPU-2", "Eksik"], ["CPU-1", "Hazır"]]);
  assert.deepEqual(await list("&status=feedmissing"), [["CPU-2", "Eksik"]], "filter keeps only in-stock Eksik rows");
  const totals = await fetch(baseUrl + "/api/admin/supplier/products?status=feedmissing", { headers });
  assert.equal((await totals.json()).total, 1, "pager counts only Eksik rows");
});
