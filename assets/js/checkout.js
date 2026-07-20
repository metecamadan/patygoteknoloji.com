(function () {
  const VAT_RATE = (window.PatygoCart && window.PatygoCart.VAT) || 0.2;
  const params = new URLSearchParams(window.location.search);
  const directId = params.get("id") || "";

  const els = {
    brand: document.getElementById("orderBrand"),
    brandLabel: document.getElementById("orderBrandLabel"),
    name: document.getElementById("orderName"),
    unitPrice: document.getElementById("unitPrice"),
    qtyLabel: document.getElementById("qtyLabel"),
    subtotal: document.getElementById("subtotal"),
    vatAmount: document.getElementById("vatAmount"),
    grandTotal: document.getElementById("grandTotal"),
    orderIdPreview: document.getElementById("orderIdPreview"),
    adet: document.getElementById("adet"),
    form: document.getElementById("checkout-form"),
    note: document.getElementById("checkoutNote"),
    posBox: document.getElementById("posBox"),
    root: document.getElementById("checkoutRoot"),
    success: document.getElementById("orderSuccess"),
    successOrderId: document.getElementById("successOrderId"),
    successSummary: document.getElementById("successSummary"),
    qtyRow: document.querySelector(".qty-row"),
  };

  function formatTRY(amount) {
    return (
      "₺" +
      Math.round(amount).toLocaleString("tr-TR", {
        maximumFractionDigits: 0,
      })
    );
  }

  function makeOrderId() {
    const d = new Date();
    const stamp =
      d.getFullYear().toString().slice(2) +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    return "PTY-" + stamp + "-" + rand;
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function boot(catalogById) {
    let mode = "cart";
    let lines = [];
    let product = null;

    if (directId && catalogById[directId]) {
      mode = "direct";
      product = catalogById[directId];
      const qty = Math.max(1, Math.min(99, Number(els.adet && els.adet.value) || 1));
      lines = [{ product, qty, line: product.price * qty }];
    } else if (window.PatygoCart) {
      const t = window.PatygoCart.totals(catalogById);
      lines = t.lines;
    }

    function calc() {
      if (mode === "direct" && product) {
        const qty = Math.max(1, Math.min(99, Number(els.adet.value) || 1));
        els.adet.value = String(qty);
        const sub = product.price * qty;
        const vat = sub * VAT_RATE;
        const total = sub + vat;
        lines = [{ product, qty, line: sub }];
        if (els.qtyLabel) els.qtyLabel.textContent = String(qty);
        if (els.unitPrice) els.unitPrice.textContent = formatTRY(product.price);
        if (els.subtotal) els.subtotal.textContent = formatTRY(sub);
        if (els.vatAmount) els.vatAmount.textContent = formatTRY(vat);
        if (els.grandTotal) els.grandTotal.textContent = formatTRY(total);
        return { qty, sub, vat, total, lines };
      }
      const t = window.PatygoCart.totals(catalogById);
      lines = t.lines;
      if (els.qtyLabel) {
        els.qtyLabel.textContent = String(
          t.lines.reduce((n, l) => n + l.qty, 0)
        );
      }
      if (els.unitPrice) els.unitPrice.textContent = "—";
      if (els.subtotal) els.subtotal.textContent = formatTRY(t.sub);
      if (els.vatAmount) els.vatAmount.textContent = formatTRY(t.vat);
      if (els.grandTotal) els.grandTotal.textContent = formatTRY(t.total);
      return { qty: t.lines.reduce((n, l) => n + l.qty, 0), sub: t.sub, vat: t.vat, total: t.total, lines: t.lines };
    }

    if (!lines.length && mode === "cart") {
      if (els.name) els.name.textContent = "Sepetiniz boş";
      if (els.note) {
        els.note.classList.add("err");
        els.note.textContent = "Önce sepete ürün ekleyin veya ürün sayfasından Hemen Al seçin.";
      }
      if (els.form) {
        const btn = els.form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
      }
      return;
    }

    if (mode === "direct") {
      els.brand.textContent = product.brand.slice(0, 8);
      els.brandLabel.textContent = product.brand;
      els.name.textContent = product.name;
      if (els.qtyRow) els.qtyRow.hidden = false;
    } else {
      els.brand.textContent = "SEPET";
      els.brandLabel.textContent = "SEPET";
      els.name.textContent = lines.map((l) => l.product.name + " × " + l.qty).join(", ");
      if (els.qtyRow) els.qtyRow.hidden = true;
      if (els.adet) els.adet.removeAttribute("required");
    }

    els.orderIdPreview.textContent = makeOrderId();
    calc();

    if (els.adet && mode === "direct") {
      els.adet.addEventListener("input", calc);
      els.adet.addEventListener("change", calc);
    }

    function startVirtualPos() {
      return { redirected: false, provider: null };
    }

    els.form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const ad = els.form.ad.value.trim();
      const email = els.form.email.value.trim();
      const tel = els.form.tel.value.trim();
      if (!ad || !email || !tel) {
        els.note.classList.remove("ok");
        els.note.classList.add("err");
        els.note.textContent = "Lütfen zorunlu alanları doldurun.";
        return;
      }
      if (!isValidEmail(email)) {
        els.note.classList.remove("ok");
        els.note.classList.add("err");
        els.note.textContent = "Geçerli bir e-posta adresi girin.";
        return;
      }
      if (
        !els.form.onayOnBilgi?.checked ||
        !els.form.onayMesafeli?.checked ||
        !els.form.onayIade?.checked
      ) {
        els.note.classList.remove("ok");
        els.note.classList.add("err");
        els.note.textContent =
          "Devam etmek için Ön Bilgilendirme, Mesafeli Satış Sözleşmesi ve İade/Cayma koşullarını onaylayın.";
        return;
      }

      const totals = calc();
      if (!totals.lines.length) {
        els.note.classList.add("err");
        els.note.textContent = "Sepet boş.";
        return;
      }

      const order = {
        id: els.orderIdPreview.textContent || makeOrderId(),
        items: totals.lines.map((l) => ({
          productId: l.product.id,
          brand: l.product.brand,
          name: l.product.name,
          unitPrice: l.product.price,
          qty: l.qty,
          line: l.line,
        })),
        subtotal: totals.sub,
        vat: totals.vat,
        total: totals.total,
        currency: "TRY",
        customer: {
          name: ad,
          company: els.form.firma.value.trim(),
          email,
          phone: tel,
        },
        contractsAccepted: {
          onBilgilendirme: true,
          mesafeliSatis: true,
          iadeCayma: true,
          at: new Date().toISOString(),
        },
        status: "request_received",
        paymentTaken: false,
        createdAt: new Date().toISOString(),
      };

      try {
        const key = "patygo_orders";
        const prev = JSON.parse(localStorage.getItem(key) || "[]");
        prev.unshift(order);
        localStorage.setItem(key, JSON.stringify(prev.slice(0, 20)));
        localStorage.setItem(
          "patygo_last_order",
          JSON.stringify({
            id: order.id,
            total: order.total,
            createdAt: order.createdAt,
          })
        );
      } catch (_) {}

      if (mode === "cart" && window.PatygoCart) window.PatygoCart.clear();

      const pos = startVirtualPos();
      if (pos.redirected) return;

      els.root.hidden = true;
      els.success.hidden = false;
      els.successOrderId.textContent = order.id;
      els.successSummary.textContent =
        order.items.map((i) => i.name + " × " + i.qty).join(" · ") +
        " — " +
        formatTRY(order.total) +
        " (KDV dahil) · Ödeme alınmadı";
      if (els.posBox) {
        els.posBox.textContent =
          "Sipariş talebi kaydedildi. Kart ödemesi henüz aktif değildir.";
      }
    });
  }

  function start() {
    const run = () => boot(window.PatygoCatalog.byId || {});
    if (window.PatygoCatalog && window.PatygoCatalog.ready) {
      window.PatygoCatalog.ready.then(run);
    } else {
      window.addEventListener("patygo:catalog", run, { once: true });
    }
  }

  start();
})();
