(function () {
  "use strict";
  const root = document.getElementById("detailRoot");
  const id = new URLSearchParams(location.search).get("id") || "";

  function render(product) {
    root.textContent = "";
    if (!product) {
      root.innerHTML =
        '<p style="color:var(--muted)">Ürün bulunamadı. <a href="urunler.html" style="color:var(--brand)">Ürünlere dön</a></p>';
      return;
    }

    document.title = product.name + " | Patygo Teknoloji";

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
    const crumb = document.createElement("div");
    crumb.className = "breadcrumb";
    crumb.innerHTML =
      '<a href="index.html">Ana Sayfa</a> <span>/</span> <a href="urunler.html">Ürünler</a> <span>/</span> <span></span>';
    crumb.querySelector("span:last-child").textContent = product.name;

    const tag = document.createElement("span");
    tag.className = "brand-tag";
    tag.textContent = product.brand;

    const h1 = document.createElement("h1");
    h1.textContent = product.name;

    const cat = document.createElement("p");
    cat.className = "detail-cat";
    cat.textContent = window.PatygoCatalog.categoryLabel(product.category);

    const price = document.createElement("div");
    price.className = "price";
    price.innerHTML =
      window.PatygoCatalog.formatPrice(product.price) + " <small>+KDV</small>";

    const actions = document.createElement("div");
    actions.className = "actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-primary btn-lg";
    add.textContent = "Sepete Ekle";
    add.addEventListener("click", () => {
      window.PatygoCart.add(product.id, 1, {
        brand: product.brand,
        name: product.name,
        price: product.price,
      });
      add.textContent = "Sepete eklendi";
    });
    const buy = document.createElement("a");
    buy.className = "btn btn-outline btn-lg";
    buy.href = "odeme.html?id=" + encodeURIComponent(product.id);
    buy.textContent = "Hemen Al";
    actions.appendChild(add);
    actions.appendChild(buy);

    info.appendChild(crumb);
    info.appendChild(tag);
    info.appendChild(h1);
    info.appendChild(cat);
    info.appendChild(price);
    info.appendChild(actions);

    grid.appendChild(gallery);
    grid.appendChild(info);
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
  }

  window.PatygoCatalog.ready.then(() => {
    render(window.PatygoCatalog.byId[id] || null);
  });
})();
