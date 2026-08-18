const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");
const { writeCachedRates } = require("../lib/fx");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adminHeaders(baseUrl, password) {
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  return {
    Authorization: "Bearer " + session.token,
    "Content-Type": "application/json",
  };
}

test("supplier margin settings refresh storefront prices without XML fetch", async (t) => {
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
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({ globalMarginPercent: 15, lastFetchStatus: "ok", itemCount: 1 }, null, 2)
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-overrides.json"),
    JSON.stringify(
      {
        "CPU-1": {
          active: true,
          siteParent: "bilgisayar-bilesenleri",
          siteMid: "islemciler",
          siteChild: "intel-islemciler",
        },
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

  const headers = await adminHeaders(baseUrl, password);

  const before = await fetch(baseUrl + "/api/products?page=1&limit=48");
  const beforeBody = await before.json();
  assert.equal(before.status, 200);
  const cpuBefore = beforeBody.products.find((item) => item.id === "sup-cpu-1");
  assert.ok(cpuBefore);
  assert.equal(cpuBefore.price, 3220);

  const saved = await fetch(baseUrl + "/api/admin/supplier/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({ slotId: "supplier-1", globalMarginPercent: 45 }),
  });
  const savedBody = await saved.json();
  assert.equal(saved.status, 200, savedBody.error || "settings");
  assert.equal(savedBody.settings.globalMarginPercent, 45);

  await sleep(600);

  const after = await fetch(baseUrl + "/api/products?page=1&limit=48");
  const afterBody = await after.json();
  assert.equal(after.status, 200);
  const cpuAfter = afterBody.products.find((item) => item.id === "sup-cpu-1");
  assert.ok(cpuAfter);
  assert.equal(cpuAfter.price, 4060);
});
