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
      const p = document.createElement("p");
      p.style.color = "var(--muted)";
      p.textContent = "Sepetiniz boş. Ürünler sayfasından sepete ekleyebilirsiniz.";
      linesEl.appendChild(p);
      checkoutBtn.classList.add("disabled");
      checkoutBtn.setAttribute("aria-disabled", "true");
      checkoutBtn.href = "urunler.html";
      checkoutBtn.textContent = "Ürünlere git";
      note.textContent = "";
      return;
    }

    checkoutBtn.classList.remove("disabled");
    checkoutBtn.removeAttribute("aria-disabled");
    checkoutBtn.href = "odeme.html";
    checkoutBtn.textContent = "Ödemeye Geç";
    note.textContent = "Ödeme adımında KDV dahil tutar üzerinden sipariş talebi oluşur.";

    const title = document.createElement("h2");
    title.style.cssText = "font-size:1.15rem;margin-bottom:14px";
    title.textContent = "Ürünler";
    linesEl.appendChild(title);

    totals.lines.forEach(({ product, qty, line }) => {
      const row = document.createElement("div");
      row.className = "cart-line";

      const media = document.createElement("div");
      media.className = "cart-thumb";
      if (product.image) {
        const img = document.createElement("img");
        img.src = product.image;
        img.alt = product.name;
        media.appendChild(img);
      } else {
        media.textContent = (product.brand || "?").slice(0, 4);
      }

      const meta = document.createElement("div");
      const brand = document.createElement("span");
      brand.className = "brand-tag";
      brand.textContent = product.brand;
      const name = document.createElement("h3");
      name.textContent = product.name;
      const unit = document.createElement("p");
      unit.className = "cart-unit";
      unit.textContent = money(product.price) + " +KDV / adet";
      meta.appendChild(brand);
      meta.appendChild(name);
      meta.appendChild(unit);

      const qtyWrap = document.createElement("div");
      qtyWrap.className = "cart-qty";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.max = "99";
      input.value = String(qty);
      input.addEventListener("change", () => {
        window.PatygoCart.setQty(product.id, input.value);
        render();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost";
      remove.textContent = "Kaldır";
      remove.addEventListener("click", () => {
        window.PatygoCart.setQty(product.id, 0);
        render();
      });
      qtyWrap.appendChild(input);
      qtyWrap.appendChild(remove);

      const sum = document.createElement("strong");
      sum.className = "cart-line-sum";
      sum.textContent = money(line);

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
