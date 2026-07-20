(function () {
  const VAT_RATE = (window.PatygoCart && window.PatygoCart.VAT) || 0.2;
  const params = new URLSearchParams(window.location.search);
  const directId = params.get("id") || "";
  const paymentResult = params.get("payment") || "";
  const returnedOrderId = params.get("orderId") || "";

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
    if (els.root) els.root.hidden = true;
    if (els.success) els.success.hidden = false;
    const paid = kind === "success";
    if (els.successTitle) {
      els.successTitle.textContent = paid ? "Ödemeniz alındı" : "Ödeme tamamlanamadı";
    }
    if (els.successLead) {
      els.successLead.textContent = paid
        ? "Akbank güvenli ödeme ekranından işleminiz onaylandı. Siparişiniz işleme alındı."
        : "Kart işlemi tamamlanmadı veya banka reddetti. Dilerseniz tekrar deneyebilirsiniz.";
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
          ? "Ödeme başarıyla alındı."
          : "Sipariş için ödeme alınmadı.";
      }
    }
    if (paid && window.PatygoAnalytics) window.PatygoAnalytics.track("order_submitted");
    if (paid && window.PatygoCart) window.PatygoCart.clear();
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
          "Sanal POS anahtarları henüz tanımlı değil. .env dosyasına AKBANK_* değerlerini ekleyin.";
      }
    }
    if (els.payBtn) {
      els.payBtn.textContent = posStatus.enabled ? "Güvenli Ödemeye Geç" : "POS Yapılandırması Bekleniyor";
      els.payBtn.disabled = !posStatus.enabled;
    }
  }

  async function hydratePaymentReturn() {
    if (!paymentResult) return false;
    let order = null;
    if (returnedOrderId) {
      try {
        const res = await fetch("/api/payment/order?orderId=" + encodeURIComponent(returnedOrderId));
        if (res.ok) {
          const data = await res.json();
          order = data.order;
        }
      } catch (_) {}
    }
    showResult(paymentResult === "success" ? "success" : "failed", order);
    return true;
  }

  let booted = false;
  let submitBound = false;
  let calcFn = null;

  function boot(catalogById) {
    let mode = "cart";
    let lines = [];
    let product = null;
    const cartCount = window.PatygoCart ? window.PatygoCart.count() : 0;

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
        els.name.textContent = cartCount > 0 ? "Ürünler yükleniyor…" : "Sepetiniz boş";
      }
      if (els.note) {
        els.note.classList.add("err");
        els.note.textContent =
          cartCount > 0
            ? "Sepetinizde ürün var; katalog yükleniyor. Sayfa otomatik güncellenecek."
            : "Önce sepete ürün ekleyin veya ürün sayfasından Hemen Al seçin.";
      }
      if (els.payBtn) els.payBtn.disabled = true;
      // Katalog sonra gelirse yeniden dene
      return false;
    }

    if (mode === "direct") {
      els.brand.textContent = (product.brand || "ÜRÜN").slice(0, 8);
      els.brandLabel.textContent = product.brand || "—";
      els.name.textContent = product.name;
      if (els.qtyRow) els.qtyRow.hidden = false;
    } else {
      els.brand.textContent = "SEPET";
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
          !els.form.onayIade?.checked
        ) {
          els.note.classList.remove("ok");
          els.note.classList.add("err");
          els.note.textContent =
            "Devam etmek için Ön Bilgilendirme, Mesafeli Satış Sözleşmesi ve İade/Cayma koşullarını onaylayın.";
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
                note: (els.form.not && els.form.not.value.trim()) || "",
              },
              contractsAccepted: true,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || "Ödeme başlatılamadı.");
          }
          if (els.orderIdPreview) els.orderIdPreview.textContent = data.orderId;
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
