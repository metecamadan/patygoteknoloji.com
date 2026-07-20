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

    const media = document.createElement("div");
    media.className = "detail-media";
    if (product.image) {
      const img = document.createElement("img");
      img.src = product.image;
      img.alt = product.name;
      media.appendChild(img);
    } else {
      media.textContent = product.brand;
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

    const desc = document.createElement("p");
    desc.className = "detail-desc";
    desc.textContent = product.description || "";

    const details = document.createElement("div");
    details.className = "detail-body";
    details.textContent = product.details || "";

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
      window.PatygoCart.add(product.id, 1);
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
    if (product.description) info.appendChild(desc);
    if (product.details) info.appendChild(details);
    info.appendChild(price);
    info.appendChild(actions);

    grid.appendChild(media);
    grid.appendChild(info);
    root.appendChild(grid);
  }

  window.PatygoCatalog.ready.then(() => {
    render(window.PatygoCatalog.byId[id] || null);
  });
})();
