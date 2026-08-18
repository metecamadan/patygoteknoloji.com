(function () {
  "use strict";
  const root = document.getElementById("detailRoot");
  const id = new URLSearchParams(location.search).get("id") || "";

  function protectMedia(img) {
    img.setAttribute("draggable", "false");
    img.addEventListener("dragstart", (ev) => ev.preventDefault());
  }

  function render(product, categories) {
    root.textContent = "";
    if (!product) {
      root.innerHTML =
        '<p style="color:var(--muted)">Ürün bulunamadı. <a href="/urunler" style="color:var(--brand)">Ürün kataloğuna dön</a></p>';
      return;
    }

    document.title = product.name + " | Patygo Teknoloji";
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
      sep.textContent = "/";
      crumb.appendChild(sep);
      const link = document.createElement("a");
      link.href = part.href;
      link.textContent = part.text;
      crumb.appendChild(link);
    });
    const nameSep = document.createElement("span");
    nameSep.textContent = "/";
    crumb.appendChild(nameSep);
    const nameCrumb = document.createElement("span");
    nameCrumb.textContent = product.name;
    crumb.appendChild(nameCrumb);

    const tag = document.createElement("span");
    tag.className = "brand-tag";
    tag.textContent = product.brand;

    const h1 = document.createElement("h1");
    h1.textContent = product.name;

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

    info.appendChild(tag);
    info.appendChild(h1);
    info.appendChild(cat);
    info.appendChild(price);
    info.appendChild(actions);
    info.appendChild(trust);

    grid.appendChild(gallery);
    grid.appendChild(info);
    root.appendChild(crumb);
    root.appendChild(grid);

    if (product.description || product.details) {
      const description = document.createElement("section");
      description.className = "product-description reveal in";
      const heading = document.createElement("h2");
      heading.textContent = "Ürün Açıklaması";
      description.appendChild(heading);
      if (product.description) {
        const intro = document.createElement("p");
        intro.className = "detail-desc";
        intro.textContent = product.description;
        description.appendChild(intro);
      }
      if (product.details) {
        const body = document.createElement("div");
        body.className = "detail-body";
        body.textContent = product.details;
        description.appendChild(body);
      }
      root.appendChild(description);
    }

    upsertProductJsonLd(product, trail);
  }

  function upsertJsonLd(scriptId, data) {
    let el = document.getElementById(scriptId);
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = scriptId;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  function upsertProductJsonLd(product, trail) {
    const pageUrl =
      "https://patygoteknoloji.com/urun-detay?id=" + encodeURIComponent(product.id);
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
    if (!id) {
      render(null, []);
      return;
    }
    const cached = (window.PatygoCatalog.byId && window.PatygoCatalog.byId[id]) || null;
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
      const res = await fetch("/api/products?id=" + encodeURIComponent(id), {
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
