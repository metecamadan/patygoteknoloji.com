/* Patygo sepet — localStorage */
(function () {
  "use strict";
  const KEY = "patygo_cart";
  const VAT = 0.2;

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function write(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("patygo:cart"));
  }

  function snapshotFrom(meta, existing) {
    const src = meta && typeof meta === "object" ? meta : {};
    const prev = existing || {};
    return {
      brand: String(src.brand != null ? src.brand : prev.brand || "").trim(),
      name: String(src.name != null ? src.name : prev.name || "").trim(),
      price: Math.max(0, Number(src.price != null ? src.price : prev.price) || 0),
    };
  }

  function resolveProduct(item, catalogById) {
    const catalog = catalogById && catalogById[item.id];
    if (catalog) {
      return {
        id: catalog.id,
        brand: catalog.brand,
        name: catalog.name,
        price: catalog.price,
        category: catalog.category,
        active: catalog.active,
      };
    }
    if (item && item.name && Number(item.price) >= 0) {
      return {
        id: item.id,
        brand: item.brand || "",
        name: item.name,
        price: Number(item.price) || 0,
        category: "",
        active: true,
      };
    }
    return null;
  }

  window.PatygoCart = {
    VAT,
    list() {
      return read();
    },
    count() {
      return read().reduce((n, i) => n + (Number(i.qty) || 0), 0);
    },
    add(id, qty, meta) {
      const q = Math.max(1, Math.min(99, Number(qty) || 1));
      const items = read();
      const found = items.find((i) => i.id === id);
      if (found) {
        found.qty = Math.min(99, (Number(found.qty) || 0) + q);
        Object.assign(found, snapshotFrom(meta, found));
      } else {
        items.push(Object.assign({ id, qty: q }, snapshotFrom(meta)));
      }
      write(items);
      if (window.PatygoAnalytics) window.PatygoAnalytics.track("add_to_cart");
      return items;
    },
    setQty(id, qty) {
      const q = Math.max(0, Math.min(99, Number(qty) || 0));
      let items = read();
      if (q <= 0) items = items.filter((i) => i.id !== id);
      else {
        const found = items.find((i) => i.id === id);
        if (found) found.qty = q;
        else items.push({ id, qty: q });
      }
      write(items);
      return items;
    },
    clear() {
      write([]);
    },
    totals(catalogById) {
      const items = read();
      let sub = 0;
      const lines = [];
      items.forEach((i) => {
        const p = resolveProduct(i, catalogById || {});
        if (!p) return;
        const qty = Math.max(1, Number(i.qty) || 1);
        const line = p.price * qty;
        sub += line;
        lines.push({ product: p, qty, line });
      });
      const vat = sub * VAT;
      return { lines, sub, vat, total: sub + vat };
    },
  };

  function refreshBadges() {
    const n = window.PatygoCart.count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = String(n);
      el.hidden = n <= 0;
    });
  }

  window.addEventListener("patygo:cart", refreshBadges);
  document.addEventListener("DOMContentLoaded", refreshBadges);
  refreshBadges();
})();
