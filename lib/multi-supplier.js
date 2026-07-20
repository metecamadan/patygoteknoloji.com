const { createSupplierStore } = require("./supplier");

function createMultiSupplierManager(root, options) {
  const settings = options || {};
  const slotDefinitions = (settings.slots || []).slice(0, 3);
  if (!slotDefinitions.length) {
    throw new Error("En az bir XML kaynağı tanımlanmalıdır.");
  }
  const slots = slotDefinitions.map((definition, index) => {
    const id = String(definition.id || "supplier-" + (index + 1));
    const store = createSupplierStore(
      root,
      Object.assign(
        {
          filePrefix: index === 0 ? "supplier" : "supplier-" + (index + 1),
          defaultName: "XML Kaynağı " + (index + 1),
          defaultMarginPercent: settings.defaultMarginPercent,
          allowedHosts: settings.allowedHosts,
        },
        definition
      )
    );
    return { id, index, store };
  });
  const byId = new Map(slots.map((slot) => [slot.id, slot]));

  function getSlot(slotId) {
    const slot = byId.get(String(slotId || ""));
    if (!slot) throw new Error("XML kaynağı bulunamadı.");
    return slot;
  }

  function listSlots() {
    return slots.map((slot) => Object.assign({ id: slot.id }, slot.store.status()));
  }

  async function saveConfig(slotId, config) {
    const slot = getSlot(slotId);
    return slot.store.saveUrl(config && config.url, config && config.name);
  }

  async function refresh(slotId) {
    const slot = getSlot(slotId);
    const result = await slot.store.refresh();
    return Object.assign({ slotId: slot.id }, result);
  }

  function setGlobalMargin(slotId, value) {
    return getSlot(slotId).store.setGlobalMargin(value);
  }

  function listProducts() {
    return slots.flatMap((slot) => {
      const status = slot.store.status();
      return slot.store.listProducts().map((item) =>
        Object.assign({}, item, {
          id: slot.index === 0 ? item.id : slot.id + "-" + item.id,
          supplierSlot: slot.id,
          supplierName: status.name,
        })
      );
    });
  }

  function updateProducts(updates) {
    const grouped = new Map();
    for (const update of updates || []) {
      const slotId = String(update.supplierSlot || "supplier-1");
      getSlot(slotId);
      if (!grouped.has(slotId)) grouped.set(slotId, []);
      grouped.get(slotId).push(update);
    }
    for (const [slotId, slotUpdates] of grouped) {
      getSlot(slotId).store.updateOverrides(slotUpdates);
    }
    return listProducts();
  }

  return {
    listSlots,
    saveConfig,
    refresh,
    setGlobalMargin,
    listProducts,
    updateProducts,
  };
}

module.exports = { createMultiSupplierManager };
