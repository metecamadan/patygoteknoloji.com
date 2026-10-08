const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnTestServer } = require("./helpers/spawn-server");
const { writeCachedRates } = require("../lib/fx");

test("Görselsiz Ürünler lists imageless XML products and publishes them with a panel image", async (t) => {
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
        barcode: "8690000000001",
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
  const broken = "https://cdn.example/broken.jpg";
  fs.writeFileSync(
    path.join(runtime, "supplier-cache.json"),
    JSON.stringify([
      cpu("NOIMG-1"),
      cpu("BROKEN-1", { image: broken }),
      cpu("FRESH-1", { image: "https://cdn.example/fresh.jpg" }),
    ])
  );
  fs.writeFileSync(
    path.join(runtime, "supplier-settings.json"),
    JSON.stringify({ globalMarginPercent: 15, lastFetchStatus: "ok", lastSuccessfulFetchAt: new Date().toISOString(), itemCount: 3 })
  );
  fs.writeFileSync(
    path.join(runtime, "catalog-image-mirror-failures.json"),
    JSON.stringify({ version: 1, entries: { [broken]: { status: 404, failedAt: new Date().toISOString() } } })
  );
  writeCachedRates(dataRoot, { USD: 40, EUR: 46, fetchedAt: new Date().toISOString(), source: "test" });

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const session = await login.json();
  const headers = { Authorization: "Bearer " + session.token, "Content-Type": "application/json" };
  const list = async (image) => {
    const res = await fetch(
      baseUrl + "/api/admin/supplier/products?status=noimage&sort=sku&dir=asc&image=" + image,
      { headers }
    );
    assert.equal(res.status, 200);
    return (await res.json()).products;
  };

  const waiting = await list("waiting");
  assert.deepEqual(
    waiting.map((item) => [item.supplierSku, item.xmlImageState]),
    [["BROKEN-1", "broken"], ["NOIMG-1", "missing"]],
    "untried XML image (FRESH-1) is not imageless"
  );

  const own = "/assets/img/products/noimg-1.jpg";
  const patched = await fetch(baseUrl + "/api/admin/supplier/products", {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      updates: [
        {
          supplierSku: "NOIMG-1",
          supplierSlot: "supplier-1",
          images: [own],
          siteParent: "bilgisayar-bilesenleri",
          siteMid: "islemciler",
          siteChild: "intel-islemciler",
          siteCategoryManual: true,
          active: true,
        },
      ],
    }),
  });
  assert.equal(patched.status, 200, (await patched.json()).error || "patch");

  assert.deepEqual((await list("waiting")).map((item) => item.supplierSku), ["BROKEN-1"]);
  const added = await list("added");
  assert.deepEqual(added.map((item) => [item.supplierSku, item.active, item.images[0]]), [["NOIMG-1", true, own]]);
  assert.deepEqual((await list("")).map((item) => item.supplierSku), ["BROKEN-1", "NOIMG-1"]);

  // ?id= reads the storefront index; page 1 without filters may still be the bootstrap snapshot
  // written before the PATCH (rewritten by a background warm).
  const lookup = async (id) => (await (await fetch(baseUrl + "/api/products?id=" + id)).json()).products;
  const shown = (await lookup("sup-noimg-1"))[0];
  assert.ok(shown, "published imageless product reaches the storefront with its panel image");
  assert.match(shown.image, /noimg-1\.jpg$/);
});
