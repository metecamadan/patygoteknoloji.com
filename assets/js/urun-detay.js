(function () {
  "use strict";
  const root = document.getElementById("detailRoot");

  function parseProductPath(pathname) {
    const parts = String(pathname || "")
      .split("/")
      .filter(Boolean);
    if (parts.length !== 2) return null;
    const reserved = new Set(["assets", "listing", "media", "api", "admin", "urunler", "sepet", "odeme"]);
    if (reserved.has(parts[0])) return null;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[0])) return null;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[1])) return null;
    return { segment: parts[0], slug: parts[1], path: parts[0] + "/" + parts[1] };
  }

  function resolveDetailRoute() {
    const legacyId = new URLSearchParams(location.search).get("id") || "";
    const productPath =
      parseProductPath(location.pathname) ||
      (window.PatygoCatalog && window.PatygoCatalog.parseProductPath
        ? window.PatygoCatalog.parseProductPath(location.pathname)
        : null);
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

  let lightbox = null;

  function ensureLightbox() {
    if (lightbox) return lightbox;
    const dialog = document.createElement("dialog");
    dialog.className = "detail-lightbox";
    dialog.setAttribute("aria-label", "Ürün görseli");
    const img = document.createElement("img");
    img.referrerPolicy = "no-referrer";
    protectMedia(img);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "detail-lightbox-close";
    close.setAttribute("aria-label", "Kapat");
    close.textContent = "×";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "detail-lightbox-nav detail-lightbox-prev";
    prev.setAttribute("aria-label", "Önceki görsel");
    prev.textContent = "‹";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "detail-lightbox-nav detail-lightbox-next";
    next.setAttribute("aria-label", "Sonraki görsel");
    next.textContent = "›";
    const counter = document.createElement("p");
    counter.className = "detail-lightbox-counter";
    dialog.append(img, close, prev, next, counter);
    document.body.appendChild(dialog);

    const state = { images: [], index: 0 };
    const show = (index) => {
      const count = state.images.length;
      state.index = (index + count) % count;
      img.src = state.images[state.index];
      counter.textContent = count > 1 ? state.index + 1 + " / " + count : "";
      prev.hidden = next.hidden = count < 2;
    };
    close.addEventListener("click", () => dialog.close());
    prev.addEventListener("click", () => show(state.index - 1));
    next.addEventListener("click", () => show(state.index + 1));
    dialog.addEventListener("click", (ev) => {
      if (ev.target === dialog) dialog.close();
    });
    dialog.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") show(state.index - 1);
      else if (ev.key === "ArrowRight") show(state.index + 1);
    });
    lightbox = {
      open(images, index, alt) {
        state.images = images;
        img.alt = alt || "";
        show(index);
        if (typeof dialog.showModal === "function") dialog.showModal();
        else window.open(state.images[state.index], "_blank", "noopener");
      },
    };
    return lightbox;
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

  /** Muadil/uyumlu sarf malzemesi orijinal değildir; "Orijinal ürün" yalnızca diğerlerinde. */
  function dispatchDaysLabel() {
    const days =
      (window.PatygoShipping && Number(window.PatygoShipping.dispatchBusinessDays)) || 2;
    return days + " iş gününde";
  }

  function isOriginalProduct(product) {
    const mid = String(product.mid || "");
    if (/muadil/i.test(mid)) return false;
    return !/\b(muadil|uyumlu|compatible)\b/i.test(String(product.name || ""));
  }

  function buildHighlights(product) {
    const items = Array.isArray(product.highlights)
      ? product.highlights.filter((item) => item && item.label && item.value)
      : [];
    if (!items.length) return null;
    const section = el("section", "detail-hub");
    section.setAttribute("aria-labelledby", "detailHubTitle");
    const title = el("h2", "detail-hub-title", "Ürün Bilgileri");
    title.id = "detailHubTitle";
    section.appendChild(title);
    const list = el("dl", "detail-hub-grid");
    items.slice(0, 4).forEach((item) => {
      const tile = el("div", "detail-hub-item");
      tile.appendChild(el("dt", "", String(item.label)));
      tile.appendChild(el("dd", "", String(item.value)));
      list.appendChild(tile);
    });
    section.appendChild(list);
    return section;
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
    const payItems = [
      "Fiyatlar KDV dahil gösterilir.",
      "Ödeme Akbank 3D Secure ile kartınızdan alınır.",
      "Sipariş sonrası faturalı satış yapılır.",
      "Siparişiniz " + dispatchDaysLabel() + " kargoya verilir.",
    ];
    const gross = window.PatygoCatalog.priceInclVat(product);
    const shipInfo =
      window.PatygoShipping && typeof window.PatygoShipping.productShippingInfo === "function"
        ? window.PatygoShipping.productShippingInfo(gross)
        : null;
    if (shipInfo) {
      if (shipInfo.free) {
        payItems.splice(1, 0, "Bu ürün için ücretsiz kargo uygulanır.");
      } else {
        payItems.splice(
          1,
          0,
          "Kargo bedeli (KDV dahil): " +
            window.PatygoShipping.formatMoney(shipInfo.fee) +
            ".",
          shipInfo.thresholdHint ? shipInfo.thresholdHint + "." : null
        );
      }
    }
    const minimumInfo =
      window.PatygoShipping && typeof window.PatygoShipping.minimumOrderInfo === "function"
        ? window.PatygoShipping.minimumOrderInfo(gross)
        : null;
    if (minimumInfo) {
      payItems.push(
        "Minimum sepet tutarı " +
          window.PatygoShipping.formatMoney(minimumInfo.minimum) +
          " (kargo hariç)." +
          (minimumInfo.met ? "" : " Bu ürünü diğer ürünlerle birlikte sipariş edebilirsiniz.")
      );
    }
    payList.innerHTML = payItems.filter(Boolean).map((line) => "<li>" + line + "</li>").join("");
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

  function buildInstallmentTable(gross) {
    const api = window.PatygoInstallments;
    const rows = api && typeof api.quote === "function" ? api.quote(gross) : [];
    if (!rows.length) return null;
    const box = el("details", "detail-installments");
    const maxCount = rows.reduce((n, row) => Math.max(n, row.count), 0);
    box.appendChild(el("summary", "", maxCount + " aya varan taksit seçenekleri"));
    const table = el("table", "detail-installment-table");
    const head = el("thead");
    head.innerHTML = "<tr><th scope=\"col\">Taksit</th><th scope=\"col\">Aylık</th><th scope=\"col\">Toplam</th></tr>";
    const body = el("tbody");
    rows.forEach((row) => {
      const tr = el("tr");
      tr.appendChild(el("td", "", row.count + " taksit"));
      tr.appendChild(el("td", "", window.PatygoCatalog.formatPrice(row.monthly)));
      tr.appendChild(el("td", "", window.PatygoCatalog.formatPrice(row.total)));
      body.appendChild(tr);
    });
    table.appendChild(head);
    table.appendChild(body);
    box.appendChild(table);
    box.appendChild(
      el(
        "p",
        "detail-installment-note",
        "Tutarlar kargo hariç tek ürün içindir. Taksit imkânı kartınızın bankasına ve kart tipine bağlıdır."
      )
    );
    return box;
  }

  let stickyObserver = null;

  function bindStickyBuyBar(product, actions, add) {
    let bar = document.getElementById("detailStickyBar");
    if (!bar) {
      bar = el("div", "detail-sticky-bar");
      bar.id = "detailStickyBar";
      bar.hidden = true;
      bar.innerHTML =
        '<div class="detail-sticky-price"><strong></strong><span>KDV dahil</span></div>' +
        '<button type="button" class="btn btn-primary detail-sticky-add">Sepete Ekle</button>';
      document.body.appendChild(bar);
    }
    bar.querySelector("strong").textContent = window.PatygoCatalog.formatPrice(
      window.PatygoCatalog.priceInclVat(product)
    );
    const button = bar.querySelector(".detail-sticky-add");
    button.onclick = () => {
      add.click();
      button.textContent = "Sepete eklendi";
      window.setTimeout(() => {
        button.textContent = "Sepete Ekle";
      }, 1800);
    };
    if (stickyObserver) stickyObserver.disconnect();
    if (!("IntersectionObserver" in window)) return;
    stickyObserver = new IntersectionObserver((entries) => {
      const entry = entries[0];
      const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      bar.hidden = !scrolledPast;
      document.body.classList.toggle("has-detail-bar", scrolledPast);
    });
    stickyObserver.observe(actions);
  }

  function bindSwipe(target, step) {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    target.addEventListener(
      "touchstart",
      (ev) => {
        if (ev.touches.length !== 1) return;
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
        tracking = true;
      },
      { passive: true }
    );
    target.addEventListener(
      "touchend",
      (ev) => {
        if (!tracking) return;
        tracking = false;
        const touch = ev.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        target.dataset.swiped = "1";
        window.setTimeout(() => {
          target.dataset.swiped = "";
        }, 400);
        step(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );
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
      let activeIndex = 0;
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "detail-zoom";
      zoom.setAttribute("aria-label", "Görseli büyüt");
      zoom.appendChild(mainImage);
      zoom.addEventListener("click", () => {
        if (zoom.dataset.swiped === "1") return;
        ensureLightbox().open(images, activeIndex, product.name);
      });
      media.appendChild(zoom);
      gallery.appendChild(media);
      const showImage = (index) => {
        activeIndex = (index + images.length) % images.length;
        mainImage.src = images[activeIndex];
        gallery.querySelectorAll(".detail-thumb").forEach((item, i) => {
          item.classList.toggle("active", i === activeIndex);
        });
      };
      if (images.length > 1) {
        bindSwipe(zoom, (dir) => showImage(activeIndex + dir));
      }

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
          button.addEventListener("click", () => showImage(index));
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
    tag.textContent =
      typeof window.PatygoCatalog.prettyBrandName === "function"
        ? window.PatygoCatalog.prettyBrandName(product.brand)
        : product.brand;

    const h1 = document.createElement("h1");
    h1.textContent = product.name;
    h1.setAttribute("aria-current", "page");

    const price = document.createElement("div");
    price.className = "price";
    price.innerHTML =
      window.PatygoCatalog.formatPrice(window.PatygoCatalog.priceInclVat(product)) +
      " <small>KDV dahil</small>";
    const discount = window.PatygoCatalog.discountInfo(product);
    if (discount) {
      const before = document.createElement("p");
      before.className = "detail-price-before";
      before.innerHTML =
        "<s></s> <span class=\"discount-badge discount-badge--inline\"></span>" +
        "<small>Son 30 günün en düşük fiyatına göre</small>";
      before.querySelector("s").textContent = window.PatygoCatalog.formatPrice(discount.before);
      before.querySelector(".discount-badge").textContent = "%" + discount.percent + " indirim";
      price.prepend(before);
    }

    const shippingLine =
      window.PatygoShipping && typeof window.PatygoShipping.createProductShippingEl === "function"
        ? window.PatygoShipping.createProductShippingEl(window.PatygoCatalog.priceInclVat(product))
        : null;
    if (shippingLine) {
      shippingLine.classList.add("detail-shipping");
    }
    const dispatchLine =
      window.PatygoShipping && typeof window.PatygoShipping.createDispatchEl === "function"
        ? window.PatygoShipping.createDispatchEl()
        : null;
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
    const trustItems = ["<li>Stokta · KDV dahil fiyat</li>"];
    if (isOriginalProduct(product)) trustItems.push("<li>Orijinal ürün</li>");
    trustItems.push(
      "<li>" + dispatchDaysLabel() + " kargoda</li>",
      "<li>3D Secure güvenli ödeme · kart bilgileriniz saklanmaz</li>",
      '<li>Sorunuz mu var? <a href="https://wa.me/905555070724" target="_blank" rel="noopener noreferrer">WhatsApp</a> · <a href="tel:+905555070724">0555 507 07 24</a></li>'
    );
    trust.innerHTML = trustItems.join("");

    info.appendChild(tag);
    info.appendChild(h1);
    info.appendChild(price);
    if (shippingLine) info.appendChild(shippingLine);
    if (dispatchLine) info.appendChild(dispatchLine);
    const installmentTable = buildInstallmentTable(window.PatygoCatalog.priceInclVat(product));
    if (installmentTable) info.appendChild(installmentTable);
    info.appendChild(actions);
    info.appendChild(trust);
    const hub = buildHighlights(product);
    if (hub) info.appendChild(hub);

    grid.appendChild(gallery);
    grid.appendChild(info);
    root.appendChild(crumb);
    root.appendChild(grid);
    root.appendChild(buildDetailTabs(product));
    bindStickyBuyBar(product, actions, add);

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

  const PATH_CACHE_KEY = "patygo_detail_by_path_v1";

  function normalizePathKey(value) {
    return String(value || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }

  function rememberProduct(product) {
    if (!product || !product.id) return;
    if (window.PatygoCatalog) {
      window.PatygoCatalog.byId = window.PatygoCatalog.byId || {};
      window.PatygoCatalog.byId[product.id] = product;
    }
    const pathKey = normalizePathKey(product.urlPath || (detailRoute.mode === "path" ? detailRoute.path : ""));
    if (!pathKey) return;
    try {
      const raw = sessionStorage.getItem(PATH_CACHE_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[pathKey] = product;
      const keys = Object.keys(map);
      if (keys.length > 40) {
        keys.slice(0, keys.length - 40).forEach((key) => {
          delete map[key];
        });
      }
      sessionStorage.setItem(PATH_CACHE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function cachedProductForRoute() {
    const byId = (window.PatygoCatalog && window.PatygoCatalog.byId) || {};
    if (detailRoute.mode === "id" && byId[detailRoute.id]) return byId[detailRoute.id];
    if (detailRoute.mode === "path") {
      const want = normalizePathKey(detailRoute.path);
      for (const id of Object.keys(byId)) {
        const item = byId[id];
        if (item && normalizePathKey(item.urlPath) === want) return item;
      }
      try {
        const raw = sessionStorage.getItem(PATH_CACHE_KEY);
        const map = raw ? JSON.parse(raw) : {};
        if (map[want]) return map[want];
      } catch (_) {}
    }
    return null;
  }

  function productFromListingPayload(data, route) {
    const products = data && Array.isArray(data.products) ? data.products : [];
    if (!products.length) return null;
    if (route.mode === "id") {
      return products.find((item) => item && String(item.id) === String(route.id)) || null;
    }
    if (route.mode === "path") {
      const want = normalizePathKey(route.path);
      return (
        products.find((item) => item && normalizePathKey(item.urlPath) === want) ||
        products.find((item) => {
          if (!item) return false;
          const segment = String(item.urlCategorySegment || item.siteChild || item.category || "")
            .replace(/^\/+|\/+$/g, "")
            .toLowerCase();
          const slug = String(item.urlSlug || "").toLowerCase();
          return segment && slug && normalizePathKey(segment + "/" + slug) === want;
        }) ||
        null
      );
    }
    return null;
  }

  function fetchJson(url, timeoutMs) {
    const opts = { cache: "default" };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      opts.signal = AbortSignal.timeout(timeoutMs);
    }
    return fetch(url, opts).then((res) => {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    });
  }

  /** Node API (tam alan) ile nginx disk listing yarışır; ilk geçerli ürün boyanır. */
  function raceProductSources(route) {
    const apiUrl =
      route.mode === "path"
        ? "/api/products?path=" + encodeURIComponent(route.path)
        : "/api/products?id=" + encodeURIComponent(route.id);
    const api = fetchJson(apiUrl, 12000).then((data) => {
      const product =
        Array.isArray(data.products) && data.products.length ? data.products[0] : null;
      if (!product) throw new Error("api empty");
      return { product, source: "api" };
    });
    const listing = fetchJson("/listing/all.json", 8000).then((data) => {
      const product = productFromListingPayload(data, route);
      if (!product) throw new Error("listing miss");
      // Listing kısa kayıttır (details/highlights yok); tam kayıt API'den gelince sayfa yenilenir.
      return { product, source: "listing", full: api };
    });
    return Promise.any([api, listing]);
  }

  async function loadDetail() {
    // Kargo metni ürünü bloklamasın; arka planda gelsin.
    const shippingReady =
      window.PatygoShipping && typeof window.PatygoShipping.load === "function"
        ? window.PatygoShipping.load().catch(() => null)
        : Promise.resolve(null);
    const installmentsReady =
      window.PatygoInstallments && typeof window.PatygoInstallments.load === "function"
        ? window.PatygoInstallments.load().catch(() => null)
        : Promise.resolve(null);
    if (detailRoute.mode === "none") {
      render(null, []);
      return;
    }
    const cats =
      (window.PatygoCatalog &&
      window.PatygoCatalog._lastCategories &&
      window.PatygoCatalog._lastCategories.length
        ? window.PatygoCatalog._lastCategories
        : null) ||
      (window.PatygoNav && Array.isArray(window.PatygoNav.categories)
        ? window.PatygoNav.categories
        : []) ||
      [];
    let renderedCats = cats;
    const cached = cachedProductForRoute();
    if (cached) render(cached, cats);

    let product = cached;
    try {
      const won = await raceProductSources(detailRoute);
      const fresh = won && won.product ? won.product : null;
      if (fresh) {
        rememberProduct(fresh);
        product = fresh;
        // ?id= links and pre-fix slugs (…-i-slemci) settle on the canonical product URL.
        if (fresh.urlPath && location.pathname.replace(/\/+$/, "") !== fresh.urlPath) {
          history.replaceState(null, "", fresh.urlPath + (detailRoute.mode === "id" ? "" : location.search));
        }
        render(fresh, cats);
        if (won.full) {
          won.full
            .then((full) => {
              if (!full || !full.product) return;
              rememberProduct(full.product);
              product = full.product;
              render(full.product, renderedCats);
            })
            .catch(() => {});
        }
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
            renderedCats = categories;
            render(product, categories);
          }
        })
        .catch(() => {});
    }

    shippingReady.then((settings) => {
      if (settings && product) render(product, renderedCats);
    });
    installmentsReady.then((settings) => {
      if (settings && settings.enabled && product) render(product, renderedCats);
    });
  }

  loadDetail();
})();
