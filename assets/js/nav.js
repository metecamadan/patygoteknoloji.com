/* Patygo — e-ticaret kategori navigasyonu */
(function () {
  "use strict";

  const NAV_SOURCE = "/listing/categories.json";
  const NAV_SOURCE_FALLBACK = "/assets/data/categories.json";

  function categoryHref(parentSlug, midSlug, childSlug) {
    const params = new URLSearchParams();
    if (parentSlug) params.set("kategori", parentSlug);
    if (arguments.length < 3) {
      if (midSlug) params.set("alt", midSlug);
    } else {
      if (midSlug) params.set("ara", midSlug);
      if (childSlug) params.set("alt", childSlug);
    }
    const q = params.toString();
    return q ? "/urunler?" + q : "/urunler";
  }

  function splitNavCategoryName(name) {
    const text = String(name || "").trim();
    if (!text) return { line1: "", line2: "" };
    const slashMarker = " / ";
    const slashIdx = text.indexOf(slashMarker);
    if (slashIdx >= 0) {
      return {
        line1: text.slice(0, slashIdx + slashMarker.length - 1).trim(),
        line2: text.slice(slashIdx + slashMarker.length).trim(),
      };
    }
    const spaceIdx = text.lastIndexOf(" ");
    if (spaceIdx <= 0) return { line1: text, line2: "" };
    return {
      line1: text.slice(0, spaceIdx).trim(),
      line2: text.slice(spaceIdx + 1).trim(),
    };
  }

  function formatNavMobileName(name) {
    return String(name || "")
      .split(/\s*\/\s*/)
      .map((part) => {
        const text = part.trim();
        if (!text) return "";
        const lower = text.toLocaleLowerCase("tr-TR");
        return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
      })
      .filter(Boolean)
      .join(" · ");
  }

  function buildNavCategoryLabel(name) {
    const parts = splitNavCategoryName(name);
    const wrap = document.createElement("span");
    wrap.className = "nav-mega-label";
    const line1 = document.createElement("span");
    line1.className = "nav-mega-label-line";
    line1.textContent = parts.line1;
    wrap.appendChild(line1);
    if (parts.line2) {
      const line2 = document.createElement("span");
      line2.className = "nav-mega-label-line";
      line2.textContent = parts.line2;
      wrap.appendChild(line2);
    }
    return wrap;
  }

  function isMobileNav() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function closeMegaGroups(scope) {
    (scope || document).querySelectorAll(".nav-mega-group.open").forEach((group) => {
      group.classList.remove("open");
      const btn = group.querySelector(".nav-mega-group-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function closeAllMega(root) {
    root.querySelectorAll(".nav-mega").forEach((item) => {
      item.classList.remove("open");
      const btn = item.querySelector(".nav-mega-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
      closeMegaGroups(item);
    });
  }

  function bindMegaGroupAccordion(group, groupToggle) {
    groupToggle.addEventListener("click", (ev) => {
      if (!isMobileNav()) return;
      ev.preventDefault();
      const panel = group.closest(".nav-mega-panel");
      const willOpen = !group.classList.contains("open");
      if (panel) closeMegaGroups(panel);
      group.classList.toggle("open", willOpen);
      groupToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
  }

  function buildMegaGroup(category, child) {
    const leaves = Array.isArray(child.children) ? child.children : [];
    const group = document.createElement("div");
    group.className = "nav-mega-group";

    if (leaves.length) {
      const head = document.createElement("div");
      head.className = "nav-mega-group-head";

      const title = document.createElement("a");
      title.className = "nav-mega-group-title";
      title.href = categoryHref(category.slug, child.slug, "");
      title.textContent = child.name;

      const groupToggle = document.createElement("button");
      groupToggle.type = "button";
      groupToggle.className = "nav-mega-group-toggle";
      groupToggle.setAttribute("aria-expanded", "false");
      const label = document.createElement("span");
      label.className = "nav-mega-group-toggle-label";
      label.textContent = child.name;
      groupToggle.appendChild(label);
      groupToggle.insertAdjacentHTML(
        "beforeend",
        '<svg class="nav-mega-group-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      );

      const list = document.createElement("ul");
      list.className = "nav-mega-list";
      leaves.forEach((leaf) => {
        const leafLi = document.createElement("li");
        const a = document.createElement("a");
        a.href = categoryHref(category.slug, child.slug, leaf.slug);
        a.textContent = leaf.name;
        leafLi.appendChild(a);
        list.appendChild(leafLi);
      });

      head.appendChild(title);
      head.appendChild(groupToggle);
      group.appendChild(head);
      group.appendChild(list);
      bindMegaGroupAccordion(group, groupToggle);
      return group;
    }

    const list = document.createElement("ul");
    list.className = "nav-mega-list";
    const childLi = document.createElement("li");
    const a = document.createElement("a");
    a.href = categoryHref(category.slug, child.slug);
    a.textContent = child.name;
    childLi.appendChild(a);
    list.appendChild(childLi);
    group.appendChild(list);
    return group;
  }

  function buildMegaItem(category) {
    const li = document.createElement("li");
    li.className = "nav-mega";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-mega-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "true");
    toggle.appendChild(buildNavCategoryLabel(category.name));
    const mobileLabel = document.createElement("span");
    mobileLabel.className = "nav-mega-mobile-label";
    mobileLabel.textContent = formatNavMobileName(category.name);
    toggle.appendChild(mobileLabel);
    toggle.insertAdjacentHTML(
      "beforeend",
      '<svg class="nav-mega-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );

    const panel = document.createElement("div");
    panel.className = "nav-mega-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", category.name + " alt kategorileri");

    const heading = document.createElement("a");
    heading.className = "nav-mega-heading";
    heading.href = categoryHref(category.slug);
    heading.textContent = category.name;

    const groups = document.createElement("div");
    groups.className = "nav-mega-groups";
    (category.children || []).forEach((child) => {
      groups.appendChild(buildMegaGroup(category, child));
    });
    panel.appendChild(heading);
    panel.appendChild(groups);

    toggle.addEventListener("click", (ev) => {
      ev.preventDefault();
      const open = !li.classList.contains("open");
      const root = li.closest(".nav-links");
      if (root) closeAllMega(root);
      li.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      closeMegaGroups(li);
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
        children: (cat.children || [])
          .filter((child) => child && child.active !== false)
          .map((child) => ({
            slug: child.slug,
            name: child.name,
            children: (child.children || []).filter((leaf) => leaf && leaf.active !== false),
          })),
      }))
      .filter((cat) => (cat.children || []).length);
  }

  function renderNav(root, categories) {
    root.textContent = "";
    const published = publishedCategories(categories);
    published.forEach((cat) => root.appendChild(buildMegaItem(cat)));
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
    { slugs: ["tasinabilir-bilgisayarlar", "notebooklar", "notebook"], top: 6, left: 8, delay: 0, dur: 4.2 },
    { slugs: ["islemciler", "islemci"], top: 14, left: 62, delay: 0.5, dur: 3.8 },
    { slugs: ["monitorler", "monitor"], top: 38, left: 78, delay: 1.1, dur: 4.6 },
    { slugs: ["klavye"], top: 58, left: 4, delay: 0.3, dur: 3.6 },
    { slugs: ["mouse"], top: 52, left: 42, delay: 0.9, dur: 4.1 },
    { slugs: ["ekran-kartlari", "ekran-karti"], top: 72, left: 68, delay: 1.4, dur: 3.9 },
    { slugs: ["inkjet-yazicilar", "yazici-tarayici", "laser-yazici"], top: 78, left: 22, delay: 0.7, dur: 4.4 },
    { slugs: ["access-point-ve-router", "modem-ve-switch", "router"], top: 24, left: 32, delay: 1.2, dur: 3.7 },
    { slugs: ["usb-flash", "usb-ve-kart-bellek-urunleri", "usb-bellek"], top: 8, left: 44, delay: 0.2, dur: 4.0 },
    { slugs: ["dsl-modemler", "modem"], top: 64, left: 52, delay: 1.6, dur: 4.3 },
  ];

  function childKey(parent, mid, child) {
    return (
      (parent && parent.slug ? parent.slug : "") +
      "/" +
      (mid && mid.slug ? mid.slug : "") +
      "/" +
      (child && child.slug ? child.slug : "")
    );
  }

  function findChildBySlugs(categories, slugs, used) {
    const want = slugs || [];
    for (let i = 0; i < want.length; i += 1) {
      const alias = want[i];
      for (const parent of categories || []) {
        for (const mid of parent.children || []) {
          if (mid.slug === alias) {
            const key = childKey(parent, mid, mid);
            if (!used.has(key)) return { parent, mid, child: mid, key };
          }
          const leaf = (mid.children || []).find((row) => row.slug === alias);
          if (!leaf) continue;
          const key = childKey(parent, mid, leaf);
          if (used.has(key)) continue;
          return { parent, mid, child: leaf, key };
        }
      }
    }
    return null;
  }

  function leftoverChildren(categories, used) {
    const out = [];
    (categories || []).forEach((parent) => {
      (parent.children || []).forEach((mid) => {
        const leaves = mid.children || [];
        if (!leaves.length) {
          if (mid.slug === "genel") return;
          const key = childKey(parent, mid, mid);
          if (used.has(key)) return;
          out.push({ parent, mid, child: mid, key });
          return;
        }
        leaves.forEach((leaf) => {
          if (!leaf || leaf.slug === "genel") return;
          const key = childKey(parent, mid, leaf);
          if (used.has(key)) return;
          out.push({ parent, mid, child: leaf, key });
        });
      });
    });
    return out;
  }

  function pickHeroOrbitChips(categories) {
    const used = new Set();
    const chips = [];
    HERO_ORBIT_LAYOUT.forEach((slot) => {
      const match = findChildBySlugs(categories, slot.slugs, used);
      if (!match) return;
      used.add(match.key);
      chips.push({ slot: slot, parent: match.parent, mid: match.mid, child: match.child });
    });
    const extras = leftoverChildren(categories, used);
    HERO_ORBIT_LAYOUT.forEach((slot) => {
      if (chips.some((row) => row.slot === slot)) return;
      const extra = extras.shift();
      if (!extra) return;
      used.add(extra.key);
      chips.push({ slot: slot, parent: extra.parent, mid: extra.mid, child: extra.child });
    });
    return chips;
  }

  function iconForChildSlug(slug) {
    const key = String(slug || "");
    if (HERO_ICON_SVG[key]) return HERO_ICON_SVG[key];
    if (key.indexOf("islemci") >= 0) return HERO_ICON_SVG.islemciler;
    if (key.indexOf("ekran-kart") >= 0) return HERO_ICON_SVG["ekran-karti"];
    if (key.indexOf("monitor") >= 0) return HERO_ICON_SVG.monitor;
    if (key.indexOf("notebook") >= 0 || key.indexOf("tasinabilir") >= 0) return HERO_ICON_SVG.notebook;
    if (key.indexOf("masaust") >= 0) return HERO_ICON_SVG.masaustu;
    if (key.indexOf("klavye") >= 0) return HERO_ICON_SVG.klavye;
    if (key.indexOf("mouse") >= 0) return HERO_ICON_SVG.mouse;
    if (key.indexOf("yazici") >= 0 || key.indexOf("laser") >= 0 || key.indexOf("inkjet") >= 0) {
      return HERO_ICON_SVG["laser-yazici"];
    }
    if (key.indexOf("router") >= 0 || key.indexOf("access-point") >= 0) return HERO_ICON_SVG.router;
    if (key.indexOf("modem") >= 0) return HERO_ICON_SVG.modem;
    if (key.indexOf("usb") >= 0) return HERO_ICON_SVG["usb-bellek"];
    if (key.indexOf("tablet") >= 0) return HERO_ICON_SVG.tablet;
    if (key.indexOf("tarayici") >= 0) return HERO_ICON_SVG.tarayici;
    return HERO_ICON_SVG.default;
  }

  function renderHeroOrbit(categories) {
    const root = document.querySelector("[data-hero-orbit]");
    if (!root) return;
    root.textContent = "";
    pickHeroOrbitChips(categories).forEach((item, index) => {
      const slot = item.slot;
      const link = document.createElement("a");
      link.className = "hero-orbit-chip";
      link.href = categoryHref(item.parent.slug, item.mid && item.mid.slug, item.child.slug);
      link.style.setProperty("--chip-top", slot.top + "%");
      link.style.setProperty("--chip-left", slot.left + "%");
      link.style.setProperty("--float-delay", slot.delay + "s");
      link.style.setProperty("--float-dur", slot.dur + "s");
      link.style.setProperty("--chip-hue", String((index * 47 + 210) % 360));
      link.setAttribute("aria-label", item.child.name);
      link.innerHTML =
        '<span class="hero-orbit-chip-icon">' +
        iconForChildSlug(item.child.slug) +
        '</span><span class="hero-orbit-chip-label">' +
        item.child.name +
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
    return fetch(NAV_SOURCE, { cache: "default" })
      .then((res) => {
        if (!res.ok) throw new Error("Kategori menüsü yüklenemedi");
        return res.json();
      })
      .catch(() =>
        fetch(NAV_SOURCE_FALLBACK, { cache: "default" }).then((res) => {
          if (!res.ok) throw new Error("Kategori menüsü yüklenemedi");
          return res.json();
        })
      )
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
        window.setTimeout(() => {
          fetch(NAV_SOURCE, { cache: "no-store" })
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
            .catch(() => {});
        }, 1500);
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
