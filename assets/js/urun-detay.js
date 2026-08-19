(function () {
  "use strict";
  const root = document.getElementById("detailRoot");

  function resolveDetailRoute() {
    const legacyId = new URLSearchParams(location.search).get("id") || "";
    const productPath =
      window.PatygoCatalog && window.PatygoCatalog.parseProductPath
        ? window.PatygoCatalog.parseProductPath(location.pathname)
        : null;
    if (productPath) return { mode: "path", path: productPath.path };
    if (legacyId) return { mode: "id", id: legacyId };
    return { mode: "none" };
  }

  const detailRoute = resolveDetailRoute();
  const id = detailRoute.mode === "id" ? detailRoute.id : "";

  function parseSpecChips(name) {
    if (window.PatygoDetailSpecs && window.PatygoDetailSpecs.parseProductSpecChips) {
      return window.PatygoDetailSpecs.parseProductSpecChips(name);
    }
    return [];
  }

  function protectMedia(img) {
    img.setAttribute("draggable", "false");
    img.addEventListener("dragstart", (ev) => ev.preventDefault());
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== "") node.textContent = text;
    return node;
  }

  function chipLabel(chip) {
    if (/ekran/i.test(chip)) return "Ekran";
    if (/\bRAM\b/i.test(chip)) return "Bellek";
    if (/ssd|depolama|tb/i.test(chip)) return "Depolama";
    if (/intel|amd|ryzen|core/i.test(chip)) return "İşlemci";
    if (/windows|freedos/i.test(chip)) return "İşletim sistemi";
    if (/ddr/i.test(chip)) return "Bellek tipi";
    return "Özellik";
  }

  function parseDetailSpecTable(text) {
    if (window.PatygoDetailSpecs && window.PatygoDetailSpecs.parseProductDetailSpecTable) {
      return window.PatygoDetailSpecs.parseProductDetailSpecTable(text);
    }
    return [];
  }

  function shouldHighlightSpecLabel(label) {
    return /^(İşlemci|Ekran kartı|Bellek|Depolama|Ekran|İşletim sistemi|İşlemci hızı)$/i.test(
      String(label || "").trim()
    );
  }

  function buildSpecRow(row) {
    const item = el("div", "detail-spec-row");
    item.appendChild(el("span", "detail-spec-label", row.label));
    const valueClass =
      "detail-spec-value" + (shouldHighlightSpecLabel(row.label) ? " is-highlight" : "");
    item.appendChild(el("span", valueClass, row.value));
    return item;
  }

  function buildSpecTableFromRows(rows) {
    if (!rows || !rows.length) return null;
    const block = el("div", "detail-spec-block");
    block.appendChild(el("h3", "detail-spec-title", "Ürün özellikleri"));
    const grid = el("div", "detail-spec-grid");
    const mid = Math.ceil(rows.length / 2);
    [rows.slice(0, mid), rows.slice(mid)].forEach((colRows) => {
      if (!colRows.length) return;
      const col = el("div", "detail-spec-col");
      colRows.forEach((row) => col.appendChild(buildSpecRow(row)));
      grid.appendChild(col);
    });
    block.appendChild(grid);
    return block;
  }

  function buildSpecTable(name) {
    const chips = parseSpecChips(name);
    if (!chips.length) return null;
    const rows = chips.map((label) => ({ label: chipLabel(label), value: label }));
    return buildSpecTableFromRows(rows);
  }

  function wireDetailTabs(section) {
    const tabs = section.querySelectorAll('[role="tab"]');
    const panels = section.querySelectorAll('[role="tabpanel"]');
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");
        tabs.forEach((item) => {
          const active = item === tab;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", active ? "true" : "false");
        });
        panels.forEach((panel) => {
          const active = panel.getAttribute("data-tab") === target;
          panel.hidden = !active;
          panel.classList.toggle("is-active", active);
        });
      });
    });
  }

  function buildDetailTabs(product) {
    const section = el("section", "detail-tabs reveal in");
    const tablist = el("div", "detail-tablist");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Ürün bilgileri");

    const defs = [
      { id: "desc", label: "Ürün Açıklaması" },
      { id: "payment", label: "Ödeme ve Teslimat" },
      { id: "returns", label: "İade ve Cayma" },
    ];
    defs.forEach((def, index) => {
      const tab = el("button", "detail-tab" + (index === 0 ? " is-active" : ""));
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("data-tab", def.id);
      tab.setAttribute("aria-selected", index === 0 ? "true" : "false");
      tab.textContent = def.label;
      tablist.appendChild(tab);
    });

    const panels = el("div", "detail-tabpanels");

    const descPanel = el("div", "detail-tabpanel is-active");
    descPanel.setAttribute("role", "tabpanel");
    descPanel.setAttribute("data-tab", "desc");

    const description = String(product.description || "").trim();
    const details = String(product.details || "").trim();
    if (description) {
      const intro = el("p", "detail-desc", description);
      descPanel.appendChild(intro);
    }
    const specRows = parseDetailSpecTable(details);
    if (specRows.length) {
      descPanel.appendChild(buildSpecTableFromRows(specRows));
    } else if (details) {
      const body = el("div", "detail-body", details);
      descPanel.appendChild(body);
    } else if (!description) {
      const specTable = buildSpecTable(product.name);
      if (specTable) descPanel.appendChild(specTable);
    }

    const payPanel = el("div", "detail-tabpanel");
    payPanel.hidden = true;
    payPanel.setAttribute("role", "tabpanel");
    payPanel.setAttribute("data-tab", "payment");
    const payList = el("ul", "detail-tab-list");
    payList.innerHTML =
      "<li>Fiyatlar KDV dahil gösterilir.</li>" +
      "<li>Ödeme Akbank 3D Secure ile kartınızdan alınır.</li>" +
      "<li>Sipariş sonrası faturalı satış yapılır.</li>" +
      "<li>Teslimat süresi sipariş onayından sonra size bildirilir.</li>";
    payPanel.appendChild(payList);

    const retPanel = el("div", "detail-tabpanel");
    retPanel.hidden = true;
    retPanel.setAttribute("role", "tabpanel");
    retPanel.setAttribute("data-tab", "returns");
    const retList = el("ul", "detail-tab-list");
    retList.innerHTML =
      "<li>14 gün içinde cayma hakkınız vardır (mesafeli satış kuralları).</li>" +
      "<li>Kullanılmamış, ambalajı açılmamış ürünlerde iade koşulları geçerlidir.</li>" +
      '<li><a href="/iade-ve-cayma">İade ve cayma koşulları</a></li>' +
      '<li><a href="/mesafeli-satis-sozlesmesi">Mesafeli satış sözleşmesi</a></li>';
    retPanel.appendChild(retList);

    panels.appendChild(descPanel);
    panels.appendChild(payPanel);
    panels.appendChild(retPanel);
    section.appendChild(tablist);
    section.appendChild(panels);
    wireDetailTabs(section);
    return section;
  }

  function render(product, categories) {
    root.textContent = "";
    if (!product) {
      root.innerHTML =
        '<p style="color:var(--muted)">Ürün bulunamadı. <a href="/urunler" style="color:var(--brand)">Ürün kataloğuna dön</a></p>';
      return;
    }

    document.title = product.name + " | Patygo Teknoloji";
    upsertCanonical(product.urlPath || location.pathname);
    const metaDesc = document.querySelector('meta[name="description"]');
    const seoBlurb = String(product.description || product.details || product.name)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    if (metaDesc) metaDesc.setAttribute("content", seoBlurb);
    else {
      const meta = document.createElement("meta");
      meta.name = "description";
      meta.content = seoBlurb;
      document.head.appendChild(meta);
    }

    const grid = document.createElement("div");
    grid.className = "detail-grid reveal in";

    const images = (
      Array.isArray(product.images) ? product.images : [product.image]
    ).filter(Boolean);
    const gallery = document.createElement("div");
    gallery.className = "detail-gallery";
    const media = document.createElement("div");
    media.className = "detail-media";
    if (images.length) {
      const mainImage = document.createElement("img");
      mainImage.src = images[0];
      mainImage.alt = product.name;
      mainImage.referrerPolicy = "no-referrer";
      mainImage.addEventListener("error", () => {
        const next = images.find((url) => url && url !== mainImage.getAttribute("src"));
        if (next) mainImage.src = next;
      });
      protectMedia(mainImage);
      media.appendChild(mainImage);
      gallery.appendChild(media);

      if (images.length > 1) {
        const thumbs = document.createElement("div");
        thumbs.className = "detail-thumbs";
        images.forEach((url, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "detail-thumb" + (index === 0 ? " active" : "");
          button.setAttribute("aria-label", "Görsel " + (index + 1));
          const thumb = document.createElement("img");
          thumb.src = url;
          thumb.alt = "";
          thumb.referrerPolicy = "no-referrer";
          protectMedia(thumb);
          button.appendChild(thumb);
          button.addEventListener("click", () => {
            mainImage.src = url;
            thumbs.querySelectorAll(".detail-thumb").forEach((item) => {
              item.classList.toggle("active", item === button);
            });
          });
          thumbs.appendChild(button);
        });
        gallery.appendChild(thumbs);
      }
    } else {
      media.textContent = product.brand;
      gallery.appendChild(media);
    }

    const info = document.createElement("div");
    info.className = "detail-info";
    const trail = window.PatygoCatalog.resolveProductCategoryTrail
      ? window.PatygoCatalog.resolveProductCategoryTrail(product, categories)
      : [];
    const crumb = document.createElement("nav");
    crumb.className = "breadcrumb";
    crumb.setAttribute("aria-label", "Sayfa konumu");
    const crumbHome = document.createElement("a");
    crumbHome.href = "/";
    crumbHome.textContent = "Ana Sayfa";
    crumb.appendChild(crumbHome);
    trail.forEach((part) => {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "/";
      sep.setAttribute("aria-hidden", "true");
      crumb.appendChild(sep);
      const link = document.createElement("a");
      link.href = part.href;
      link.textContent = part.text;
      crumb.appendChild(link);
    });

    const tag = document.createElement("span");
    tag.className = "brand-tag";
    tag.textContent = product.brand;

    const h1 = document.createElement("h1");
    h1.textContent = product.name;
    h1.setAttribute("aria-current", "page");

    const leaf = trail.length ? trail[trail.length - 1] : null;
    const cat = document.createElement("p");
    cat.className = "detail-cat";
    if (leaf) {
      const catLink = document.createElement("a");
      catLink.href = leaf.href;
      catLink.textContent = leaf.text;
      cat.appendChild(catLink);
    }

    const price = document.createElement("div");
    price.className = "price";
    price.innerHTML =
      window.PatygoCatalog.formatPrice(window.PatygoCatalog.priceInclVat(product)) +
      " <small>KDV dahil</small>";

    const actions = document.createElement("div");
    actions.className = "actions";
    let addQty = 1;
    if (window.PatygoCatalog.createQtyStepper) {
      const qtyRow = window.PatygoCatalog.createQtyStepper(1);
      qtyRow.classList.add("detail-qty-row");
      actions.appendChild(qtyRow);
      addQty = () => qtyRow.getQty();
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-primary btn-lg btn-buy";
    add.textContent = "Sepete Ekle";
    add.addEventListener("click", () => {
      const qty = typeof addQty === "function" ? addQty() : 1;
      window.PatygoCart.add(product.id, qty, {
        brand: product.brand,
        name: product.name,
        price: product.price,
        vatPercent: product.vatPercent,
      });
      add.textContent = "Sepete eklendi";
      add.disabled = true;
      window.setTimeout(() => {
        add.textContent = "Sepete Ekle";
        add.disabled = false;
      }, 1800);
    });
    actions.appendChild(add);

    const trust = document.createElement("ul");
    trust.className = "detail-trust";
    trust.innerHTML =
      "<li>Stokta · KDV dahil fiyat</li><li>3D Secure güvenli ödeme</li><li>Faturalı satış</li>";

    if (leaf) info.appendChild(cat);
    info.appendChild(tag);
    info.appendChild(h1);
    info.appendChild(price);
    info.appendChild(actions);
    info.appendChild(trust);

    grid.appendChild(gallery);
    grid.appendChild(info);
    root.appendChild(crumb);
    root.appendChild(grid);
    root.appendChild(buildDetailTabs(product));

    upsertProductJsonLd(product, trail);
  }

  function upsertJsonLd(scriptId, data) {
    let elNode = document.getElementById(scriptId);
    if (!elNode) {
      elNode = document.createElement("script");
      elNode.type = "application/ld+json";
      elNode.id = scriptId;
      document.head.appendChild(elNode);
    }
    elNode.textContent = JSON.stringify(data);
  }

  function upsertCanonical(urlPath) {
    if (!urlPath) return;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = "https://patygoteknoloji.com" + urlPath;
  }

  function upsertProductJsonLd(product, trail) {
    const pageUrl =
      "https://patygoteknoloji.com" +
      (product.urlPath ||
        (window.PatygoCatalog && window.PatygoCatalog.productHref
          ? window.PatygoCatalog.productHref(product)
          : "/urun-detay?id=" + encodeURIComponent(product.id)));
    const images = (
      Array.isArray(product.images) ? product.images : [product.image]
    ).filter(Boolean);
    const price = window.PatygoCatalog.priceInclVat(product);
    upsertJsonLd("product-jsonld", {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      image: images,
      description: String(product.description || product.details || product.name)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000),
      sku: String(product.id || ""),
      brand: product.brand
        ? { "@type": "Brand", name: product.brand }
        : undefined,
      offers: {
        "@type": "Offer",
        url: pageUrl,
        priceCurrency: "TRY",
        price: String(price),
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
      },
    });
    const crumbs = [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: "https://patygoteknoloji.com/" },
    ];
    (Array.isArray(trail) ? trail : []).forEach((part, index) => {
      crumbs.push({
        "@type": "ListItem",
        position: index + 2,
        name: part.text,
        item: "https://patygoteknoloji.com" + part.href,
      });
    });
    crumbs.push({
      "@type": "ListItem",
      position: crumbs.length + 1,
      name: product.name,
      item: pageUrl,
    });
    upsertJsonLd("breadcrumb-jsonld", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs,
    });
  }

  async function loadDetail() {
    if (detailRoute.mode === "none") {
      render(null, []);
      return;
    }
    const cached =
      detailRoute.mode === "id" && window.PatygoCatalog.byId
        ? window.PatygoCatalog.byId[detailRoute.id]
        : null;
    const cats =
      (window.PatygoCatalog._lastCategories && window.PatygoCatalog._lastCategories.length
        ? window.PatygoCatalog._lastCategories
        : null) ||
      (window.PatygoNav && Array.isArray(window.PatygoNav.categories)
        ? window.PatygoNav.categories
        : []) ||
      [];
    if (cached) render(cached, cats);

    let product = cached;
    try {
      const fetchUrl =
        detailRoute.mode === "path"
          ? "/api/products?path=" + encodeURIComponent(detailRoute.path)
          : "/api/products?id=" + encodeURIComponent(detailRoute.id);
      const res = await fetch(fetchUrl, {
        cache: "default",
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      const fresh =
        Array.isArray(data.products) && data.products.length ? data.products[0] : null;
      if (fresh) {
        window.PatygoCatalog.byId = window.PatygoCatalog.byId || {};
        window.PatygoCatalog.byId[fresh.id] = fresh;
        product = fresh;
        if (
          fresh.urlPath &&
          detailRoute.mode === "id" &&
          location.pathname.indexOf(fresh.urlPath) !== 0
        ) {
          history.replaceState(null, "", fresh.urlPath);
        }
        render(fresh, cats);
      } else if (!cached) {
        render(null, cats);
      }
    } catch (_) {
      if (!cached) render(null, cats);
    }

    if (typeof window.PatygoCatalog.loadCategories === "function") {
      window.PatygoCatalog.loadCategories()
        .then((categories) => {
          if (Array.isArray(categories) && categories.length && product) {
            render(product, categories);
          }
        })
        .catch(() => {});
    }
  }

  loadDetail();
})();
