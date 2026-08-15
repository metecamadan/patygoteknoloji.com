/* Patygo — e-ticaret kategori navigasyonu */
(function () {
  "use strict";

  const NAV_SOURCE = "/assets/data/categories.json";

  function categoryHref(parentSlug, childSlug) {
    const params = new URLSearchParams();
    if (parentSlug) params.set("kategori", parentSlug);
    if (childSlug) params.set("alt", childSlug);
    const q = params.toString();
    return q ? "/urunler?" + q : "/urunler";
  }

  function closeAllMega(root) {
    root.querySelectorAll(".nav-mega").forEach((item) => {
      item.classList.remove("open");
      const btn = item.querySelector(".nav-mega-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function buildMegaItem(category) {
    const li = document.createElement("li");
    li.className = "nav-mega";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-mega-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "true");
    toggle.innerHTML =
      '<span>' +
      category.name +
      '</span><svg class="nav-mega-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const panel = document.createElement("div");
    panel.className = "nav-mega-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", category.name + " alt kategorileri");

    const list = document.createElement("ul");
    list.className = "nav-mega-list";
    (category.children || []).forEach((child) => {
      const childLi = document.createElement("li");
      const a = document.createElement("a");
      a.href = categoryHref(category.slug, child.slug);
      a.textContent = child.name;
      childLi.appendChild(a);
      list.appendChild(childLi);
    });
    panel.appendChild(list);

    toggle.addEventListener("click", (ev) => {
      ev.preventDefault();
      const open = !li.classList.contains("open");
      const root = li.closest(".nav-links");
      if (root) closeAllMega(root);
      li.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    let hoverCloseTimer = null;
    const isDesktopNav = () => window.matchMedia("(min-width: 861px)").matches;
    const openMega = () => {
      if (!isDesktopNav()) return;
      clearTimeout(hoverCloseTimer);
      const root = li.closest(".nav-links");
      if (root) closeAllMega(root);
      li.classList.add("open");
      toggle.setAttribute("aria-expanded", "true");
    };
    const scheduleHoverClose = () => {
      if (!isDesktopNav()) return;
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = setTimeout(() => {
        li.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }, 140);
    };
    const onHoverLeave = (ev) => {
      if (!isDesktopNav()) return;
      const next = ev.relatedTarget;
      if (next && li.contains(next)) return;
      scheduleHoverClose();
    };

    li.addEventListener("mouseenter", openMega);
    panel.addEventListener("mouseenter", openMega);
    li.addEventListener("mouseleave", onHoverLeave);
    panel.addEventListener("mouseleave", onHoverLeave);

    li.appendChild(toggle);
    li.appendChild(panel);
    return li;
  }

  function publishedCategories(list) {
    return (list || [])
      .filter((cat) => cat && cat.active !== false)
      .map((cat) => ({
        slug: cat.slug,
        name: cat.name,
        children: (cat.children || []).filter((child) => child && child.active !== false),
      }))
      .filter((cat) => (cat.children || []).length);
  }

  function renderNav(root, categories) {
    root.textContent = "";
    const published = publishedCategories(categories);
    if (published.length > 4) {
      const li = document.createElement("li");
      li.className = "nav-mega";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "nav-mega-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-haspopup", "true");
      toggle.innerHTML =
        '<span>Ürünler</span><svg class="nav-mega-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const panel = document.createElement("div");
      panel.className = "nav-mega-panel is-catalog";
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", "Ürün kategorileri");
      const groups = document.createElement("div");
      groups.className = "nav-mega-groups";
      published.forEach((cat) => {
        const group = document.createElement("div");
        group.className = "nav-mega-group";
        const heading = document.createElement("a");
        heading.className = "nav-mega-group-title";
        heading.href = categoryHref(cat.slug);
        heading.textContent = cat.name;
        const list = document.createElement("ul");
        list.className = "nav-mega-list";
        (cat.children || []).forEach((child) => {
          const childLi = document.createElement("li");
          const a = document.createElement("a");
          a.href = categoryHref(cat.slug, child.slug);
          a.textContent = child.name;
          childLi.appendChild(a);
          list.appendChild(childLi);
        });
        group.appendChild(heading);
        group.appendChild(list);
        groups.appendChild(group);
      });
      panel.appendChild(groups);
      toggle.addEventListener("click", (ev) => {
        ev.preventDefault();
        const open = !li.classList.contains("open");
        closeAllMega(root);
        li.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      let hoverCloseTimer = null;
      const isDesktopNav = () => window.matchMedia("(min-width: 861px)").matches;
      li.addEventListener("mouseenter", () => {
        if (!isDesktopNav()) return;
        clearTimeout(hoverCloseTimer);
        closeAllMega(root);
        li.classList.add("open");
        toggle.setAttribute("aria-expanded", "true");
      });
      li.addEventListener("mouseleave", () => {
        if (!isDesktopNav()) return;
        hoverCloseTimer = setTimeout(() => {
          li.classList.remove("open");
          toggle.setAttribute("aria-expanded", "false");
        }, 140);
      });
      li.appendChild(toggle);
      li.appendChild(panel);
      root.appendChild(li);
    } else {
      published.forEach((cat) => root.appendChild(buildMegaItem(cat)));
    }
    renderHeroOrbit(published);
  }

  const HERO_ICON_SVG = {
    notebook:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M2 19h20" stroke-linecap="round"/></svg>',
    masaustu:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 20h8M12 17v3" stroke-linecap="round"/></svg>',
    tablet:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01" stroke-linecap="round"/></svg>',
    klavye:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" stroke-linecap="round"/></svg>',
    mouse:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="7" y="2" width="10" height="18" rx="5"/><path d="M12 6v4" stroke-linecap="round"/></svg>',
    monitor:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 20h8M12 17v3" stroke-linecap="round"/></svg>',
    "ekran-karti":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h4M7 14h2" stroke-linecap="round"/><path d="M17 8v8l3-4-3-4z" stroke-linejoin="round"/></svg>',
    islemci:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" stroke-linecap="round"/></svg>',
    islemciler:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" stroke-linecap="round"/></svg>',
    "laser-yazici":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="8" width="16" height="10" rx="1"/><path d="M6 8V5h12v3M8 14h8" stroke-linecap="round"/></svg>',
    router:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 14h16M6 10c2.5-3 9.5-3 12 0M8 6c1.5-2 6.5-2 8 0" stroke-linecap="round"/><circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none"/></svg>',
    modem:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="9" width="18" height="10" rx="2"/><path d="M7 13h2M11 13h2M15 13h2" stroke-linecap="round"/><path d="M8 5c2-2 6-2 8 0" stroke-linecap="round"/></svg>',
    "usb-bellek":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h6v18H9z" stroke-linejoin="round"/><path d="M12 7v4" stroke-linecap="round"/></svg>',
    tarayici:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 14h18M7 18h10" stroke-linecap="round"/></svg>',
    "notebook-canta":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 8h12v12H6z" stroke-linejoin="round"/><path d="M9 8V6a3 3 0 016 0v2" stroke-linecap="round"/></svg>',
    default:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16v12H4z" stroke-linejoin="round"/><path d="M9 7V5h6v2" stroke-linecap="round"/></svg>',
  };

  const HERO_ORBIT_LAYOUT = [
    { slug: "notebook", top: 6, left: 8, delay: 0, dur: 4.2 },
    { slug: "tablet", top: 14, left: 62, delay: 0.5, dur: 3.8 },
    { slug: "monitor", top: 38, left: 78, delay: 1.1, dur: 4.6 },
    { slug: "klavye", top: 58, left: 4, delay: 0.3, dur: 3.6 },
    { slug: "mouse", top: 52, left: 42, delay: 0.9, dur: 4.1 },
    { slug: "ekran-karti", top: 72, left: 68, delay: 1.4, dur: 3.9 },
    { slug: "laser-yazici", top: 78, left: 22, delay: 0.7, dur: 4.4 },
    { slug: "router", top: 24, left: 32, delay: 1.2, dur: 3.7 },
    { slug: "usb-bellek", top: 8, left: 44, delay: 0.2, dur: 4.0 },
    { slug: "modem", top: 64, left: 52, delay: 1.6, dur: 4.3 },
  ];

  function findChildCategory(categories, slug) {
    for (const parent of categories || []) {
      const child = (parent.children || []).find((row) => row.slug === slug);
      if (child) return { parent, child };
    }
    return null;
  }

  function renderHeroOrbit(categories) {
    const root = document.querySelector("[data-hero-orbit]");
    if (!root) return;
    root.textContent = "";
    HERO_ORBIT_LAYOUT.forEach((slot, index) => {
      const match = findChildCategory(categories, slot.slug);
      if (!match) return;
      const link = document.createElement("a");
      link.className = "hero-orbit-chip";
      link.href = categoryHref(match.parent.slug, match.child.slug);
      link.style.setProperty("--chip-top", slot.top + "%");
      link.style.setProperty("--chip-left", slot.left + "%");
      link.style.setProperty("--float-delay", slot.delay + "s");
      link.style.setProperty("--float-dur", slot.dur + "s");
      link.style.setProperty("--chip-hue", String((index * 47 + 210) % 360));
      link.setAttribute("aria-label", match.child.name);
      link.innerHTML =
        '<span class="hero-orbit-chip-icon">' +
        (HERO_ICON_SVG[slot.slug] || HERO_ICON_SVG.default) +
        '</span><span class="hero-orbit-chip-label">' +
        match.child.name +
        "</span>";
      root.appendChild(link);
    });
  }

  function bindChrome(root) {
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeAllMega(root);
    });
    document.addEventListener("click", (ev) => {
      if (!root.contains(ev.target)) closeAllMega(root);
    });
  }

  function loadNav(root) {
    return fetch(NAV_SOURCE, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Kategori menüsü yüklenemedi");
        return res.json();
      })
      .then((data) => {
        const categories = Array.isArray(data && data.categories) ? data.categories : [];
        renderNav(root, categories);
        window.PatygoNav = {
          categories: publishedCategories(categories),
          categoryHref,
        };
        document.dispatchEvent(new CustomEvent("patygo:nav-ready"));
      })
      .catch(() => {
        root.textContent = "";
      });
  }

  function init() {
    const root = document.querySelector("[data-site-nav]");
    if (!root) return;

    bindChrome(root);
    loadNav(root);
    try {
      const bc = new BroadcastChannel("patygo-catalog");
      bc.addEventListener("message", () => loadNav(root));
    } catch (_) {}
    window.addEventListener("storage", (ev) => {
      if (ev.key === "patygo_catalog_version") loadNav(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
