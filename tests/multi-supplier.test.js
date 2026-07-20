const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMultiSupplierManager } = require("../lib/multi-supplier");

function xml(sku, name, price) {
  return `<?xml version="1.0"?>
  <catalog><products><product>
    <StokKodu>${sku}</StokKodu>
    <UrunAdi>${name}</UrunAdi>
    <Marka>Patygo</Marka>
    <Fiyat>${price}</Fiyat>
    <Stok>5</Stok>
    <Kategori>Bilgisayar</Kategori>
    <ResimUrl>https://cdn.example/${sku}.jpg</ResimUrl>
  </product></products></catalog>`;
}

test("three supplier slots keep configuration, products and overrides isolated", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-multi-"));
  const manager = createMultiSupplierManager(root, {
    slots: [
      {
        id: "supplier-1",
        filePrefix: "supplier",
        defaultName: "XML Kaynağı 1",
        validateUrl: async (raw) => new URL(raw),
        fetchXml: async () => xml("SKU-1", "Birinci Ürün", 100),
      },
      {
        id: "supplier-2",
        filePrefix: "supplier-2",
        defaultName: "XML Kaynağı 2",
        validateUrl: async (raw) => new URL(raw),
        fetchXml: async () => xml("SKU-1", "İkinci Ürün", 200),
      },
      {
        id: "supplier-3",
        filePrefix: "supplier-3",
        defaultName: "XML Kaynağı 3",
        validateUrl: async (raw) => new URL(raw),
        fetchXml: async () => xml("SKU-3", "Üçüncü Ürün", 300),
      },
    ],
    defaultMarginPercent: 10,
  });
  try {
    for (const slot of manager.listSlots()) {
      await manager.saveConfig(slot.id, {
        url: `https://${slot.id}.example/feed.xml?token=secret`,
        name: slot.name,
      });
      await manager.refresh(slot.id);
    }

    const products = manager.listProducts();
    assert.equal(products.length, 3);
    assert.equal(new Set(products.map((item) => item.id)).size, 3);
    assert.deepEqual(
      products.map((item) => item.supplierSlot),
      ["supplier-1", "supplier-2", "supplier-3"]
    );
    assert.ok(products.every((item) => item.active === false));

    manager.updateProducts([
      {
        supplierSlot: "supplier-2",
        supplierSku: "SKU-1",
        active: true,
        marginPercent: 25,
      },
    ]);
    const updated = manager
      .listProducts()
      .find((item) => item.supplierSlot === "supplier-2");
    assert.equal(updated.active, true);
    assert.equal(updated.salePrice, 250);
    assert.equal(
      manager
        .listProducts()
        .find((item) => item.supplierSlot === "supplier-1").active,
      false
    );

    const statuses = manager.listSlots();
    assert.equal(statuses.length, 3);
    assert.ok(statuses.every((slot) => slot.configured));
    assert.doesNotMatch(JSON.stringify(statuses), /secret/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unknown supplier slots are rejected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-multi-unknown-"));
  const manager = createMultiSupplierManager(root, {
    slots: [{ id: "supplier-1", filePrefix: "supplier" }],
  });
  try {
    assert.throws(
      () => manager.updateProducts([{ supplierSlot: "supplier-9", supplierSku: "X" }]),
      /XML kaynağı bulunamadı/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
