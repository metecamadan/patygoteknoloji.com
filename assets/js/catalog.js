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
      const n = Number(amount);
      const value = Number.isFinite(n) ? n : 0;
      return (
        "₺" +
        value.toLocaleString("tr-TR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
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
    prettyCategoryName(name) {
      const text = String(name || "").trim();
      if (!text) return "";
      if (text !== text.toLocaleUpperCase("tr-TR")) return text;
      return text
        .split(/(\s+)/)
        .map((token) => {
          if (!token.trim()) return token;
          if (token.length <= 3) return token;
          const lower = token.toLocaleLowerCase("tr-TR");
          return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
        })
        .join("");
    },
    prettyBrandName(name) {
      const text = String(name || "").trim();
      if (!text) return "";
      const lower = text.toLocaleLowerCase("tr-TR");
      return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
    },
    resolveProductCategoryTrail(product, categories) {
      const parentSlug = String((product && product.category) || "").trim();
      const midSlug = String((product && product.mid) || "").trim();
      const childSlug = String((product && (product.alt || product.child)) || "").trim();
      if (!parentSlug) return [];
      const parents = (Array.isArray(categories) && categories.length
        ? categories
        : (window.PatygoNav && window.PatygoNav.categories) || []);
      const parent = parents.find((row) => row.slug === parentSlug) || null;
      const pretty = (name, fallback) =>
        window.PatygoCatalog.prettyCategoryName(name) ||
        window.PatygoCatalog.categoryLabel(fallback) ||
        name ||
        fallback;
      const trail = [];
      if (parent) {
        trail.push({
          href: window.PatygoCatalog.categoryHref(parent.slug),
          text: pretty(parent.name, parent.slug),
          slug: parent.slug,
        });
      } else {
        trail.push({
          href: window.PatygoCatalog.categoryHref(parentSlug),
          text: window.PatygoCatalog.categoryLabel(parentSlug) || parentSlug,
          slug: parentSlug,
        });
        return trail;
      }
      const mids = Array.isArray(parent.children) ? parent.children : [];
      let mid = midSlug ? mids.find((row) => row.slug === midSlug) || null : null;
      let child = null;
      if (!mid && childSlug) {
        mid = mids.find((row) => row.slug === childSlug) || null;
        if (!mid) {
          for (let i = 0; i < mids.length; i += 1) {
            const found = (mids[i].children || []).find((leaf) => leaf.slug === childSlug);
            if (found) {
              mid = mids[i];
              child = found;
              break;
            }
          }
        }
      } else if (mid && childSlug) {
        child = (mid.children || []).find((leaf) => leaf.slug === childSlug) || null;
      }
      if (mid) {
        trail.push({
          href: window.PatygoCatalog.categoryHref(parent.slug, mid.slug),
          text: pretty(mid.name, mid.slug),
          slug: mid.slug,
        });
      }
      if (child) {
        trail.push({
          href: window.PatygoCatalog.categoryHref(parent.slug, mid.slug, child.slug),
          text: pretty(child.name, child.slug),
          slug: child.slug,
        });
      }
      return trail;
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
    toggle.className = "btn btn-primary catalog-facets-toggle";
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
        name.textContent =
          window.PatygoCatalog.prettyBrandName(row.name) || row.name;
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
      applyBtn.className = "btn btn-primary catalog-price-apply";
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

  function resetCatalogHeading() {
    const crumb = document.querySelector("[data-catalog-crumb]");
    const title = document.querySelector("[data-catalog-title]");
    const lead = document.querySelector("[data-catalog-lead]");
    const nav = crumb && crumb.closest(".breadcrumb");
    if (nav) {
      nav.textContent = "";
      const home = document.createElement("a");
      home.href = "/";
      home.textContent = "Ana Sayfa";
      nav.appendChild(home);
      const sep = document.createElement("span");
      sep.textContent = "/";
      nav.appendChild(sep);
      const current = document.createElement("span");
      current.setAttribute("data-catalog-crumb", "");
      current.textContent = "Ürün kataloğu";
      nav.appendChild(current);
    } else if (crumb) {
      crumb.textContent = "Ürün kataloğu";
    }
    if (title) title.textContent = "Ürün kataloğu";
    if (lead) {
      lead.textContent =
        "Kategorilere göre ürünleri keşfedin; sepete ekleyin ve güvenle online ödeme yapın.";
      lead.hidden = false;
    }
    document.title = "Ürünler | Patygo Teknoloji — Online Elektronik Mağaza";
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
      if (resolved.parent && (resolved.mid || resolved.child)) {
        addSep();
        addLink(
          window.PatygoCatalog.categoryHref(resolved.parent.slug),
          window.PatygoCatalog.prettyCategoryName(resolved.parent.name) || resolved.parent.name
        );
      }
      if (resolved.child && resolved.mid) {
        addSep();
        addLink(
          window.PatygoCatalog.categoryHref(resolved.parent.slug, resolved.mid.slug),
          window.PatygoCatalog.prettyCategoryName(resolved.mid.name) || resolved.mid.name
        );
      }
      addSep();
      const current = document.createElement("span");
      current.setAttribute("data-catalog-crumb", "");
      current.setAttribute("aria-current", "page");
      current.textContent = window.PatygoCatalog.prettyCategoryName(label) || label;
      nav.appendChild(current);
    } else if (crumb) {
      crumb.textContent = label;
    }
    if (title) title.textContent = window.PatygoCatalog.prettyCategoryName(label) || label;
    if (lead) lead.hidden = true;
    document.title = (window.PatygoCatalog.prettyCategoryName(label) || label) + " | Patygo Teknoloji";
  }

  function makeCard(product, index, options) {
    const cardOpts = options || {};
    const compactListing = Boolean(cardOpts.compactListing);
    const article = document.createElement("article");
    const delay = index % 3 === 1 ? " d1" : index % 3 === 2 ? " d2" : "";
    article.className =
      "product-card reveal" + delay + " in" + (compactListing ? " product-card--listing" : "");
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
      !compactListing &&
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
    actions.className = "actions" + (compactListing ? " actions--listing" : "");

    const cartBtn = document.createElement("button");
    cartBtn.type = "button";
    cartBtn.className = "btn btn-buy";
    cartBtn.textContent = "Sepete Ekle";

    if (compactListing) {
      const qtyRow = createQtyStepper(1);
      cartBtn.addEventListener("click", () => {
        if (window.PatygoCart) {
          window.PatygoCart.add(product.id, qtyRow.getQty(), {
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
      actions.appendChild(qtyRow);
      actions.appendChild(cartBtn);
    } else if (cardOpts.cartOnly) {
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
      actions.classList.add("actions--cart-only");
      actions.appendChild(cartBtn);
    } else {
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
    }
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
  const LISTING_PAGE_SIZE = 20;
  const LISTING_CACHE_STORE = "patygo_listing_v1";
  const LISTING_CACHE_TTL_MS = 10 * 60 * 1000;
  const LISTING_CACHE_MAX = 30;
  const listingScroll = { page: 1, totalPages: 0, total: 0, loading: false, observer: null };

  function listingCacheKey(params) {
    const keys = ["kategori", "ara", "alt", "marka", "minFiyat", "maxFiyat", "page", "limit", "id", "ids", "homeFeatured"];
    const qs = new URLSearchParams();
    keys.forEach((key) => {
      const value = params && params[key];
      if (value !== undefined && value !== null && String(value) !== "") qs.set(key, String(value));
    });
    return qs.toString() || "all";
  }

  function readListingCache(key) {
    try {
      const store = JSON.parse(sessionStorage.getItem(LISTING_CACHE_STORE) || "{}");
      const entry = store[key];
      if (!entry || Date.now() - Number(entry.at || 0) > LISTING_CACHE_TTL_MS) return null;
      if (!entry.data || !Array.isArray(entry.data.products)) return null;
      return entry.data;
    } catch (_) {
      return null;
    }
  }

  function writeListingCache(key, data) {
    if (!key || !data || !Array.isArray(data.products)) return;
    try {
      const store = JSON.parse(sessionStorage.getItem(LISTING_CACHE_STORE) || "{}");
      store[key] = { at: Date.now(), data: data };
      const keys = Object.keys(store);
      if (keys.length > LISTING_CACHE_MAX) {
        keys
          .sort((a, b) => Number((store[a] && store[a].at) || 0) - Number((store[b] && store[b].at) || 0))
          .slice(0, keys.length - LISTING_CACHE_MAX)
          .forEach((oldKey) => {
            delete store[oldKey];
          });
      }
      sessionStorage.setItem(LISTING_CACHE_STORE, JSON.stringify(store));
    } catch (_) {}
  }

  function resetListingScroll() {
    if (listingScroll.observer) {
      listingScroll.observer.disconnect();
      listingScroll.observer = null;
    }
    listingScroll.page = 1;
    listingScroll.totalPages = 0;
    listingScroll.total = 0;
    listingScroll.loading = false;
  }

  function updateListingLoadStatus(text, visible) {
    const status = document.querySelector("[data-catalog-load-status]");
    const wrap = document.querySelector("[data-catalog-infinite]");
    if (status) {
      status.textContent = text || "";
      status.hidden = !visible;
    }
    if (wrap) wrap.hidden = !visible && !(text && listingScroll.totalPages > 1);
  }

  function createQtyStepper(initial) {
    let qty = Math.max(1, Math.min(99, Number(initial) || 1));
    const row = document.createElement("div");
    row.className = "product-qty-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Adet");

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "product-qty-btn";
    minus.textContent = "−";
    minus.setAttribute("aria-label", "Adeti azalt");

    const value = document.createElement("span");
    value.className = "product-qty-value";
    value.textContent = String(qty);

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "product-qty-btn";
    plus.textContent = "+";
    plus.setAttribute("aria-label", "Adeti artır");

    function sync() {
      value.textContent = String(qty);
      minus.disabled = qty <= 1;
      plus.disabled = qty >= 99;
    }

    minus.addEventListener("click", () => {
      if (qty <= 1) return;
      qty -= 1;
      sync();
    });
    plus.addEventListener("click", () => {
      if (qty >= 99) return;
      qty += 1;
      sync();
    });
    sync();

    row.appendChild(minus);
    row.appendChild(value);
    row.appendChild(plus);
    row.getQty = () => qty;
    return row;
  }

  async function fetchListingPage(page) {
    const query = readCategoryQuery();
    const facets = readFacetQuery();
    const wantsCategory = query.parent || query.mid || query.child;
    return fetchProductPage({
      kategori: wantsCategory ? query.parent : "",
      ara: wantsCategory ? query.mid : "",
      alt: wantsCategory ? query.child : "",
      marka: facets.brands.join(","),
      minFiyat: facets.minFiyat,
      maxFiyat: facets.maxFiyat,
      page,
      limit: LISTING_PAGE_SIZE,
    });
  }

  function appendListingProducts(grid, products) {
    const start = grid.querySelectorAll(".product-card:not(.product-card--skeleton)").length;
    products.forEach((product, index) => {
      grid.appendChild(makeCard(product, start + index, { compactListing: true }));
    });
  }

  async function loadMoreListing() {
    if (listingScroll.loading) return;
    if (listingScroll.page >= listingScroll.totalPages) {
      if (listingScroll.total > 0) updateListingLoadStatus("Tüm ürünler listelendi.", true);
      return;
    }
    listingScroll.loading = true;
    updateListingLoadStatus("Daha fazla ürün yükleniyor…", true);
    const nextPage = listingScroll.page + 1;
    try {
      const payload = await fetchListingPage(nextPage);
      const grid = document.querySelector('.product-grid[data-catalog="all"]');
      if (grid && payload.products.length) {
        appendListingProducts(grid, payload.products);
        payload.products.forEach((product) => {
          window.PatygoCatalog.byId[product.id] = product;
        });
      }
      listingScroll.page = nextPage;
      listingScroll.totalPages = payload.totalPages || listingScroll.totalPages;
      listingScroll.total = payload.total || listingScroll.total;
    } catch (_) {}
    listingScroll.loading = false;
    if (listingScroll.page >= listingScroll.totalPages) {
      updateListingLoadStatus("Tüm ürünler listelendi.", true);
    } else {
      updateListingLoadStatus("", false);
    }
  }

  function bindListingInfiniteScroll() {
    const sentinel = document.querySelector("[data-catalog-load-sentinel]");
    const wrap = document.querySelector("[data-catalog-infinite]");
    if (!sentinel || !wrap) return;
    if (listingScroll.observer) listingScroll.observer.disconnect();
    if (listingScroll.totalPages <= 1) {
      wrap.hidden = true;
      updateListingLoadStatus("", false);
      return;
    }
    wrap.hidden = false;
    updateListingLoadStatus("", false);
    listingScroll.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreListing();
      },
      { rootMargin: "280px 0px" }
    );
    listingScroll.observer.observe(sentinel);
  }

  function setupListingInfinite(meta) {
    listingScroll.page = Number(meta && meta.page) || 1;
    listingScroll.totalPages = Number(meta && meta.totalPages) || 0;
    listingScroll.total = Number(meta && meta.total) || 0;
    bindListingInfiniteScroll();
  }

  const FEATURED_PARENTS = [
    "bilgisayar-tablet",
    "bilgisayar-bilesenleri",
    "kartus-toner",
    "baski-cozumleri",
    "yapi-gerecleri",
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
    const compactListing = Boolean(opts.compactListing) || mode === "all";
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
    list.forEach((product, index) => {
      grid.appendChild(
        makeCard(product, index, {
          compactListing: compactListing && mode === "all",
          cartOnly: mode === "featured",
        })
      );
    });
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
    renderCatalogPager(opts.listingInfinite ? null : opts.pager || null);
    if (opts.listingInfinite) setupListingInfinite(opts.listingInfinite);
    else resetListingScroll();
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
    grid.setAttribute("aria-busy", "true");
    const skeletonCount = grid.getAttribute("data-catalog") === "all" ? 8 : 6;
    for (let i = 0; i < skeletonCount; i += 1) {
      const skeleton = document.createElement("article");
      skeleton.className = "product-card product-card--skeleton";
      skeleton.setAttribute("aria-hidden", "true");
      grid.appendChild(skeleton);
    }
  }

  function readCatalogBootstrap() {
    const el = document.getElementById("patygo-catalog-bootstrap");
    if (!el) return null;
    try {
      const data = JSON.parse(el.textContent || "");
      el.remove();
      if (!data || !Array.isArray(data.products)) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function loadCatalogBootstrap() {
    const embedded = readCatalogBootstrap();
    if (embedded) return embedded;
    const qs = new URLSearchParams(location.search);
    if (qs.get("marka") || qs.get("minFiyat") || qs.get("maxFiyat")) return null;
    try {
      const apiQs = new URLSearchParams();
      ["kategori", "ara", "alt"].forEach((key) => {
        if (qs.get(key)) apiQs.set(key, qs.get(key));
      });
      const res = await fetch("/api/catalog-bootstrap?" + apiQs.toString(), { cache: "default" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.products)) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function facetQueryActive() {
    const facets = readFacetQuery();
    return Boolean(facets.brands.length || facets.minFiyat || facets.maxFiyat);
  }

  async function fetchListingPayload(query, wantsCategory, facets) {
    return fetchProductPage({
      kategori: wantsCategory ? query.parent : "",
      ara: wantsCategory ? query.mid : "",
      alt: wantsCategory ? query.child : "",
      marka: facets.brands.join(","),
      minFiyat: facets.minFiyat,
      maxFiyat: facets.maxFiyat,
      page: 1,
      limit: LISTING_PAGE_SIZE,
    });
  }

  async function fetchProductPage(params) {
    const qs = new URLSearchParams();
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && String(value) !== "") qs.set(key, String(value));
    });
    const res = await fetch("/api/products?" + qs.toString(), { cache: "default" });
    if (!res.ok) throw new Error("Katalog yüklenemedi");
    const data = await res.json();
    const products = Array.isArray(data.products) ? data.products : Array.isArray(data) ? data : [];
    const payload = {
      products,
      total: Number(data.total) || products.length,
      page: Number(data.page) || 1,
      limit: Number(data.limit) || products.length,
      totalPages: Number(data.totalPages) || 0,
      byParent: data.byParent && typeof data.byParent === "object" ? data.byParent : null,
      facets: data.facets && typeof data.facets === "object" ? data.facets : null,
    };
    writeListingCache(listingCacheKey(params), payload);
    return payload;
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

  function listingParamsFromPage(query, wantsCategory, facets) {
    return {
      kategori: wantsCategory ? query.parent : "",
      ara: wantsCategory ? query.mid : "",
      alt: wantsCategory ? query.child : "",
      marka: facets.brands.join(","),
      minFiyat: facets.minFiyat,
      maxFiyat: facets.maxFiyat,
      page: 1,
      limit: LISTING_PAGE_SIZE,
    };
  }

  function paintListing(payload, opts) {
    const products = applyCatalog(payload.products || [], opts);
    document.querySelectorAll(".product-grid[data-catalog]").forEach((grid) => {
      grid.removeAttribute("aria-busy");
    });
    return products;
  }

  async function reloadCatalog() {
    const path = location.pathname || "";
    const query = readCategoryQuery();
    const onProductsPage = /\/urunler\/?$/i.test(path);
    const wantsCategory = onProductsPage && (query.parent || query.mid || query.child);
    const facets = readFacetQuery();
    const listingParams = listingParamsFromPage(query, wantsCategory, facets);
    const cacheKey = listingCacheKey(listingParams);
    const cachedListing = onProductsPage ? readListingCache(cacheKey) : null;
    const hasEmbeddedBootstrap = Boolean(document.getElementById("patygo-catalog-bootstrap"));
    const usedFastPath = { value: Boolean(cachedListing) };

    if (onProductsPage) {
      resetListingScroll();
      const cleanUrl = new URL(location.href);
      if (cleanUrl.searchParams.has("sayfa")) {
        cleanUrl.searchParams.delete("sayfa");
        history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search);
      }
    }
    if (onProductsPage && !cachedListing && !hasEmbeddedBootstrap) {
      document.querySelectorAll(".product-grid[data-catalog]").forEach(showCatalogLoading);
    }

    const onDetailPage = /\/urun-detay\/?$/i.test(path);
    const onCartPage = /\/sepet\/?$/i.test(path) || /\/odeme\/?$/i.test(path);

    const categoriesPromise = loadCategories();
    const payloadPromise = (async () => {
      if (cachedListing) return cachedListing;
      if (onProductsPage && !facetQueryActive()) {
        const boot = await loadCatalogBootstrap();
        if (boot) {
          usedFastPath.value = true;
          writeListingCache(cacheKey, boot);
          return boot;
        }
      }
      try {
        if (onDetailPage) {
          const id = new URLSearchParams(location.search).get("id") || "";
          return id ? await fetchProductPage({ id }) : { products: [], total: 0, page: 1, totalPages: 0 };
        }
        if (onCartPage) {
          const ids = (window.PatygoCart ? window.PatygoCart.list() : [])
            .map((item) => item.id)
            .filter(Boolean)
            .join(",");
          if (ids) return await fetchProductPage({ ids });
          return { products: [], total: 0, page: 1, totalPages: 0 };
        }
        if (document.querySelector('.product-grid[data-catalog="featured"]')) {
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
          return {
            products: home.mixed,
            total: home.mixed.length,
            page: 1,
            totalPages: 1,
            featuredTabs: home.byParent,
          };
        }
        return await fetchListingPayload(query, wantsCategory, facets);
      } catch (_) {
        return { products: [], total: 0, page: 1, totalPages: 0 };
      }
    })();

    const categories = await categoriesPromise;
    window.PatygoCatalog._lastCategories = categories;
    let categoryResolved = null;
    if (wantsCategory) {
      categoryResolved = resolveCategoryLabels(categories, query);
      if (categoryResolved) applyCategoryHeading(categoryResolved);
    } else if (onProductsPage) {
      resetCatalogHeading();
    }

    const payloadResult = await payloadPromise;
    const featuredTabs = payloadResult.featuredTabs || null;
    const payload = {
      products: payloadResult.products || [],
      total: payloadResult.total || 0,
      page: payloadResult.page || 1,
      totalPages: payloadResult.totalPages || 0,
      facets: payloadResult.facets || null,
    };

    let cartIdsFetched = false;
    if (onCartPage) cartIdsFetched = true;

    const products = paintListing(payload, {
      categoryQuery: null,
      categoryResolved: wantsCategory
        ? categoryResolved || { parent: { name: "Kategori" }, child: null }
        : null,
      pager: null,
      listingInfinite: onProductsPage ? payload : null,
      facets: onProductsPage ? payload.facets : null,
      featuredTabs,
    });
    if (
      cartIdsFetched &&
      window.PatygoCart &&
      typeof window.PatygoCart.pruneUnresolved === "function"
    ) {
      window.PatygoCart.pruneUnresolved(window.PatygoCatalog.byId);
    }
    if (usedFastPath.value && onProductsPage) {
      fetchListingPayload(query, wantsCategory, facets)
        .then((fresh) => {
          if (!fresh || !Array.isArray(fresh.products)) return;
          paintListing(fresh, {
            categoryQuery: null,
            categoryResolved: wantsCategory
              ? categoryResolved || { parent: { name: "Kategori" }, child: null }
              : null,
            pager: null,
            listingInfinite: fresh,
            facets: fresh.facets || null,
            featuredTabs: null,
          });
        })
        .catch(() => {});
    }
    return products;
  }

  function prefetchListingHref(href) {
    try {
      const url = new URL(href, location.origin);
      if (!/\/urunler\/?$/i.test(url.pathname)) return;
      const params = {
        kategori: url.searchParams.get("kategori") || "",
        ara: url.searchParams.get("ara") || "",
        alt: url.searchParams.get("alt") || "",
        page: 1,
        limit: LISTING_PAGE_SIZE,
      };
      if (readListingCache(listingCacheKey(params))) return;
      fetchProductPage(params).catch(() => {});
    } catch (_) {}
  }

  window.PatygoCatalog.reload = reloadCatalog;
  window.PatygoCatalog.fetchProductPage = fetchProductPage;
  window.PatygoCatalog.loadCategories = loadCategories;

  window.PatygoCatalog.ready = reloadCatalog();

  document.addEventListener(
    "pointerenter",
    (ev) => {
      const link = ev.target && ev.target.closest ? ev.target.closest('a[href*="/urunler"]') : null;
      if (link) prefetchListingHref(link.getAttribute("href"));
    },
    true
  );

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
