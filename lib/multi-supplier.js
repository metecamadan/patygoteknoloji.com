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

  function setSettings(slotId, patch) {
    return getSlot(slotId).store.setSettings(patch);
  }

  function markScheduledFetch(slotId, key) {
    return getSlot(slotId).store.markScheduledFetch(key);
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

  function queryProducts(options) {
    const opts = options || {};
    const all = listProducts();
    const query = String(opts.q || "")
      .trim()
      .toLocaleLowerCase("tr-TR");
    const status = String(opts.status || "");
    const slotId = String(opts.slot || "");
    const filtered = all.filter((item) => {
      const haystack = [item.supplierSku, item.name, item.brand, item.supplierName]
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      if (query && !haystack.includes(query)) return false;
      if (slotId && item.supplierSlot !== slotId) return false;
      if (status === "active" && !item.active) return false;
      if (status === "inactive" && item.active) return false;
      if (status === "stock" && !(item.stockQty === null || Number(item.stockQty) > 0)) {
        return false;
      }
      if (status === "nocat" && item.siteCategoryAssigned) return false;
      return true;
    });
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    const page = Math.min(totalPages, Math.max(1, Number(opts.page) || 1));
    const start = (page - 1) * limit;
    return {
      products: filtered.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages,
      catalogCount: all.length,
      activeCount: all.filter((item) => item.active).length,
    };
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
    setSettings,
    markScheduledFetch,
    listProducts,
    queryProducts,
    updateProducts,
  };
}

module.exports = { createMultiSupplierManager };
