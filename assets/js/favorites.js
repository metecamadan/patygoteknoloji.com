(function () {
  "use strict";

  // Üyeliksiz: yalnızca bu tarayıcıda saklanır. FAV_MAX = /api/products?ids= üst sınırı.
  const FAV_KEY = "patygo_favorites_v1";
  const COMPARE_KEY = "patygo_compare_v1";
  const FAV_MAX = 50;
  const COMPARE_MAX = 4;
  const HEART =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.5 1.1 4.3 2.4.8-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>';

  function read(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function write(key, ids) {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch (_) {}
  }

  function createList(key, max) {
    return {
      max,
      ids() {
        return read(key);
      },
      has(id) {
        return read(key).indexOf(String(id)) !== -1;
      },
      count() {
        return read(key).length;
      },
      remove(id) {
        write(
          key,
          read(key).filter((item) => item !== String(id))
        );
        refresh();
      },
      toggle(id) {
        const target = String(id || "");
        if (!target) return { added: false, full: false };
        const ids = read(key);
        if (ids.indexOf(target) !== -1) {
          write(
            key,
            ids.filter((item) => item !== target)
          );
          refresh();
          return { added: false, full: false };
        }
        if (ids.length >= max) return { added: false, full: true };
        write(key, [target].concat(ids));
        refresh();
        return { added: true, full: false };
      },
    };
  }

  const favorites = createList(FAV_KEY, FAV_MAX);
  const compare = createList(COMPARE_KEY, COMPARE_MAX);

  function syncFavButton(btn) {
    const on = favorites.has(btn.getAttribute("data-fav-toggle"));
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "Favorilerden çıkar" : "Favorilere ekle");
    btn.title = on ? "Favorilerden çıkar" : "Favorilere ekle";
  }

  function syncCompareButton(btn) {
    const on = compare.has(btn.getAttribute("data-compare-toggle"));
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "Karşılaştırmadan çıkar" : "Karşılaştır";
  }

  function refresh() {
    const favCount = favorites.count();
    const compareCount = compare.count();
    document.querySelectorAll("[data-fav-count]").forEach((el) => {
      el.textContent = String(favCount);
      el.hidden = favCount <= 0;
    });
    document.querySelectorAll("[data-compare-count]").forEach((el) => {
      el.textContent = String(compareCount);
      el.hidden = compareCount <= 0;
    });
    document.querySelectorAll("[data-fav-toggle]").forEach(syncFavButton);
    document.querySelectorAll("[data-compare-toggle]").forEach(syncCompareButton);
    document.dispatchEvent(new CustomEvent("patygo:favorites"));
  }

  function notify(btn, text) {
    const previous = btn.title;
    btn.title = text;
    btn.classList.add("is-full");
    window.alert(text);
    window.setTimeout(() => {
      btn.classList.remove("is-full");
      btn.title = previous;
    }, 1500);
  }

  function createFavButton(id) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fav-toggle";
    btn.setAttribute("data-fav-toggle", String(id || ""));
    btn.innerHTML = HEART;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const result = favorites.toggle(id);
      if (result.full) notify(btn, "En fazla " + FAV_MAX + " ürün favorilere eklenebilir.");
    });
    syncFavButton(btn);
    return btn;
  }

  function createCompareButton(id, className) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className || "btn btn-outline compare-toggle";
    btn.setAttribute("data-compare-toggle", String(id || ""));
    btn.addEventListener("click", () => {
      const result = compare.toggle(id);
      if (result.full) notify(btn, "En fazla " + COMPARE_MAX + " ürün karşılaştırılabilir.");
    });
    syncCompareButton(btn);
    return btn;
  }

  window.addEventListener("storage", (ev) => {
    if (ev.key === FAV_KEY || ev.key === COMPARE_KEY) refresh();
  });

  window.PatygoFavorites = {
    favorites,
    compare,
    refresh,
    createFavButton,
    createCompareButton,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
