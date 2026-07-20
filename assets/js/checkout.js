(function () {
  const catalog = (window.PatygoCatalog && window.PatygoCatalog.byId) || {};
  const VAT_RATE = 0.2;

  const params = new URLSearchParams(window.location.search);
  const productId = params.get("id") || "";
  const product = catalog[productId] || null;

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

  function renderTotals() {
    if (!product) return;
    const qty = Math.max(1, Math.min(99, Number(els.adet.value) || 1));
    els.adet.value = String(qty);
    const sub = product.price * qty;
    const vat = sub * VAT_RATE;
    const total = sub + vat;
    els.qtyLabel.textContent = String(qty);
    els.subtotal.textContent = formatTRY(sub);
    els.vatAmount.textContent = formatTRY(vat);
    els.grandTotal.textContent = formatTRY(total);
    return { qty, sub, vat, total };
  }

  if (!product) {
    if (els.name) els.name.textContent = "Geçerli bir ürün seçilmedi";
    if (els.note) {
      els.note.classList.add("err");
      els.note.textContent =
        "Ürün bulunamadı. Lütfen Ürünler sayfasından Satın Al ile tekrar deneyin.";
    }
    if (els.form) {
      const btn = els.form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
    }
    return;
  }

  els.brand.textContent = product.brand.slice(0, 8);
  els.brandLabel.textContent = product.brand;
  els.name.textContent = product.name;
  els.unitPrice.textContent = formatTRY(product.price);
  els.orderIdPreview.textContent = makeOrderId();
  renderTotals();

  els.adet.addEventListener("input", renderTotals);
  els.adet.addEventListener("change", renderTotals);

  /**
   * Sanal POS entegrasyon noktası (henüz aktif değil).
   * Production'da paymentUrl yalnızca allowlist hostlara yönlendirilmeli.
   */
  function startVirtualPos() {
    return { redirected: false, provider: null };
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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

    const totals = renderTotals();
    const order = {
      id: els.orderIdPreview.textContent || makeOrderId(),
      productId,
      brand: product.brand,
      name: product.name,
      unitPrice: product.price,
      qty: totals.qty,
      subtotal: totals.sub,
      vat: totals.vat,
      total: totals.total,
      currency: "TRY",
      // Hassas vergi no tarayıcıda saklanmaz
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
          productId: order.productId,
          name: order.name,
          total: order.total,
          createdAt: order.createdAt,
        })
      );
    } catch (_) {
      /* ignore storage errors */
    }

    const pos = startVirtualPos();
    if (pos.redirected) return;

    els.root.hidden = true;
    els.success.hidden = false;
    els.successOrderId.textContent = order.id;
    els.successSummary.textContent =
      order.brand +
      " · " +
      order.name +
      " × " +
      order.qty +
      " — " +
      formatTRY(order.total) +
      " (KDV dahil) · Ödeme alınmadı";

    els.posBox.textContent =
      "Sipariş talebi kaydedildi. Kart ödemesi henüz aktif değildir.";
  });
})();
