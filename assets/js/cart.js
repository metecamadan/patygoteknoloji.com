/* Patygo sepet — sessionStorage (tarayıcı oturumu kapanınca sıfırlanır) */
(function () {
  "use strict";
  const KEY = "patygo_cart";
  const ALLOWED_VAT = [1, 8, 10, 20];

  function normalizeVatPercent(value) {
    const n = Number(value);
    return ALLOWED_VAT.includes(n) ? n : 20;
  }

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
  }

  function dropPersistentCart() {
    try {
      if (localStorage.getItem(KEY)) localStorage.removeItem(KEY);
    } catch (_) {}
  }

  function loadRaw() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function snapshotFrom(meta, existing) {
    const src = meta && typeof meta === "object" ? meta : {};
    const prev = existing || {};
    return {
      brand: String(src.brand != null ? src.brand : prev.brand || "").trim(),
      name: String(src.name != null ? src.name : prev.name || "").trim(),
      price: Math.max(0, Number(src.price != null ? src.price : prev.price) || 0),
      vatPercent: normalizeVatPercent(
        src.vatPercent != null ? src.vatPercent : prev.vatPercent
      ),
    };
  }

  function coalesce(items) {
    const map = new Map();
    (items || []).forEach((item) => {
      if (!item || typeof item !== "object") return;
      const id = normalizeId(item.id);
      if (!id) return;
      const qty = Math.max(0, Math.min(99, Number(item.qty) || 0));
      if (!qty) return;
      const prev = map.get(id);
      if (prev) {
        prev.qty = Math.min(99, prev.qty + qty);
        Object.assign(prev, snapshotFrom(item, prev));
      } else {
        map.set(id, Object.assign({ id, qty }, snapshotFrom(item)));
      }
    });
    return Array.from(map.values());
  }

  function persist(items, emit) {
    sessionStorage.setItem(KEY, JSON.stringify(items));
    dropPersistentCart();
    if (emit) window.dispatchEvent(new CustomEvent("patygo:cart"));
  }

  function read() {
    const raw = loadRaw();
    const next = coalesce(raw);
    if (JSON.stringify(raw) !== JSON.stringify(next)) persist(next, false);
    return next;
  }

  function write(items) {
    persist(coalesce(items), true);
  }

  function lookupCatalog(catalogById, id) {
    if (!catalogById) return null;
    const key = normalizeId(id);
    if (!key) return null;
    return catalogById[key] || catalogById[id] || null;
  }

  function resolveProduct(item, catalogById) {
    const catalog = lookupCatalog(catalogById, item && item.id);
    if (catalog) {
      return {
        id: normalizeId(catalog.id || item.id),
        brand: catalog.brand,
        name: catalog.name,
        price: catalog.price,
        vatPercent: normalizeVatPercent(catalog.vatPercent),
        category: catalog.category,
        image: catalog.image,
        images: catalog.images,
        active: catalog.active,
      };
    }
    if (item && item.name && Number(item.price) >= 0) {
      return {
        id: normalizeId(item.id),
        brand: item.brand || "",
        name: item.name,
        price: Number(item.price) || 0,
        vatPercent: normalizeVatPercent(item.vatPercent),
        category: "",
        active: true,
      };
    }
    return null;
  }

  function catalogById() {
    return (window.PatygoCatalog && window.PatygoCatalog.byId) || {};
  }

  window.PatygoCart = {
    ALLOWED_VAT,
    normalizeVatPercent,
    list() {
      return read();
    },
    count() {
      const byId = catalogById();
      return read().reduce((n, item) => {
        if (!resolveProduct(item, byId)) return n;
        return n + (Number(item.qty) || 0);
      }, 0);
    },
    pruneUnresolved(catalogMap) {
      const byId = catalogMap || catalogById();
      const items = read();
      const next = items.filter((item) => resolveProduct(item, byId));
      if (next.length !== items.length) write(next);
      return next;
    },
    add(id, qty, meta) {
      const key = normalizeId(id);
      if (!key) return read();
      const q = Math.max(1, Math.min(99, Number(qty) || 1));
      const items = read();
      const found = items.find((i) => i.id === key);
      if (found) {
        found.qty = Math.min(99, (Number(found.qty) || 0) + q);
        Object.assign(found, snapshotFrom(meta, found));
      } else {
        items.push(Object.assign({ id: key, qty: q }, snapshotFrom(meta)));
      }
      write(items);
      if (window.PatygoAnalytics) window.PatygoAnalytics.track("add_to_cart");
      return items;
    },
    setQty(id, qty) {
      const key = normalizeId(id);
      const q = Math.max(0, Math.min(99, Number(qty) || 0));
      let items = read();
      if (q <= 0) items = items.filter((i) => i.id !== key);
      else {
        const found = items.find((i) => i.id === key);
        if (found) found.qty = q;
        else items.push(Object.assign({ id: key, qty: q }, snapshotFrom()));
      }
      write(items);
      return items;
    },
    clear() {
      write([]);
    },
    totals(byId) {
      const items = read();
      let sub = 0;
      let vat = 0;
      const lines = [];
      items.forEach((i) => {
        const p = resolveProduct(i, byId || {});
        if (!p) return;
        const qty = Math.max(1, Number(i.qty) || 1);
        const line = Math.round(p.price * qty * 100) / 100;
        const lineVat =
          Math.round(line * (normalizeVatPercent(p.vatPercent) / 100) * 100) / 100;
        sub += line;
        vat += lineVat;
        lines.push({
          product: p,
          qty,
          line,
          lineVat,
          lineIncl: Math.round((line + lineVat) * 100) / 100,
        });
      });
      sub = Math.round(sub * 100) / 100;
      vat = Math.round(vat * 100) / 100;
      const merchandiseTotal = Math.round((sub + vat) * 100) / 100;
      const shipping =
        window.PatygoShipping && typeof window.PatygoShipping.feeForMerchandise === "function"
          ? window.PatygoShipping.feeForMerchandise(merchandiseTotal)
          : 0;
      return {
        lines,
        sub,
        vat,
        merchandiseTotal,
        shipping,
        total: Math.round((merchandiseTotal + shipping) * 100) / 100,
      };
    },
  };

  function refreshBadges() {
    const n = window.PatygoCart.count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = String(n);
      el.hidden = n <= 0;
    });
  }

  dropPersistentCart();
  window.addEventListener("patygo:cart", refreshBadges);
  document.addEventListener("DOMContentLoaded", refreshBadges);
  refreshBadges();
})();
