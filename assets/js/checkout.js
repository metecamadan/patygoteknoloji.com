(function () {
  const PENDING_ORDER_KEY = "patygo_pending_order";
  const params = new URLSearchParams(window.location.search);
  const directId = params.get("id") || "";
  const paymentResult = params.get("payment") || "";
  const returnedOrderId = params.get("orderId") || "";

  function vatOf(product) {
    if (window.PatygoCart && window.PatygoCart.normalizeVatPercent) {
      return window.PatygoCart.normalizeVatPercent(product && product.vatPercent);
    }
    if (window.PatygoCatalog && window.PatygoCatalog.normalizeVatPercent) {
      return window.PatygoCatalog.normalizeVatPercent(product && product.vatPercent);
    }
    const n = Number(product && product.vatPercent);
    return [1, 8, 10, 20].includes(n) ? n : 20;
  }

  function priceIncl(product) {
    if (window.PatygoCatalog && window.PatygoCatalog.priceInclVat) {
      return window.PatygoCatalog.priceInclVat(product);
    }
    const net = Number(product && product.price) || 0;
    return Math.round(net * (1 + vatOf(product) / 100) * 100) / 100;
  }

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
    successTitle: document.getElementById("successTitle"),
    successLead: document.getElementById("successLead"),
    successOrderId: document.getElementById("successOrderId"),
    successSummary: document.getElementById("successSummary"),
    qtyRow: document.querySelector(".qty-row"),
    payBtn: document.getElementById("payBtn"),
  };

  let posStatus = { enabled: false, testMode: true, provider: "akbank" };

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

  function showResult(kind, order) {
    if (els.root) {
      els.root.hidden = true;
      els.root.style.display = "none";
    }
    if (els.success) {
      els.success.hidden = false;
      els.success.style.display = "block";
    }
    const paid = kind === "success";
    if (els.successTitle) {
      els.successTitle.textContent = paid ? "Ödemeniz alındı" : "Ödeme tamamlanamadı";
    }
    if (els.successLead) {
      if (paid) {
        els.successLead.textContent =
          "Akbank güvenli ödeme ekranından işleminiz onaylandı. Siparişiniz işleme alındı.";
      } else {
        const bankMsg =
          order &&
          order.bankResponse &&
          (order.bankResponse.responseMessage || order.bankResponse.responseCode);
        els.successLead.textContent = bankMsg
          ? "Banka: " + bankMsg + " — Sepetten tekrar deneyebilirsiniz."
          : "Kart işlemi tamamlanmadı veya banka reddetti. Sepetten tekrar deneyebilirsiniz.";
      }
    }
    if (els.successOrderId) els.successOrderId.textContent = (order && order.id) || returnedOrderId || "—";
    if (els.successSummary) {
      if (order && order.items) {
        els.successSummary.textContent =
          order.items.map((i) => i.name + " × " + i.qty).join(" · ") +
          " — " +
          formatTRY(order.total) +
          (paid ? " (KDV dahil) · Ödeme alındı" : " (KDV dahil)");
      } else {
        els.successSummary.textContent = paid
          ? "Ödeme başarıyla alındı. Sipariş numaranızı saklayın."
          : "Sipariş için ödeme alınmadı.";
      }
    }
    const retry = document.getElementById("retryPayBtn");
    if (retry) retry.hidden = paid;
    if (paid && window.PatygoAnalytics) window.PatygoAnalytics.track("order_submitted");
    if (paid && window.PatygoCart) window.PatygoCart.clear();
    try {
      if (paid) sessionStorage.removeItem(PENDING_ORDER_KEY);
    } catch (_) {}
    try {
      const clean = new URL(window.location.href);
      if (clean.searchParams.has("payment")) {
        const keepId = (order && order.id) || returnedOrderId || "";
        clean.searchParams.delete("payment");
        if (keepId) clean.searchParams.set("orderId", keepId);
        else clean.searchParams.delete("orderId");
        window.history.replaceState({}, "", clean.pathname + (clean.search || ""));
      }
    } catch (_) {}
  }

  function postToBank(action, fields) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.target = "_top";
    form.style.display = "none";
    Object.keys(fields || {}).forEach((key) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = fields[key] == null ? "" : String(fields[key]);
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }

  async function loadPosStatus() {
    try {
      const res = await fetch("/api/payment/status");
      if (res.ok) posStatus = await res.json();
    } catch (_) {}
    if (els.posBox) {
      if (posStatus.enabled) {
        els.posBox.textContent =
          "Ödeme Akbank SecurePay ile alınır. Kart bilgileriniz bankanın güvenli sayfasında girilir" +
          (posStatus.testMode ? " (TEST ortamı)." : ".");
      } else {
        els.posBox.textContent =
          "Ödeme şu an kullanılamıyor. Lütfen daha sonra tekrar deneyin veya info@patygoteknoloji.com ile iletişime geçin.";
      }
    }
    if (els.payBtn) {
      els.payBtn.textContent = posStatus.enabled ? "Güvenli Ödemeye Geç" : "POS Yapılandırması Bekleniyor";
      els.payBtn.disabled = !posStatus.enabled;
    }
  }

  async function fetchOrder(orderId) {
    if (!orderId) return null;
    const res = await fetch("/api/payment/order?orderId=" + encodeURIComponent(orderId));
    if (!res.ok) return null;
    const data = await res.json();
    return data.order || null;
  }

  async function hydratePaymentReturn() {
    let pendingId = "";
    try {
      pendingId = sessionStorage.getItem(PENDING_ORDER_KEY) || "";
    } catch (_) {}
    const orderId = returnedOrderId || pendingId;
    if (!paymentResult && !orderId) return false;

    let order = null;
    try {
      order = await fetchOrder(orderId);
    } catch (_) {}

    if (paymentResult) {
      showResult(paymentResult === "success" ? "success" : "failed", order);
      return true;
    }
    if (order && (order.paymentTaken || order.paymentStatus === "paid")) {
      showResult("success", order);
      return true;
    }
    return false;
  }

  let booted = false;
  let submitBound = false;
  let calcFn = null;

  function boot(catalogById) {
    let mode = "cart";
    let lines = [];
    let product = null;
    const storedQty = window.PatygoCart
      ? window.PatygoCart.list().reduce((n, item) => n + (Number(item.qty) || 0), 0)
      : 0;

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
        const sub = Math.round(product.price * qty * 100) / 100;
        const vat =
          Math.round(sub * (vatOf(product) / 100) * 100) / 100;
        const total = Math.round((sub + vat) * 100) / 100;
        lines = [{ product, qty, line: sub, lineVat: vat, lineIncl: total }];
        if (els.qtyLabel) els.qtyLabel.textContent = String(qty);
        if (els.unitPrice) els.unitPrice.textContent = formatTRY(priceIncl(product));
        if (els.subtotal) els.subtotal.textContent = formatTRY(sub);
        if (els.vatAmount) els.vatAmount.textContent = formatTRY(vat);
        if (els.grandTotal) els.grandTotal.textContent = formatTRY(total);
        return { qty, sub, vat, total, lines };
      }
      const t = window.PatygoCart.totals(window.PatygoCatalog.byId || catalogById || {});
      lines = t.lines;
      if (els.qtyLabel) {
        els.qtyLabel.textContent = String(t.lines.reduce((n, l) => n + l.qty, 0));
      }
      if (els.unitPrice) els.unitPrice.textContent = "—";
      if (els.subtotal) els.subtotal.textContent = formatTRY(t.sub);
      if (els.vatAmount) els.vatAmount.textContent = formatTRY(t.vat);
      if (els.grandTotal) els.grandTotal.textContent = formatTRY(t.total);
      return {
        qty: t.lines.reduce((n, l) => n + l.qty, 0),
        sub: t.sub,
        vat: t.vat,
        total: t.total,
        lines: t.lines,
      };
    }
    calcFn = calc;

    if (!lines.length && mode === "cart") {
      if (els.name) {
        els.name.textContent = storedQty > 0 ? "Ürünler yükleniyor…" : "Sepetiniz boş";
      }
      if (els.note) {
        els.note.classList.add("err");
        els.note.textContent =
          storedQty > 0
            ? "Sepetinizde ürün var; katalog yükleniyor. Sayfa otomatik güncellenecek."
            : "Önce sepete ürün ekleyin veya ürün sayfasından Hemen Al seçin.";
      }
      if (els.payBtn) els.payBtn.disabled = true;
      // Katalog sonra gelirse yeniden dene
      return false;
    }

    if (mode === "direct") {
      els.brand.textContent = "";
      const primaryImage =
        (Array.isArray(product.images) && product.images.find(Boolean)) ||
        product.image ||
        "";
      if (primaryImage) {
        const img = document.createElement("img");
        img.src = primaryImage;
        img.alt = product.name || "";
        els.brand.appendChild(img);
        els.brand.classList.add("has-image");
      } else {
        els.brand.classList.remove("has-image");
        els.brand.textContent = (product.brand || "ÜRÜN").slice(0, 8);
      }
      els.brandLabel.textContent = product.brand || "—";
      els.name.textContent = product.name;
      if (els.qtyRow) els.qtyRow.hidden = false;
    } else {
      const first = lines[0] && lines[0].product;
      const cartImage =
        first &&
        ((Array.isArray(first.images) && first.images.find(Boolean)) || first.image || "");
      els.brand.textContent = "";
      if (cartImage) {
        const img = document.createElement("img");
        img.src = cartImage;
        img.alt = first.name || "Sepet";
        els.brand.appendChild(img);
        els.brand.classList.add("has-image");
      } else {
        els.brand.classList.remove("has-image");
        els.brand.textContent = "SEPET";
      }
      els.brandLabel.textContent = "SEPET";
      els.name.textContent = lines.map((l) => l.product.name + " × " + l.qty).join(", ");
      if (els.qtyRow) els.qtyRow.hidden = true;
      if (els.adet) els.adet.removeAttribute("required");
    }

    if (els.note) {
      els.note.classList.remove("err");
      if (!els.note.textContent.includes("Akbank")) els.note.textContent = "";
    }
    if (els.payBtn) {
      els.payBtn.disabled = !posStatus.enabled;
      els.payBtn.textContent = posStatus.enabled ? "Güvenli Ödemeye Geç" : "POS Yapılandırması Bekleniyor";
    }

    if (!els.orderIdPreview.textContent || els.orderIdPreview.textContent === "—") {
      els.orderIdPreview.textContent = makeOrderId();
    }
    calc();
    if (!booted && window.PatygoAnalytics) window.PatygoAnalytics.track("checkout_started");

    if (els.adet && mode === "direct" && !els.adet.dataset.bound) {
      els.adet.dataset.bound = "1";
      els.adet.addEventListener("input", () => calcFn && calcFn());
      els.adet.addEventListener("change", () => calcFn && calcFn());
    }

    if (els.form && !submitBound) {
      submitBound = true;
      els.form.addEventListener("submit", async (ev) => {
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
          !els.form.onayIade?.checked ||
          !els.form.onayKvkk?.checked
        ) {
          els.note.classList.remove("ok");
          els.note.classList.add("err");
          els.note.textContent =
            "Devam etmek için Ön Bilgilendirme, Mesafeli Satış, İade/Cayma ve KVKK onaylarını işaretleyin.";
          return;
        }
        const billingAddress = (els.form.faturaAdres && els.form.faturaAdres.value.trim()) || "";
        const shippingAddress =
          (els.form.teslimatAdres && els.form.teslimatAdres.value.trim()) || billingAddress;
        if (!billingAddress || !shippingAddress) {
          els.note.classList.remove("ok");
          els.note.classList.add("err");
          els.note.textContent = "Fatura ve teslimat adreslerini girin.";
          return;
        }

        const totals = calcFn ? calcFn() : { lines: [] };
        if (!totals.lines.length) {
          els.note.classList.add("err");
          els.note.textContent = "Sepet boş.";
          return;
        }

        if (!posStatus.enabled) {
          els.note.classList.add("err");
          els.note.textContent = "Sanal POS henüz aktif değil. Anahtarları .env dosyasına ekleyin.";
          return;
        }

        if (els.payBtn) {
          els.payBtn.disabled = true;
          els.payBtn.textContent = "Banka sayfasına yönlendiriliyor…";
        }
        els.note.classList.remove("err", "ok");
        els.note.textContent = "Akbank güvenli ödeme sayfası açılıyor…";

        try {
          const res = await fetch("/api/payment/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: totals.lines.map((l) => ({
                productId: l.product.id,
                qty: l.qty,
              })),
              customer: {
                name: ad,
                company: els.form.firma.value.trim(),
                email,
                phone: tel,
                taxId: (els.form.vergi && els.form.vergi.value.trim()) || "",
                note: "",
                billingAddress,
                shippingAddress,
              },
              contractsAccepted: true,
              kvkkAccepted: true,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || "Ödeme başlatılamadı.");
          }
          if (els.orderIdPreview) els.orderIdPreview.textContent = data.orderId;
          try {
            sessionStorage.setItem(PENDING_ORDER_KEY, data.orderId);
          } catch (_) {}
          postToBank(data.action, data.fields);
        } catch (err) {
          els.note.classList.add("err");
          els.note.textContent = err.message || "Ödeme başlatılamadı.";
          if (els.payBtn) {
            els.payBtn.disabled = false;
            els.payBtn.textContent = "Güvenli Ödemeye Geç";
          }
        }
      });
    }

    booted = true;
    return true;
  }

  function tryBoot() {
    boot(window.PatygoCatalog && window.PatygoCatalog.byId ? window.PatygoCatalog.byId : {});
  }

  async function start() {
    const handled = await hydratePaymentReturn();
    if (handled) return;

    // POS durumunu katalogdan bağımsız yükle
    loadPosStatus();

    // Sepet anlık görüntüsüyle hemen dene; katalog gelince yeniden dene
    tryBoot();
    if (window.PatygoCatalog && window.PatygoCatalog.ready) {
      window.PatygoCatalog.ready.then(tryBoot).catch(tryBoot);
    }
    window.addEventListener("patygo:catalog", tryBoot);
  }

  start();
})();
