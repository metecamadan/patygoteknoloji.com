/* Patygo — ürün kataloğunu tek kaynaktan render eder */
(function () {
  "use strict";

  const products = (window.PATYGO_PRODUCTS || []).filter((p) => p && p.active !== false);

  window.PatygoCatalog = {
    list: products,
    byId: Object.fromEntries(products.map((p) => [p.id, p])),
    formatPrice(amount) {
      return (
        "₺" +
        Math.round(Number(amount) || 0).toLocaleString("tr-TR", {
          maximumFractionDigits: 0,
        })
      );
    },
  };

  function quoteHref() {
    const path = (location.pathname || "").toLowerCase();
    if (path.endsWith("/") || path.endsWith("index.html") || path === "") {
      return "#teklif";
    }
    return "index.html#teklif";
  }

  function makeCard(product, index) {
    const article = document.createElement("article");
    const delay = index % 3 === 1 ? " d1" : index % 3 === 2 ? " d2" : "";
    article.className = "product-card reveal" + delay + " in";
    article.dataset.cat = product.category || "";

    const brand = String(product.brand || "").toUpperCase();

    const visual = document.createElement("div");
    visual.className = "visual";
    const brandSpan = document.createElement("span");
    brandSpan.textContent = brand;
    visual.appendChild(brandSpan);

    const body = document.createElement("div");
    body.className = "body";

    const tag = document.createElement("span");
    tag.className = "brand-tag";
    tag.textContent = brand;

    const title = document.createElement("h3");
    title.textContent = product.name || "";

    const price = document.createElement("div");
    price.className = "price";
    price.appendChild(document.createTextNode(window.PatygoCatalog.formatPrice(product.price) + " "));
    const small = document.createElement("small");
    small.textContent = "+KDV";
    price.appendChild(small);

    const actions = document.createElement("div");
    actions.className = "actions";

    const buy = document.createElement("a");
    buy.className = "btn btn-buy";
    buy.href = "odeme.html?id=" + encodeURIComponent(product.id);
    buy.textContent = "Satın Al";

    const quote = document.createElement("a");
    quote.className = "btn btn-quote";
    quote.href = quoteHref();
    quote.textContent = "Teklif Al";

    actions.appendChild(buy);
    actions.appendChild(quote);
    body.appendChild(tag);
    body.appendChild(title);
    body.appendChild(price);
    body.appendChild(actions);
    article.appendChild(visual);
    article.appendChild(body);
    return article;
  }

  function bindTabs(scope) {
    const root = scope || document;
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

  function renderGrid(grid) {
    const mode = grid.getAttribute("data-catalog") || "all";
    let list = products.slice();
    if (mode === "featured") list = list.filter((p) => p.featured);

    grid.textContent = "";
    if (!list.length) {
      const empty = document.createElement("p");
      empty.style.color = "var(--muted)";
      empty.style.gridColumn = "1 / -1";
      empty.textContent =
        "Henüz aktif ürün yok. assets/js/products-data.js dosyasına ürün ekleyin.";
      grid.appendChild(empty);
      return;
    }
    list.forEach((product, index) => grid.appendChild(makeCard(product, index)));
  }

  document.querySelectorAll(".product-grid[data-catalog]").forEach(renderGrid);
  bindTabs(document);
})();
