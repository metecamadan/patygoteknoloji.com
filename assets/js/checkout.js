(function () {
  const CATALOG = {
    "macbook-air-m3": {
      brand: "APPLE",
      name: 'MacBook Air 13" M3 8/256GB',
      price: 52999,
    },
    "thinkpad-e16": {
      brand: "LENOVO",
      name: "ThinkPad E16 i7 16/512GB",
      price: 38499,
    },
    "probook-450": {
      brand: "HP",
      name: "ProBook 450 G10 i5 16/512GB",
      price: 29999,
    },
    "epson-l3560": {
      brand: "EPSON",
      name: "EcoTank L3560 Wi-Fi Tanklı",
      price: 8749,
    },
    "dyson-v15": {
      brand: "DYSON",
      name: "V15 Detect Absolute Süpürge",
      price: 27499,
    },
    "arcelik-9103": {
      brand: "ARÇELİK",
      name: "9103 NFY A++ No-Frost Buzdolabı",
      price: 34499,
    },
    "philips-airfryer": {
      brand: "PHILIPS",
      name: "Airfryer XXL 5000 Series",
      price: 9999,
    },
    "hp-m404dn": {
      brand: "HP",
      name: "LaserJet Pro M404dn",
      price: 12499,
    },
  };

  const VAT_RATE = 0.2;

  const params = new URLSearchParams(window.location.search);
  const productId = params.get("id") || "";
  const product = CATALOG[productId] || null;

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
        "Ürün bulunamadı. Lütfen ürün listesinden Satın Al ile tekrar deneyin.";
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
   * Sanal POS entegrasyon noktası.
   * PayTR / iyzico bağlandığında burada token alınıp ödeme sayfasına yönlendirilir.
   * Şimdilik sipariş kaydı oluşturulur (localStorage demo).
   */
  function startVirtualPos(order) {
    // Gelecek: fetch('/api/pos/init', { method:'POST', body: JSON.stringify(order) })
    // .then(r => r.json()).then(({ paymentUrl }) => { window.location = paymentUrl; });
    return { redirected: false, provider: null, order };
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
      customer: {
        name: ad,
        company: els.form.firma.value.trim(),
        email,
        phone: tel,
        taxId: els.form.vergi.value.trim(),
        note: els.form.not.value.trim(),
      },
      status: "pending_payment",
      createdAt: new Date().toISOString(),
    };

    try {
      const key = "patygo_orders";
      const prev = JSON.parse(localStorage.getItem(key) || "[]");
      prev.unshift(order);
      localStorage.setItem(key, JSON.stringify(prev.slice(0, 50)));
      localStorage.setItem("patygo_last_order", JSON.stringify(order));
    } catch (_) {
      /* ignore storage errors */
    }

    const pos = startVirtualPos(order);
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
      " (KDV dahil)";

    els.posBox.textContent =
      "Sipariş kaydı oluşturuldu. Sanal POS bağlandığında ödeme bu sipariş numarası ile başlatılacaktır.";
  });
})();
