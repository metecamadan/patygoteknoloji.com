const { createSupplierStore } = require("./supplier");
const { ensureListedProductCopy } = require("./product-description");
const { trLowerCase } = require("./tr-text");
const { normalizeSort, sortRows } = require("./list-sort");

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

  function decorateListedProduct(slot, item, displayName) {
    return Object.assign({}, item, {
      id: slot.index === 0 ? item.id : slot.id + "-" + item.id,
      supplierSlot: slot.id,
      supplierName: displayName === undefined ? slot.store.getDisplayName() : displayName,
    });
  }

  // Store rows keep identity until they change; decorated copies (and their lazily generated
  // copy) are reused so listProducts() does not clone 17k objects on every call.
  const decoratedRows = new WeakMap();
  let listMemo = { sources: null, list: null };

  function decoratedSlotRows(slot) {
    const displayName = slot.store.getDisplayName();
    return slot.store.listProducts().map((item) => {
      const hit = decoratedRows.get(item);
      if (hit && hit.supplierSlot === slot.id && hit.supplierName === displayName) return hit;
      const decorated = decorateListedProduct(slot, item, displayName);
      decoratedRows.set(item, decorated);
      return decorated;
    });
  }

  function listProducts() {
    const sources = slots.map((slot) => [slot.store.listProducts(), slot.store.getDisplayName()]);
    const same =
      listMemo.sources &&
      sources.every(
        (entry, i) => entry[0] === listMemo.sources[i][0] && entry[1] === listMemo.sources[i][1]
      );
    if (same) return listMemo.list;
    const list = slots.flatMap((slot) => decoratedSlotRows(slot));
    listMemo = { sources, list };
    return list;
  }

  async function preloadRawCachesAsync() {
    for (const slot of slots) {
      if (typeof slot.store.preloadCacheAsync === "function") {
        await slot.store.preloadCacheAsync();
      }
    }
  }

  async function preloadCachesAsync() {
    await preloadRawCachesAsync();
    for (const slot of slots) {
      if (typeof slot.store.preloadListedProductsAsync === "function") {
        await slot.store.preloadListedProductsAsync();
      }
    }
  }

  function getProductById(id) {
    const wanted = String(id || "").trim();
    if (!wanted) return null;
    for (const slot of slots) {
      const rawId =
        slot.index === 0
          ? wanted
          : wanted.startsWith(slot.id + "-")
            ? wanted.slice(slot.id.length + 1)
            : "";
      if (!rawId) continue;
      const item = slot.store.getProductById(rawId);
      if (!item) continue;
      const decorated = decorateListedProduct(slot, item);
      if (decorated.id === wanted) return ensureListedProductCopy(decorated);
    }
    return null;
  }

  // Published by the operator but its site category is not in the live menu tree, so the
  // storefront drops it; the "Listelenmeyen Ürünler" tab shows these next to manual unlists.
  function isMenuMissing(item) {
    return item.active === true && item.unlisted !== true && item.siteCategoryAssigned !== true;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  const PRODUCT_SORT_VALUES = {
    name: (item) => item.name,
    sku: (item) => item.supplierSku,
    stock: (item) => numberOrNull(item.stockQty),
    source: (item) => item.supplierName || item.supplierSlot,
    cost: (item) => numberOrNull(item.costPrice),
    margin: (item) => numberOrNull(item.marginPercent),
    price: (item) => numberOrNull(item.salePrice),
    xmlCategory: (item) =>
      [item.xmlMainCategory || item.mainCategory, item.xmlMidCategory || item.midCategory, item.xmlSubCategory || item.subCategory]
        .filter(Boolean)
        .join(" › "),
    siteCategory: (item) =>
      item.siteCategoryAssigned ? item.siteCategoryLabel || [item.siteParent, item.siteMid, item.siteChild].join(" › ") : "",
    active: (item) => (item.active ? 1 : 0),
    reason: (item) => (isMenuMissing(item) ? "Menüde kategorisi yok" : item.unlistedReason || ""),
  };

  function queryProducts(options) {
    const opts = options || {};
    const all = listProducts();
    const query = trLowerCase(String(opts.q || "").trim());
    const status = String(opts.status || "");
    const reason = String(opts.reason || "");
    const slotId = String(opts.slot || "");
    const filtered = all.filter((item) => {
      const haystack = trLowerCase(
        [item.supplierSku, item.name, item.brand, item.supplierName].join(" ")
      );
      if (query && !haystack.includes(query)) return false;
      if (slotId && item.supplierSlot !== slotId) return false;
      if (status === "active" && !item.active) return false;
      if (status === "inactive" && item.active) return false;
      if (status === "stock" && !(item.stockQty === null || Number(item.stockQty) > 0)) {
        return false;
      }
      if (status === "nocat" && item.siteCategoryAssigned) return false;
      if (status === "unlisted") {
        const manual = item.unlisted === true;
        const menu = isMenuMissing(item);
        if (reason === "manual" ? !manual : reason === "menu" ? !menu : !manual && !menu) return false;
      }
      if (status === "pool") {
        if (item.unlisted) return false;
        const live = require("./stock-visibility").isSupplierOfferLive(item);
        if (!live) return false;
        if (item.active && item.siteCategoryAssigned) return false;
      }
      if (typeof opts.match === "function" && !opts.match(item)) return false;
      return true;
    });
    const sortValues = Object.assign({}, PRODUCT_SORT_VALUES, opts.sortValues || {});
    const sort = normalizeSort(opts.sort, opts.dir, Object.keys(sortValues));
    const ordered = sort ? sortRows(filtered, sortValues[sort.key], sort.dir) : filtered;
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));
    const total = ordered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    const page = Math.min(totalPages, Math.max(1, Number(opts.page) || 1));
    const start = (page - 1) * limit;
    const pageRows = ordered.slice(start, start + limit).map(ensureListedProductCopy);
    let unlistedCount = 0;
    let menuMissingCount = 0;
    let activeCount = 0;
    for (const item of all) {
      if (item.active) activeCount += 1;
      if (item.unlisted) unlistedCount += 1;
      else if (isMenuMissing(item)) menuMissingCount += 1;
    }
    return {
      products:
        status === "unlisted"
          ? pageRows.map((item) => (isMenuMissing(item) ? Object.assign({}, item, { menuMissing: true }) : item))
          : pageRows,
      total,
      page,
      limit,
      totalPages,
      catalogCount: all.length,
      activeCount,
      unlistedCount,
      menuMissingCount,
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
    getProductById,
    queryProducts,
    updateProducts,
    preloadCachesAsync,
    preloadRawCachesAsync,
  };
}

module.exports = { createMultiSupplierManager };
