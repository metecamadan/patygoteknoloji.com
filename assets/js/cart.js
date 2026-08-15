/* Patygo sepet — sessionStorage (tarayıcı oturumu kapanınca sıfırlanır) */
(function () {
  "use strict";
  const KEY = "patygo_cart";
  const ALLOWED_VAT = [1, 8, 10, 20];

  function normalizeVatPercent(value) {
    const n = Number(value);
    return ALLOWED_VAT.includes(n) ? n : 20;
  }

  function dropPersistentCart() {
    try {
      if (localStorage.getItem(KEY)) localStorage.removeItem(KEY);
    } catch (_) {}
  }

  function read() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function write(items) {
    sessionStorage.setItem(KEY, JSON.stringify(items));
    dropPersistentCart();
    window.dispatchEvent(new CustomEvent("patygo:cart"));
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

  function resolveProduct(item, catalogById) {
    const catalog = catalogById && catalogById[item.id];
    if (catalog) {
      return {
        id: catalog.id,
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
        id: item.id,
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

  window.PatygoCart = {
    ALLOWED_VAT,
    normalizeVatPercent,
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
      let vat = 0;
      const lines = [];
      items.forEach((i) => {
        const p = resolveProduct(i, catalogById || {});
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
      return { lines, sub, vat, total: Math.round((sub + vat) * 100) / 100 };
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
