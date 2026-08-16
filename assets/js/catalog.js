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
    productHref(id) {
      return "/urun-detay?id=" + encodeURIComponent(id || "");
    },
    categoryHref(parentSlug, midSlug, childSlug) {
      const params = new URLSearchParams();
      if (parentSlug) params.set("kategori", parentSlug);
      if (midSlug) params.set("ara", midSlug);
      if (childSlug) params.set("alt", childSlug);
      const q = params.toString();
      return q ? "/urunler?" + q : "/urunler";
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
    all.textContent = "Ürün kataloğunu incele";
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

  function readFacetQuery() {
    const params = new URLSearchParams(location.search || "");
    const brands = String(params.get("marka") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const minRaw = Number(params.get("minFiyat"));
    const maxRaw = Number(params.get("maxFiyat"));
    return {
      brands,
      minFiyat: Number.isFinite(minRaw) && minRaw > 0 ? String(Math.round(minRaw)) : "",
      maxFiyat: Number.isFinite(maxRaw) && maxRaw > 0 ? String(Math.round(maxRaw)) : "",
    };
  }

  function writeFacetQuery(next) {
    const url = new URL(location.href);
    const brands = (next.brands || []).map((item) => String(item || "").trim()).filter(Boolean);
    if (brands.length) url.searchParams.set("marka", brands.join(","));
    else url.searchParams.delete("marka");
    if (next.minFiyat) url.searchParams.set("minFiyat", String(next.minFiyat));
    else url.searchParams.delete("minFiyat");
    if (next.maxFiyat) url.searchParams.set("maxFiyat", String(next.maxFiyat));
    else url.searchParams.delete("maxFiyat");
    url.searchParams.delete("sayfa");
    history.pushState({}, "", url.pathname + url.search);
    reloadCatalog();
  }

  function renderCatalogMeta(total, applied) {
    const meta = document.querySelector("[data-catalog-meta]");
    if (!meta) return;
    const count = Number(total) || 0;
    const active =
      (applied && applied.brands && applied.brands.length) ||
      (applied && applied.minFiyat) ||
      (applied && applied.maxFiyat);
    meta.hidden = false;
    meta.textContent = count + " ürün";
    if (active) meta.textContent += " (filtrelenmiş)";
  }

  function renderFacets(facets, applied) {
    const root = document.querySelector("[data-catalog-facets]");
    const layout = document.querySelector(".catalog-layout");
    if (!root) return;
    const data = facets || {};
    const brands = Array.isArray(data.brands) ? data.brands : [];
    const presets = Array.isArray(data.pricePresets) ? data.pricePresets : [];
    const price = data.price || { min: 0, max: 0 };
    const selected = new Set(
      ((applied && applied.brands) || []).map((name) => String(name).toLocaleUpperCase("tr-TR"))
    );
    const hasPanel = brands.length > 0 || price.max > 0;
    root.hidden = !hasPanel;
    if (layout) layout.classList.toggle("has-facets", hasPanel);
    if (!hasPanel) {
      root.textContent = "";
      return;
    }

    const selectedMin = applied && applied.minFiyat ? Number(applied.minFiyat) : 0;
    const selectedMax = applied && applied.maxFiyat ? Number(applied.maxFiyat) : 0;
    const filterActive = selected.size || selectedMin || selectedMax;

    root.textContent = "";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "catalog-facets-toggle";
    toggle.textContent = "Filtrele";
    toggle.setAttribute("aria-expanded", root.classList.contains("is-open") ? "true" : "false");
    toggle.addEventListener("click", () => {
      root.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", root.classList.contains("is-open") ? "true" : "false");
    });
    root.appendChild(toggle);

    const body = document.createElement("div");
    body.className = "catalog-facets-body";

    const heading = document.createElement("h2");
    heading.className = "catalog-facets-title";
    heading.textContent = "Filtreler";
    body.appendChild(heading);

    if (brands.length) {
      const group = document.createElement("fieldset");
      group.className = "catalog-facet";
      const legend = document.createElement("legend");
      legend.textContent = "Marka";
      group.appendChild(legend);
      const list = document.createElement("div");
      list.className = "catalog-facet-brands";
      brands.forEach((row) => {
        const label = document.createElement("label");
        label.className = "catalog-facet-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = row.name;
        input.checked = selected.has(String(row.name).toLocaleUpperCase("tr-TR"));
        input.addEventListener("change", () => {
          const next = Array.from(list.querySelectorAll("input:checked")).map((el) => el.value);
          writeFacetQuery({
            brands: next,
            minFiyat: applied.minFiyat || "",
            maxFiyat: applied.maxFiyat || "",
          });
        });
        const name = document.createElement("span");
        name.textContent = row.name;
        const count = document.createElement("em");
        count.textContent = String(row.count);
        label.appendChild(input);
        label.appendChild(name);
        label.appendChild(count);
        list.appendChild(label);
      });
      group.appendChild(list);
      body.appendChild(group);
    }

    if (price.max > 0) {
      const group = document.createElement("fieldset");
      group.className = "catalog-facet";
      const legend = document.createElement("legend");
      legend.textContent = "Fiyat aralığı";
      group.appendChild(legend);
      if (presets.length) {
        const chips = document.createElement("div");
        chips.className = "catalog-price-presets";
        presets.forEach((row) => {
          const btn = document.createElement("button");
          btn.type = "button";
          const rowMin = Number(row.min) || 0;
          const rowMax = row.max == null ? 0 : Number(row.max) || 0;
          const pressed = selectedMin === rowMin && selectedMax === rowMax;
          btn.className = "catalog-price-chip" + (pressed ? " is-active" : "");
          btn.textContent = row.label;
          btn.addEventListener("click", () => {
            writeFacetQuery({
              brands: applied.brands || [],
              minFiyat: rowMin ? String(rowMin) : "",
              maxFiyat: rowMax ? String(rowMax) : "",
            });
          });
          chips.appendChild(btn);
        });
        group.appendChild(chips);
      }
      const inputs = document.createElement("div");
      inputs.className = "catalog-price-inputs";
      const minInput = document.createElement("input");
      minInput.type = "number";
      minInput.min = "0";
      minInput.step = "100";
      minInput.placeholder = "En az";
      minInput.setAttribute("aria-label", "En az fiyat");
      minInput.value = applied.minFiyat || "";
      const maxInput = document.createElement("input");
      maxInput.type = "number";
      maxInput.min = "0";
      maxInput.step = "100";
      maxInput.placeholder = "En çok";
      maxInput.setAttribute("aria-label", "En çok fiyat");
      maxInput.value = applied.maxFiyat || "";
      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "btn btn-outline catalog-price-apply";
      applyBtn.textContent = "Uygula";
      applyBtn.addEventListener("click", () => {
        writeFacetQuery({
          brands: applied.brands || [],
          minFiyat: minInput.value && Number(minInput.value) > 0 ? String(Math.round(Number(minInput.value))) : "",
          maxFiyat: maxInput.value && Number(maxInput.value) > 0 ? String(Math.round(Number(maxInput.value))) : "",
        });
      });
      const applyOnEnter = (ev) => {
        if (ev.key === "Enter") applyBtn.click();
      };
      minInput.addEventListener("keydown", applyOnEnter);
      maxInput.addEventListener("keydown", applyOnEnter);
      inputs.appendChild(minInput);
      inputs.appendChild(maxInput);
      group.appendChild(inputs);
      group.appendChild(applyBtn);
      body.appendChild(group);
    }

    if (filterActive) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "catalog-facets-clear";
      clear.textContent = "Filtreleri temizle";
      clear.addEventListener("click", () => {
        writeFacetQuery({ brands: [], minFiyat: "", maxFiyat: "" });
      });
      body.appendChild(clear);
    }

    root.appendChild(body);
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
    const nav = crumb && crumb.closest(".breadcrumb");
    if (nav) {
      nav.textContent = "";
      const addSep = () => {
        const sep = document.createElement("span");
        sep.textContent = "/";
        nav.appendChild(sep);
      };
      const addLink = (href, text) => {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = text;
        nav.appendChild(a);
      };
      addLink("/", "Ana Sayfa");
      addSep();
      addLink("/urunler", "Ürün kataloğu");
      addSep();
      if (resolved.child || resolved.mid) {
        addLink(window.PatygoCatalog.categoryHref(resolved.parent.slug), resolved.parent.name);
        addSep();
        if (resolved.child && resolved.mid) {
          addLink(
            window.PatygoCatalog.categoryHref(resolved.parent.slug, resolved.mid.slug),
            resolved.mid.name
          );
          addSep();
        }
      }
      const current = document.createElement("span");
      current.setAttribute("data-catalog-crumb", "");
      current.textContent = label;
      nav.appendChild(current);
    } else if (crumb) {
      crumb.textContent = label;
    }
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
    titleLink.href = window.PatygoCatalog.productHref(product.id);
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
    const visualWrap = document.createElement("a");
    visualWrap.className = "product-card-media";
    visualWrap.href = window.PatygoCatalog.productHref(product.id);
    visualWrap.appendChild(visual);
    article.appendChild(visualWrap);
    article.appendChild(body);
    return article;
  }

  function bindTabs(root) {
    const tabs = root.querySelectorAll(".product-tabs [data-filter]");
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
    tablist.querySelectorAll("[data-filter]").forEach((btn) => {
      const next = btn.cloneNode(true);
      btn.parentNode.replaceChild(next, btn);
    });
    const tabs = tablist.querySelectorAll("[data-filter]");
    const show = (filter) => {
      tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.filter === filter));
      const list =
        filter === "all"
          ? mixFeatured(byParent, FEATURED_PER_CATEGORY)
          : ((byParent && byParent[filter]) || []).slice(0, FEATURED_PER_CATEGORY);
      renderGrid(grid, list, {});
    };
    tabs.forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        if (btn.tagName === "A") ev.preventDefault();
        show(btn.dataset.filter || "all");
      });
    });
    const active = tablist.querySelector("[data-filter].active");
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
    const addLink = (label, target, options) => {
      const opts = options || {};
      const url = new URL(location.href);
      if (target <= 1) url.searchParams.delete("sayfa");
      else url.searchParams.set("sayfa", String(target));
      const href = url.pathname + url.search;
      if (opts.disabled) {
        const span = document.createElement("span");
        span.textContent = label;
        span.setAttribute("aria-disabled", "true");
        if (opts.current) {
          span.className = "is-current";
          span.setAttribute("aria-current", "page");
        }
        pager.appendChild(span);
        return;
      }
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        history.pushState({}, "", href);
        reloadCatalog();
      });
      pager.appendChild(link);
    };
    addLink("‹", page - 1, { disabled: page <= 1 });
    addLink(String(page), page, { current: true, disabled: true });
    addLink("›", page + 1, { disabled: page >= totalPages });
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
    if (document.querySelector("[data-catalog-facets]")) {
      renderFacets(opts.facets, readFacetQuery());
      renderCatalogMeta((opts.pager && opts.pager.total) || products.length, readFacetQuery());
    }
    if (opts.featuredTabs) bindFeaturedTabs(opts.featuredTabs);
    else if (!opts.categoryResolved) bindTabs(document);
    window.dispatchEvent(new CustomEvent("patygo:catalog", { detail: { products } }));
    return products;
  }

  function showCatalogLoading(grid) {
    if (!grid) return;
    grid.textContent = "";
    const note = document.createElement("p");
    note.className = "catalog-loading";
    note.textContent = "Ürünler yükleniyor…";
    grid.appendChild(note);
    for (let i = 0; i < 8; i += 1) {
      const skeleton = document.createElement("article");
      skeleton.className = "product-card product-card--skeleton";
      skeleton.setAttribute("aria-hidden", "true");
      grid.appendChild(skeleton);
    }
  }

  async function fetchProductPage(params) {
    const qs = new URLSearchParams();
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && String(value) !== "") qs.set(key, String(value));
    });
    const res = await fetch("/api/products?" + qs.toString());
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
      facets: data.facets && typeof data.facets === "object" ? data.facets : null,
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
      const res = await fetch("/assets/data/categories.json");
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
    document.querySelectorAll(".product-grid[data-catalog]").forEach(showCatalogLoading);
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
        const facets = readFacetQuery();
        payload = await fetchProductPage({
          kategori: wantsCategory ? query.parent : "",
          ara: wantsCategory ? query.mid : "",
          alt: wantsCategory ? query.child : "",
          marka: facets.brands.join(","),
          minFiyat: facets.minFiyat,
          maxFiyat: facets.maxFiyat,
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
      facets: onProductsPage ? payload.facets : null,
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
