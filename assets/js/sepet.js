(function () {
  "use strict";

  const linesEl = document.getElementById("cartLines");
  const note = document.getElementById("cartNote");
  const checkoutBtn = document.getElementById("cartCheckout");

  function money(n) {
    return window.PatygoCatalog.formatPrice(n);
  }

  function render() {
    const byId = window.PatygoCatalog.byId || {};
    const totals = window.PatygoCart.totals(byId);
    document.getElementById("cartSub").textContent = money(totals.sub);
    document.getElementById("cartVat").textContent = money(totals.vat);
    document.getElementById("cartTotal").textContent = money(totals.total);

    linesEl.textContent = "";
    if (!totals.lines.length) {
      const empty = document.createElement("div");
      empty.className = "cart-empty";
      empty.innerHTML =
        '<span class="cart-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3" stroke-linecap="round"/></svg></span>' +
        "<h2>Sepetiniz şu anda boş</h2>" +
        "<p>İhtiyacınız olan ürünleri inceleyerek sepetinize ekleyebilirsiniz.</p>" +
        '<a href="urunler.html" class="btn btn-primary">Ürünleri incele</a>';
      linesEl.appendChild(empty);
      checkoutBtn.classList.add("disabled");
      checkoutBtn.setAttribute("aria-disabled", "true");
      checkoutBtn.href = "urunler.html";
      checkoutBtn.textContent = "Ürünlere git";
      note.textContent = "";
      note.hidden = true;
      return;
    }

    checkoutBtn.classList.remove("disabled");
    checkoutBtn.removeAttribute("aria-disabled");
    checkoutBtn.href = "odeme.html";
    checkoutBtn.textContent = "Sipariş talebine geç";
    note.textContent = "Bu adımda ödeme alınmaz. Bilgilerinizi tamamladıktan sonra sipariş talebiniz oluşturulur.";
    note.hidden = false;

    const header = document.createElement("div");
    header.className = "cart-products-header";
    const title = document.createElement("h2");
    title.textContent = "Sepetinizdeki ürünler";
    const count = document.createElement("span");
    count.textContent =
      totals.lines.reduce((sum, item) => sum + item.qty, 0) + " ürün";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "cart-clear";
    clear.textContent = "Sepeti temizle";
    clear.addEventListener("click", () => {
      if (confirm("Sepetinizdeki tüm ürünler kaldırılsın mı?")) {
        window.PatygoCart.clear();
      }
    });
    const heading = document.createElement("div");
    heading.appendChild(title);
    heading.appendChild(count);
    header.appendChild(heading);
    header.appendChild(clear);
    linesEl.appendChild(header);

    totals.lines.forEach(({ product, qty, line }) => {
      const row = document.createElement("div");
      row.className = "cart-line";

      const media = document.createElement("a");
      media.className = "cart-thumb";
      media.href = "urun-detay.html?id=" + encodeURIComponent(product.id);
      media.setAttribute("aria-label", product.name + " detayını görüntüle");
      const primaryImage =
        (Array.isArray(product.images) && product.images.find(Boolean)) ||
        product.image ||
        "";
      if (primaryImage) {
        const img = document.createElement("img");
        img.src = primaryImage;
        img.alt = product.name;
        media.appendChild(img);
      } else {
        media.textContent = (product.brand || "?").slice(0, 4);
      }

      const meta = document.createElement("div");
      meta.className = "cart-meta";
      const brand = document.createElement("span");
      brand.className = "brand-tag";
      brand.textContent = product.brand;
      const name = document.createElement("h3");
      const nameLink = document.createElement("a");
      nameLink.href = "urun-detay.html?id=" + encodeURIComponent(product.id);
      nameLink.textContent = product.name;
      name.appendChild(nameLink);
      const unit = document.createElement("p");
      unit.className = "cart-unit";
      unit.textContent = money(product.price) + " + KDV / adet";
      meta.appendChild(brand);
      meta.appendChild(name);
      meta.appendChild(unit);

      const qtyWrap = document.createElement("div");
      qtyWrap.className = "cart-qty";
      const qtyLabel = document.createElement("span");
      qtyLabel.className = "cart-control-label";
      qtyLabel.textContent = "Adet";
      const stepper = document.createElement("div");
      stepper.className = "cart-stepper";
      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.setAttribute("aria-label", product.name + " adedini azalt");
      decrease.textContent = "−";
      decrease.addEventListener("click", () => {
        window.PatygoCart.setQty(product.id, qty - 1);
      });
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.max = "99";
      input.value = String(qty);
      input.setAttribute("aria-label", product.name + " adedi");
      input.addEventListener("change", () => {
        window.PatygoCart.setQty(product.id, input.value);
      });
      const increase = document.createElement("button");
      increase.type = "button";
      increase.setAttribute("aria-label", product.name + " adedini artır");
      increase.textContent = "+";
      increase.addEventListener("click", () => {
        window.PatygoCart.setQty(product.id, qty + 1);
      });
      stepper.appendChild(decrease);
      stepper.appendChild(input);
      stepper.appendChild(increase);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cart-remove";
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M8 11v6M12 11v6M16 11v6M6 7l1 14h10l1-14" stroke-linecap="round" stroke-linejoin="round"/></svg>Kaldır';
      remove.addEventListener("click", () => {
        window.PatygoCart.setQty(product.id, 0);
      });
      qtyWrap.appendChild(qtyLabel);
      qtyWrap.appendChild(stepper);
      qtyWrap.appendChild(remove);

      const sum = document.createElement("div");
      sum.className = "cart-line-sum";
      const sumLabel = document.createElement("span");
      sumLabel.textContent = "Toplam";
      const sumValue = document.createElement("strong");
      sumValue.textContent = money(line);
      sum.appendChild(sumLabel);
      sum.appendChild(sumValue);

      row.appendChild(media);
      row.appendChild(meta);
      row.appendChild(qtyWrap);
      row.appendChild(sum);
      linesEl.appendChild(row);
    });
  }

  function boot() {
    if (window.PatygoCatalog && window.PatygoCatalog.ready) {
      window.PatygoCatalog.ready.then(render);
    } else {
      window.addEventListener("patygo:catalog", render, { once: true });
    }
    window.addEventListener("patygo:cart", render);
  }

  boot();
})();
