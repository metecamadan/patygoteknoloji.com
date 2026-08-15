/* Patygo — ürün kataloğu (products.json) */
(function () {
  "use strict";

  const CATEGORY_LABELS = {
    "bilgisayar-tablet": "Bilgisayar / Tablet",
    "bilgisayar-bilesenleri": "Bilgisayar Bileşenleri",
    "baski-cozumleri": "Baskı Çözümleri",
    "kartus-toner": "Kartuş Toner",
    "ofis-urunleri": "Ofis Ürünleri",
    "yapi-gerecleri": "Yapı Gereçleri",
    "kisisel-bilgisayarlar": "Bilgisayar / Tablet",
    "oem-cevre-birimleri": "Bilgisayar Bileşenleri",
    "cevre-baski-birimleri": "Baskı Çözümleri",
  };
  const CATEGORY_QUERY_ALIASES = {
    "kisisel-bilgisayarlar": "bilgisayar-tablet",
    "oem-cevre-birimleri": "bilgisayar-bilesenleri",
    "cevre-baski-birimleri": "baski-cozumleri",
    "tuketici-elektronigi": "bilgisayar-bilesenleri",
    "kurumsal-ag-urunleri": "bilgisayar-tablet",
  };

  window.PatygoCatalog = {
    list: [],
    byId: {},
    ready: null,
    ALLOWED_VAT: [1, 8, 10, 20],
    normalizeVatPercent(value) {
      const n = Number(value);
      return this.ALLOWED_VAT.includes(n) ? n : 20;
    },
    /** Stored price is KDV hariç; returns KDV dahil tutar. */
    priceInclVat(productOrPrice, vatPercent) {
      let net;
      let vat;
      if (productOrPrice && typeof productOrPrice === "object") {
        net = Number(productOrPrice.price) || 0;
        vat = this.normalizeVatPercent(productOrPrice.vatPercent);
      } else {
        net = Number(productOrPrice) || 0;
        vat = this.normalizeVatPercent(vatPercent);
      }
      return Math.round(net * (1 + vat / 100) * 100) / 100;
    },
    formatPrice(amount) {
      return (
        "₺" +
        Math.round(Number(amount) || 0).toLocaleString("tr-TR", {
          maximumFractionDigits: 0,
        })
      );
    },
    categoryLabel(cat) {
      if (CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat];
      const navCats = window.PatygoNav && window.PatygoNav.categories;
      if (Array.isArray(navCats)) {
        const parent = navCats.find((row) => row.slug === cat);
        if (parent && parent.name) return parent.name;
      }
      return cat || "";
    },
  };

  function renderCategoryEmpty(grid, resolved) {
    grid.textContent = "";
    const empty = document.createElement("div");
    empty.className = "catalog-empty";
    empty.style.gridColumn = "1 / -1";
    const heading = document.createElement("h2");
    heading.textContent = "Bu kategoride henüz ürün yok";
    const text = document.createElement("p");
    text.style.color = "var(--muted)";
    text.textContent = resolved
      ? (resolved.child ? resolved.child.name : resolved.parent.name) +
        " için yayınlanmış ürün yok. Diğer kategorilere göz atabilirsiniz."
      : "Seçilen kategori için yayınlanmış ürün yok.";
    const actions = document.createElement("div");
    actions.className = "hero-cta";
    actions.style.marginTop = "16px";
    const all = document.createElement("a");
    all.className = "btn btn-primary";
    all.href = "/urunler";
    all.textContent = "Tüm ürünler";
    actions.appendChild(all);
    empty.appendChild(heading);
    empty.appendChild(text);
    empty.appendChild(actions);
    grid.appendChild(empty);
  }

  function readCategoryQuery() {
    const params = new URLSearchParams(location.search || "");
    const rawParent = String(params.get("kategori") || "").trim();
    return {
      parent: CATEGORY_QUERY_ALIASES[rawParent] || rawParent,
      mid: String(params.get("ara") || "").trim(),
      child: String(params.get("alt") || "").trim(),
    };
  }

  function resolveCategoryLabels(categories, query) {
    const parents = Array.isArray(categories) ? categories : [];
    const parent = parents.find((cat) => cat.slug === query.parent) || null;
    if (!parent) return null;
    const mid =
      query.mid && Array.isArray(parent.children)
        ? parent.children.find((row) => row.slug === query.mid) || null
        : null;
    if (query.mid && !mid) return null;
    const leafSource = mid ? mid.children || [] : parent.children || [];
    const child =
      query.child && Array.isArray(leafSource)
        ? leafSource.find((row) => row.slug === query.child) || null
        : null;
    if (query.child && !child) return null;
    return { parent, mid, child };
  }

  function applyCategoryHeading(resolved) {
    const crumb = document.querySelector("[data-catalog-crumb]");
    const title = document.querySelector("[data-catalog-title]");
    const lead = document.querySelector("[data-catalog-lead]");
    if (!resolved) return;
    const label = resolved.child
      ? resolved.child.name
      : resolved.mid
        ? resolved.mid.name
        : resolved.parent.name;
    if (crumb) crumb.textContent = label;
    if (title) title.textContent = label;
    if (lead) {
      const parts = [resolved.parent.name];
      if (resolved.mid) parts.push(resolved.mid.name);
      if (resolved.child) parts.push(resolved.child.name);
      lead.textContent = parts.join(" / ") + " kategorisindeki ürünler.";
    }
    document.title = label + " | Patygo Teknoloji";
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
    const gallery = (
      Array.isArray(product.images) && product.images.length
        ? product.images
        : primaryImage
          ? [primaryImage]
          : []
    ).filter(Boolean);
    const visual = document.createElement("div");
    visual.className = "visual" + (gallery.length ? " has-image" : "");
    if (gallery.length) {
      const img = document.createElement("img");
      img.src = gallery[0];
      img.alt = product.name || brand;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        const next = gallery.find((url) => url && url !== img.getAttribute("src"));
        if (next && img.dataset.fallback !== "1") {
          img.dataset.fallback = "1";
          img.src = next;
          return;
        }
        visual.classList.remove("has-image");
        img.remove();
        const brandSpan = document.createElement("span");
        brandSpan.textContent = brand;
        visual.appendChild(brandSpan);
      });
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

    if (
      product.description &&
      String(product.description).trim() &&
      String(product.description).trim() !== String(product.name || "").trim()
    ) {
      const desc = document.createElement("p");
      desc.className = "product-desc";
      desc.textContent = product.description;
      body.appendChild(desc);
    }

    const price = document.createElement("div");
    price.className = "price";
    price.appendChild(
      document.createTextNode(
        window.PatygoCatalog.formatPrice(window.PatygoCatalog.priceInclVat(product)) + " "
      )
    );
    const small = document.createElement("small");
    small.textContent = "KDV dahil";
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
          vatPercent: product.vatPercent,
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

    actions.appendChild(cartBtn);
    actions.appendChild(buy);
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

  const FEATURED_PER_CATEGORY = 12;
  const FEATURED_PARENTS = [
    "bilgisayar-tablet",
    "bilgisayar-bilesenleri",
    "kartus-toner",
    "baski-cozumleri",
    "yapi-gerecleri",
    "ofis-urunleri",
  ];

  function mixFeatured(byParent, limit) {
    const queues = FEATURED_PARENTS.map((slug) => ((byParent && byParent[slug]) || []).slice());
    const seen = new Set();
    const mixed = [];
    let added = true;
    while (added && mixed.length < limit) {
      added = false;
      queues.forEach((queue) => {
        if (mixed.length >= limit) return;
        while (queue.length) {
          const item = queue.shift();
          if (!item || seen.has(item.id)) continue;
          seen.add(item.id);
          mixed.push(item);
          added = true;
          break;
        }
      });
    }
    return mixed;
  }

  function bindFeaturedTabs(byParent) {
    const section = document.getElementById("urunler") || document;
    const tablist = section.querySelector(".product-tabs");
    const grid = document.querySelector('.product-grid[data-catalog="featured"]');
    if (!tablist || !grid) return;
    tablist.querySelectorAll("button").forEach((btn) => {
      const next = btn.cloneNode(true);
      btn.parentNode.replaceChild(next, btn);
    });
    const tabs = tablist.querySelectorAll("button");
    const show = (filter) => {
      tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.filter === filter));
      const list =
        filter === "all"
          ? mixFeatured(byParent, FEATURED_PER_CATEGORY)
          : ((byParent && byParent[filter]) || []).slice(0, FEATURED_PER_CATEGORY);
      renderGrid(grid, list, {});
    };
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => show(btn.dataset.filter || "all"));
    });
    const active = tablist.querySelector("button.active");
    show((active && active.dataset.filter) || "all");
  }

  function productsForSiteCategory(products, query) {
    const parent = String((query && query.parent) || "").trim();
    const mid = String((query && query.mid) || "").trim();
    const child = String((query && query.child) || "").trim();
    if (!parent && !mid && !child) return products.slice();
    return products.filter((product) => {
      if (parent && String(product.category || "") !== parent) return false;
      if (mid && String(product.mid || "") !== mid) return false;
      if (child) {
        const alt = String(product.alt || "");
        const productMid = String(product.mid || "");
        if (alt !== child && !( !mid && productMid === child)) return false;
      }
      return true;
    });
  }

  function renderGrid(grid, products, options) {
    const opts = options || {};
    const mode = grid.getAttribute("data-catalog") || "all";
    let list = products.slice();
    if (mode === "featured") list = list.slice(0, FEATURED_PER_CATEGORY);
    if (opts.categoryQuery) list = productsForSiteCategory(list, opts.categoryQuery);
    grid.textContent = "";
    if (!list.length && opts.categoryResolved) {
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

  function renderCatalogPager(meta) {
    const pager = document.querySelector("[data-catalog-pager]");
    if (!pager) return;
    pager.textContent = "";
    const totalPages = Number(meta && meta.totalPages) || 0;
    const page = Number(meta && meta.page) || 1;
    if (totalPages <= 1) {
      pager.hidden = true;
      return;
    }
    pager.hidden = false;
    const addBtn = (label, target, options) => {
      const opts = options || {};
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (opts.current) btn.className = "is-current";
      btn.disabled = !!opts.disabled;
      btn.addEventListener("click", () => {
        const url = new URL(location.href);
        url.searchParams.set("sayfa", String(target));
        history.pushState({}, "", url.pathname + url.search);
        reloadCatalog();
      });
      pager.appendChild(btn);
    };
    addBtn("‹", page - 1, { disabled: page <= 1 });
    addBtn(String(page), page, { current: true, disabled: true });
    addBtn("›", page + 1, { disabled: page >= totalPages });
  }

  function applyCatalog(all, options) {
    const opts = options || {};
    const products = (all || []).filter((p) => p && p.active !== false);
    window.PatygoCatalog.list = products;
    Object.assign(window.PatygoCatalog.byId, Object.fromEntries(products.map((p) => [p.id, p])));
    document.querySelectorAll(".product-grid[data-catalog]").forEach((grid) => {
      renderGrid(grid, products, opts);
    });
    renderCatalogPager(opts.pager || null);
    if (opts.featuredTabs) bindFeaturedTabs(opts.featuredTabs);
    else if (!opts.categoryResolved) bindTabs(document);
    window.dispatchEvent(new CustomEvent("patygo:catalog", { detail: { products } }));
    return products;
  }

  function showFeaturedLoading(grid) {
    if (!grid) return;
    grid.textContent = "";
    const note = document.createElement("p");
    note.style.color = "var(--muted)";
    note.style.gridColumn = "1 / -1";
    note.textContent = "Ürünler yükleniyor…";
    grid.appendChild(note);
  }

  async function fetchProductPage(params) {
    const qs = new URLSearchParams();
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && String(value) !== "") qs.set(key, String(value));
    });
    qs.set("t", String(Date.now()));
    const res = await fetch("/api/products?" + qs.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("Katalog yüklenemedi");
    const data = await res.json();
    const products = Array.isArray(data.products) ? data.products : Array.isArray(data) ? data : [];
    return {
      products,
      total: Number(data.total) || products.length,
      page: Number(data.page) || 1,
      limit: Number(data.limit) || products.length,
      totalPages: Number(data.totalPages) || 0,
      byParent: data.byParent && typeof data.byParent === "object" ? data.byParent : null,
    };
  }

  async function fetchHomeFeatured() {
    const home = await fetchProductPage({ homeFeatured: "1", limit: FEATURED_PER_CATEGORY });
    const byParent = {};
    FEATURED_PARENTS.forEach((slug) => {
      byParent[slug] = ((home.byParent && home.byParent[slug]) || []).slice(0, FEATURED_PER_CATEGORY);
    });
    const mixed =
      Array.isArray(home.products) && home.products.length
        ? home.products.slice(0, FEATURED_PER_CATEGORY)
        : mixFeatured(byParent, FEATURED_PER_CATEGORY);
    return { byParent, mixed };
  }

  async function fetchHomeFeaturedFallback() {
    const featuredParents = FEATURED_PARENTS.slice();
    const pages = await Promise.allSettled(
      featuredParents.map((kategori) => fetchProductPage({ kategori: kategori, limit: FEATURED_PER_CATEGORY }))
    );
    const byParent = {};
    featuredParents.forEach((slug, index) => {
      const result = pages[index];
      const products =
        result && result.status === "fulfilled" ? result.value.products || [] : [];
      byParent[slug] = products.slice(0, FEATURED_PER_CATEGORY);
    });
    return { byParent, mixed: mixFeatured(byParent, FEATURED_PER_CATEGORY) };
  }

  async function loadCategories() {
    try {
      const res = await fetch("/assets/data/categories.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.categories)) return data.categories;
      }
    } catch (_) {}
    if (window.PatygoNav && Array.isArray(window.PatygoNav.categories)) {
      return window.PatygoNav.categories;
    }
    return [];
  }

  async function reloadCatalog() {
    const path = location.pathname || "";
    const query = readCategoryQuery();
    const pageParam = Math.max(1, Number(new URLSearchParams(location.search).get("sayfa")) || 1);
    const onProductsPage = /\/urunler\/?$/i.test(path);
    const onDetailPage = /\/urun-detay\/?$/i.test(path);
    const onCartPage = /\/sepet\/?$/i.test(path) || /\/odeme\/?$/i.test(path);
    const wantsCategory = onProductsPage && (query.parent || query.mid || query.child);
    const categories = await loadCategories();
    let categoryResolved = null;
    if (wantsCategory) {
      categoryResolved = resolveCategoryLabels(categories, query);
      if (categoryResolved) applyCategoryHeading(categoryResolved);
    }

    let payload = { products: [], total: 0, page: 1, totalPages: 0 };
    let featuredTabs = null;
    try {
      if (onDetailPage) {
        const id = new URLSearchParams(location.search).get("id") || "";
        payload = id ? await fetchProductPage({ id }) : payload;
      } else if (onCartPage) {
        const ids = (window.PatygoCart ? window.PatygoCart.list() : [])
          .map((item) => item.id)
          .filter(Boolean)
          .join(",");
        payload = ids ? await fetchProductPage({ ids }) : payload;
      } else if (document.querySelector('.product-grid[data-catalog="featured"]')) {
        showFeaturedLoading(document.querySelector('.product-grid[data-catalog="featured"]'));
        let home = null;
        try {
          home = await fetchHomeFeatured();
        } catch (_) {
          home = null;
        }
        const hasAny =
          home &&
          FEATURED_PARENTS.some((slug) => ((home.byParent && home.byParent[slug]) || []).length);
        if (!hasAny) {
          try {
            home = await fetchHomeFeaturedFallback();
          } catch (_) {
            home = { byParent: {}, mixed: [] };
          }
        }
        if (!home) home = { byParent: {}, mixed: [] };
        window.PatygoCatalog.featuredByParent = home.byParent;
        payload = {
          products: home.mixed,
          total: home.mixed.length,
          page: 1,
          totalPages: 1,
        };
        featuredTabs = home.byParent;
      } else {
        payload = await fetchProductPage({
          kategori: wantsCategory ? query.parent : "",
          ara: wantsCategory ? query.mid : "",
          alt: wantsCategory ? query.child : "",
          page: pageParam,
          limit: 48,
        });
      }
    } catch (_) {
      payload = { products: [], total: 0, page: 1, totalPages: 0 };
    }

    return applyCatalog(payload.products, {
      categoryQuery: null,
      categoryResolved: wantsCategory
        ? categoryResolved || { parent: { name: "Kategori" }, child: null }
        : null,
      pager: onProductsPage ? payload : null,
      featuredTabs,
    });
  }

  window.PatygoCatalog.reload = reloadCatalog;
  window.PatygoCatalog.fetchProductPage = fetchProductPage;

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

  window.addEventListener("popstate", () => {
    if (/\/urunler\/?$/i.test(location.pathname || "")) reloadCatalog();
  });
})();
