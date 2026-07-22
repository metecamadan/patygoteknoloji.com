/* Patygo — ürün kataloğu (products.json) */
(function () {
  "use strict";

  const CATEGORY_LABELS = {
    bilgisayar: "Bilgisayar",
    yazici: "Yazıcı",
    "kucuk-ev": "Küçük Ev Aletleri",
    "beyaz-esya": "Beyaz Eşya",
  };

  window.PatygoCatalog = {
    list: [],
    byId: {},
    ready: null,
    formatPrice(amount) {
      return (
        "₺" +
        Math.round(Number(amount) || 0).toLocaleString("tr-TR", {
          maximumFractionDigits: 0,
        })
      );
    },
    categoryLabel(cat) {
      return CATEGORY_LABELS[cat] || cat || "";
    },
  };

  function quoteHref() {
    const path = (location.pathname || "").toLowerCase();
    if (path === "/" || path === "") return "#teklif";
    return "/#teklif";
  }

  function readCategoryQuery() {
    const params = new URLSearchParams(location.search || "");
    return {
      parent: String(params.get("kategori") || "").trim(),
      child: String(params.get("alt") || "").trim(),
    };
  }

  function resolveCategoryLabels(categories, query) {
    const parents = Array.isArray(categories) ? categories : [];
    const parent = parents.find((cat) => cat.slug === query.parent) || null;
    if (!parent) return null;
    const child =
      query.child && Array.isArray(parent.children)
        ? parent.children.find((row) => row.slug === query.child) || null
        : null;
    if (query.child && !child) return null;
    return { parent, child };
  }

  function applyCategoryHeading(resolved) {
    const crumb = document.querySelector("[data-catalog-crumb]");
    const title = document.querySelector("[data-catalog-title]");
    const lead = document.querySelector("[data-catalog-lead]");
    if (!resolved) return;
    const label = resolved.child ? resolved.child.name : resolved.parent.name;
    if (crumb) crumb.textContent = label;
    if (title) title.textContent = label;
    if (lead) {
      lead.textContent = resolved.child
        ? resolved.parent.name + " / " + resolved.child.name + " kategorisindeki ürünler."
        : resolved.parent.name + " kategorisindeki ürünler.";
    }
    document.title = label + " | Patygo Teknoloji";
  }

  function renderCategoryEmpty(grid, resolved) {
    grid.textContent = "";
    const empty = document.createElement("div");
    empty.className = "catalog-empty";
    empty.style.gridColumn = "1 / -1";
    const heading = document.createElement("h2");
    heading.textContent = "Bu kategori yakında";
    const text = document.createElement("p");
    text.style.color = "var(--muted)";
    text.textContent = resolved
      ? (resolved.child ? resolved.child.name : resolved.parent.name) +
        " için ürünler hazırlanıyor. Tüm kataloğu inceleyebilir veya teklif talebi gönderebilirsiniz."
      : "Seçilen kategori için ürünler hazırlanıyor.";
    const actions = document.createElement("div");
    actions.className = "hero-cta";
    actions.style.marginTop = "16px";
    const all = document.createElement("a");
    all.className = "btn btn-outline";
    all.href = "/urunler";
    all.textContent = "Tüm ürünler";
    const quote = document.createElement("a");
    quote.className = "btn btn-primary";
    quote.href = quoteHref();
    quote.textContent = "Teklif Al";
    actions.appendChild(all);
    actions.appendChild(quote);
    empty.appendChild(heading);
    empty.appendChild(text);
    empty.appendChild(actions);
    grid.appendChild(empty);
  }

  function makeCard(product, index) {
    const article = document.createElement("article");
    const delay = index % 3 === 1 ? " d1" : index % 3 === 2 ? " d2" : "";
    article.className = "product-card reveal" + delay + " in";
    article.dataset.cat = product.category || "";

    const brand = String(product.brand || "").toUpperCase();
    const primaryImage =
      (Array.isArray(product.images) && product.images.find(Boolean)) ||
      product.image ||
      "";
    const visual = document.createElement("div");
    visual.className = "visual" + (primaryImage ? " has-image" : "");
    if (primaryImage) {
      const img = document.createElement("img");
      img.src = primaryImage;
      img.alt = product.name || brand;
      img.loading = "lazy";
      visual.appendChild(img);
    } else {
      const brandSpan = document.createElement("span");
      brandSpan.textContent = brand;
      visual.appendChild(brandSpan);
    }

    const body = document.createElement("div");
    body.className = "body";

    const tag = document.createElement("span");
    tag.className = "brand-tag";
    tag.textContent = brand;

    const title = document.createElement("h3");
    const titleLink = document.createElement("a");
    titleLink.href = "/urun-detay?id=" + encodeURIComponent(product.id);
    titleLink.textContent = product.name || "";
    title.appendChild(titleLink);

    body.appendChild(tag);
    body.appendChild(title);

    if (product.description) {
      const desc = document.createElement("p");
      desc.className = "product-desc";
      desc.textContent = product.description;
      body.appendChild(desc);
    }

    const price = document.createElement("div");
    price.className = "price";
    price.appendChild(
      document.createTextNode(window.PatygoCatalog.formatPrice(product.price) + " ")
    );
    const small = document.createElement("small");
    small.textContent = "+KDV";
    price.appendChild(small);

    const actions = document.createElement("div");
    actions.className = "actions";

    const cartBtn = document.createElement("button");
    cartBtn.type = "button";
    cartBtn.className = "btn btn-buy";
    cartBtn.textContent = "Sepete Ekle";
    cartBtn.addEventListener("click", () => {
      if (window.PatygoCart) {
        window.PatygoCart.add(product.id, 1, {
          brand: product.brand,
          name: product.name,
          price: product.price,
        });
        cartBtn.textContent = "Eklendi";
        setTimeout(() => {
          cartBtn.textContent = "Sepete Ekle";
        }, 1200);
      }
    });

    const buy = document.createElement("a");
    buy.className = "btn btn-outline";
    buy.href = "/odeme?id=" + encodeURIComponent(product.id);
    buy.textContent = "Hemen Al";

    const quote = document.createElement("a");
    quote.className = "btn btn-quote";
    quote.href = quoteHref();
    quote.textContent = "Teklif Al";

    actions.appendChild(cartBtn);
    actions.appendChild(buy);
    actions.appendChild(quote);
    body.appendChild(price);
    body.appendChild(actions);
    article.appendChild(visual);
    article.appendChild(body);
    return article;
  }

  function bindTabs(root) {
    const tabs = root.querySelectorAll(".product-tabs button");
    const cards = root.querySelectorAll(".product-card");
    if (!tabs.length || !cards.length) return;
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabs.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const filter = btn.dataset.filter;
        cards.forEach((card) => {
          card.hidden = !(filter === "all" || card.dataset.cat === filter);
        });
      });
    });
  }

  function renderGrid(grid, products, options) {
    const opts = options || {};
    const mode = grid.getAttribute("data-catalog") || "all";
    let list = products.slice();
    if (mode === "featured") list = list.filter((p) => p.featured);
    grid.textContent = "";
    if (opts.categoryResolved) {
      renderCategoryEmpty(grid, opts.categoryResolved);
      return;
    }
    if (!list.length) {
      const empty = document.createElement("p");
      empty.style.color = "var(--muted)";
      empty.style.gridColumn = "1 / -1";
      empty.textContent = "Henüz yayınlanmış ürün yok.";
      grid.appendChild(empty);
      return;
    }
    list.forEach((product, index) => grid.appendChild(makeCard(product, index)));
  }

  function applyCatalog(all, options) {
    const opts = options || {};
    const products = (all || []).filter((p) => p && p.active !== false);
    window.PatygoCatalog.list = products;
    window.PatygoCatalog.byId = Object.fromEntries(products.map((p) => [p.id, p]));
    document.querySelectorAll(".product-grid[data-catalog]").forEach((grid) => {
      renderGrid(grid, products, opts);
    });
    if (!opts.categoryResolved) bindTabs(document);
    window.dispatchEvent(new CustomEvent("patygo:catalog", { detail: { products } }));
    return products;
  }

  async function loadProducts() {
    const bust = "?t=" + Date.now();
    try {
      const res = await fetch("/api/products" + bust, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.products)) return data.products;
        if (Array.isArray(data)) return data;
      }
    } catch (_) {}
    return [];
  }

  async function loadCategories() {
    if (window.PatygoNav && Array.isArray(window.PatygoNav.categories)) {
      return window.PatygoNav.categories;
    }
    try {
      const res = await fetch("/assets/data/categories.json", { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.categories) ? data.categories : [];
    } catch (_) {
      return [];
    }
  }

  async function reloadCatalog() {
    const query = readCategoryQuery();
    const onProductsPage = /\/urunler\/?$/i.test(location.pathname || "");
    const wantsCategory = onProductsPage && (query.parent || query.child);
    const [all, categories] = await Promise.all([loadProducts(), loadCategories()]);
    let categoryResolved = null;
    if (wantsCategory) {
      categoryResolved = resolveCategoryLabels(categories, query);
      if (categoryResolved) applyCategoryHeading(categoryResolved);
    }
    return applyCatalog(all, {
      categoryResolved: wantsCategory ? categoryResolved || { parent: { name: "Kategori" }, child: null } : null,
    });
  }

  window.PatygoCatalog.reload = reloadCatalog;

  window.PatygoCatalog.ready = reloadCatalog();

  document.addEventListener("patygo:nav-ready", () => {
    if (/\/urunler\/?$/i.test(location.pathname || "") && location.search) {
      reloadCatalog();
    }
  });

  // Panel kaydettiğinde açık site sekmeleri güncellensin
  try {
    const bc = new BroadcastChannel("patygo-catalog");
    bc.onmessage = function (ev) {
      if (ev && ev.data && ev.data.type === "updated") reloadCatalog();
    };
  } catch (_) {}

  window.addEventListener("storage", (ev) => {
    if (ev.key === "patygo_catalog_version") reloadCatalog();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reloadCatalog();
  });
})();
