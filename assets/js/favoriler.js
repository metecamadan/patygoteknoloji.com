(function () {
  "use strict";

  const favGrid = document.getElementById("favGrid");
  const favEmpty = document.getElementById("favEmpty");
  const favNote = document.getElementById("favNote");
  const compareTable = document.getElementById("compareTable");
  const compareEmpty = document.getElementById("compareEmpty");
  const MAX_SPEC_ROWS = 30;
  const productCache = {};
  const store = window.PatygoFavorites;
  const catalog = window.PatygoCatalog;
  if (!favGrid || !compareTable || !store || !catalog) return;

  function fetchProducts(ids) {
    const missing = ids.filter((id) => !productCache[id]);
    if (!missing.length) return Promise.resolve(true);
    return fetch("/api/products?ids=" + encodeURIComponent(missing.join(",")), { cache: "default" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.products)) return false;
        data.products.forEach((product) => {
          productCache[String(product.id)] = product;
        });
        return true;
      })
      .catch(() => false);
  }

  /** Ürün satıştan kalktıysa listeden düşer; ağ hatasında liste korunur. */
  function dropUnavailable(list, ids, ok) {
    if (!ok) return 0;
    const gone = ids.filter((id) => !productCache[id]);
    gone.forEach((id) => list.remove(id));
    return gone.length;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function specRows(product) {
    const rows = [];
    (Array.isArray(product.highlights) ? product.highlights : []).forEach((row) => {
      if (row && row.label) rows.push({ label: String(row.label), value: String(row.value || "") });
    });
    const specs = window.PatygoDetailSpecs;
    if (specs && typeof specs.parseProductDetailSpecTable === "function" && product.details) {
      (specs.parseProductDetailSpecTable(product.details) || []).forEach((row) => {
        if (row && row.label) rows.push({ label: String(row.label), value: String(row.value || "") });
      });
    }
    return rows;
  }

  function renderFavorites(ids) {
    favGrid.textContent = "";
    const products = ids.map((id) => productCache[id]).filter(Boolean);
    products.forEach((product, index) => {
      catalog.byId = catalog.byId || {};
      catalog.byId[product.id] = product;
      const card = catalog.makeCard(product, index, { compactListing: true });
      const body = card.querySelector(".body") || card;
      body.appendChild(store.createCompareButton(product.id, "btn btn-outline btn-sm compare-toggle"));
      favGrid.appendChild(card);
    });
    favEmpty.hidden = products.length > 0;
  }

  function renderCompare(ids) {
    compareTable.textContent = "";
    const products = ids.map((id) => productCache[id]).filter(Boolean);
    compareEmpty.hidden = products.length > 0;
    compareTable.hidden = products.length === 0;
    if (!products.length) return;

    const head = el("thead");
    const headRow = el("tr");
    headRow.appendChild(el("th", "compare-label", "Ürün"));
    products.forEach((product) => {
      const th = el("th");
      th.scope = "col";
      const link = el("a", "compare-product");
      link.href = catalog.productHref(product);
      if (product.image) {
        const img = el("img");
        img.src = product.thumb || product.image;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        link.appendChild(img);
      }
      link.appendChild(el("span", "", product.name || ""));
      th.appendChild(link);
      const remove = el("button", "compare-remove", "Çıkar");
      remove.type = "button";
      remove.setAttribute("aria-label", (product.name || "Ürün") + " karşılaştırmadan çıkar");
      remove.addEventListener("click", () => store.compare.remove(product.id));
      th.appendChild(remove);
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    compareTable.appendChild(head);

    const rows = [
      ["Fiyat (KDV dahil)", products.map((p) => catalog.formatPrice(catalog.priceInclVat(p)))],
      ["Marka", products.map((p) => catalog.prettyBrandName(p.brand))],
    ];
    const perProduct = products.map(specRows);
    const fixed = rows.map((row) => row[0].toLocaleLowerCase("tr-TR"));
    const labels = [];
    perProduct.forEach((list) =>
      list.forEach((row) => {
        if (fixed.indexOf(row.label.toLocaleLowerCase("tr-TR")) !== -1) return;
        if (labels.indexOf(row.label) === -1 && labels.length < MAX_SPEC_ROWS) labels.push(row.label);
      })
    );
    labels.forEach((label) => {
      rows.push([
        label,
        perProduct.map((list) => {
          const hit = list.find((row) => row.label === label);
          return hit ? hit.value : "—";
        }),
      ]);
    });

    const body = el("tbody");
    rows.forEach(([label, values]) => {
      const tr = el("tr");
      const th = el("th", "compare-label", label);
      th.scope = "row";
      tr.appendChild(th);
      const distinct = new Set(values).size > 1;
      values.forEach((value) => tr.appendChild(el("td", distinct ? "is-diff" : "", value)));
      body.appendChild(tr);
    });
    const cartRow = el("tr");
    cartRow.appendChild(el("th", "compare-label", ""));
    products.forEach((product) => {
      const td = el("td");
      const add = el("button", "btn btn-buy btn-sm", "Sepete Ekle");
      add.type = "button";
      add.addEventListener("click", () => {
        if (!window.PatygoCart) return;
        window.PatygoCart.add(product.id, 1, {
          brand: product.brand,
          name: product.name,
          price: product.price,
          vatPercent: product.vatPercent,
        });
        add.textContent = "Eklendi";
        window.setTimeout(() => {
          add.textContent = "Sepete Ekle";
        }, 1200);
      });
      td.appendChild(add);
      cartRow.appendChild(td);
    });
    body.appendChild(cartRow);
    compareTable.appendChild(body);
  }

  let renderSeq = 0;
  function render() {
    const seq = ++renderSeq;
    const favIds = store.favorites.ids();
    const compareIds = store.compare.ids();
    const all = Array.from(new Set(favIds.concat(compareIds)));
    fetchProducts(all).then((ok) => {
      if (seq !== renderSeq) return;
      const dropped = dropUnavailable(store.favorites, favIds, ok) + dropUnavailable(store.compare, compareIds, ok);
      if (dropped) {
        // remove() already triggered a fresh render through the patygo:favorites event.
        if (favNote) {
          favNote.textContent = dropped + " ürün artık satışta olmadığı için listeden çıkarıldı.";
          favNote.hidden = false;
        }
        return;
      }
      renderFavorites(store.favorites.ids());
      renderCompare(store.compare.ids());
      if (!scrolledToHash && location.hash === "#karsilastir") {
        scrolledToHash = true;
        const target = document.getElementById("karsilastir");
        if (target) target.scrollIntoView();
      }
    });
  }
  let scrolledToHash = false;

  document.addEventListener("patygo:favorites", render);
  render();
})();
