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
    if (path.endsWith("/") || path.endsWith("index.html") || path === "") return "#teklif";
    return "index.html#teklif";
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
    titleLink.href = "urun-detay.html?id=" + encodeURIComponent(product.id);
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
        window.PatygoCart.add(product.id, 1);
        cartBtn.textContent = "Eklendi";
        setTimeout(() => {
          cartBtn.textContent = "Sepete Ekle";
        }, 1200);
      }
    });

    const buy = document.createElement("a");
    buy.className = "btn btn-outline";
    buy.href = "odeme.html?id=" + encodeURIComponent(product.id);
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

  function renderGrid(grid, products) {
    const mode = grid.getAttribute("data-catalog") || "all";
    let list = products.slice();
    if (mode === "featured") list = list.filter((p) => p.featured);
    grid.textContent = "";
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

  function applyCatalog(all) {
    const products = (all || []).filter((p) => p && p.active !== false);
    window.PatygoCatalog.list = products;
    window.PatygoCatalog.byId = Object.fromEntries(products.map((p) => [p.id, p]));
    document.querySelectorAll(".product-grid[data-catalog]").forEach((grid) => {
      renderGrid(grid, products);
    });
    bindTabs(document);
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

  async function reloadCatalog() {
    const all = await loadProducts();
    return applyCatalog(all);
  }

  window.PatygoCatalog.reload = reloadCatalog;

  window.PatygoCatalog.ready = reloadCatalog();

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
