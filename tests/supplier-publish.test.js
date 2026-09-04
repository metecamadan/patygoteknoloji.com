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

  // active + kategori atanmış ürün havuzda kalmaz; aktif listeden doğrula.
  const pool = await fetch(baseUrl + "/api/admin/supplier/products?status=pool", { headers });
  const poolBody = await pool.json();
  assert.equal(
    poolBody.products.find((item) => item.supplierSku === "CPU-1"),
    undefined,
    "yayınlanan ürün havuzda kalmamalı"
  );

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
