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

  function currentPath() {
    return (location.pathname || "/").replace(/\/$/, "") || "/";
  }

  function isActivePage(href) {
    const path = currentPath();
    if (href === "/") return path === "/";
    return path === href || path.startsWith(href);
  }

  function closeAllMega(root) {
    root.querySelectorAll(".nav-mega").forEach((item) => {
      item.classList.remove("open");
      const btn = item.querySelector(".nav-mega-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function buildSecondaryLinks() {
    const frag = document.createDocumentFragment();
    const links = [
      { href: "/markalar", label: "Markalar" },
      { href: "/kurumsal", label: "Kurumsal" },
      { href: "/iletisim", label: "İletişim" },
    ];
    links.forEach((row) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = row.href;
      a.textContent = row.label;
      if (isActivePage(row.href)) a.classList.add("active");
      li.appendChild(a);
      frag.appendChild(li);
    });
    return frag;
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

    const heading = document.createElement("a");
    heading.className = "nav-mega-parent";
    heading.href = categoryHref(category.slug);
    heading.textContent = "Tümü: " + category.name;
    panel.appendChild(heading);

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

    li.addEventListener("mouseenter", () => {
      if (window.matchMedia("(min-width: 861px)").matches) {
        const root = li.closest(".nav-links");
        if (root) closeAllMega(root);
        li.classList.add("open");
        toggle.setAttribute("aria-expanded", "true");
      }
    });
    li.addEventListener("mouseleave", () => {
      if (window.matchMedia("(min-width: 861px)").matches) {
        li.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });

    li.appendChild(toggle);
    li.appendChild(panel);
    return li;
  }

  function renderNav(root, categories) {
    root.textContent = "";
    (categories || []).forEach((cat) => root.appendChild(buildMegaItem(cat)));
    root.appendChild(buildSecondaryLinks());
  }

  function bindChrome(root) {
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeAllMega(root);
    });
    document.addEventListener("click", (ev) => {
      if (!root.contains(ev.target)) closeAllMega(root);
    });
  }

  function init() {
    const root = document.querySelector("[data-site-nav]");
    if (!root) return;

    bindChrome(root);

    fetch(NAV_SOURCE, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Kategori menüsü yüklenemedi");
        return res.json();
      })
      .then((data) => {
        const categories = Array.isArray(data && data.categories) ? data.categories : [];
        renderNav(root, categories);
        window.PatygoNav = {
          categories,
          categoryHref,
        };
        document.dispatchEvent(new CustomEvent("patygo:nav-ready"));
      })
      .catch(() => {
        root.textContent = "";
        root.appendChild(buildSecondaryLinks());
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
