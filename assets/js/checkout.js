(function () {
  const PENDING_ORDER_KEY = "patygo_pending_order";
  const PENDING_ORDER_TOKEN_KEY = "patygo_pending_order_token";
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
    unitPriceRow: document.getElementById("unitPriceRow"),
    qtyLabel: document.getElementById("qtyLabel"),
    subtotal: document.getElementById("subtotal"),
    vatAmount: document.getElementById("vatAmount"),
    shippingRow: document.getElementById("shippingRow"),
    shippingLabel: document.getElementById("shippingLabel"),
    shippingAmount: document.getElementById("shippingAmount"),
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
    installmentFieldset: document.getElementById("installmentFieldset"),
    installmentOptions: document.getElementById("installmentOptions"),
    installmentRow: document.getElementById("installmentRow"),
    installmentLabel: document.getElementById("installmentLabel"),
    installmentAmount: document.getElementById("installmentAmount"),
  };

  let selectedInstallCount = 1;

  let posStatus = { enabled: false, testMode: true, provider: "akbank" };

  function formatTRY(amount) {
    if (window.PatygoCatalog && typeof window.PatygoCatalog.formatPrice === "function") {
      return window.PatygoCatalog.formatPrice(amount);
    }
    const n = Number(amount);
    const value = Number.isFinite(n) ? n : 0;
    return (
      "₺" +
      value.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function updateShippingRow(totals) {
    const settings = window.PatygoShipping && window.PatygoShipping.settings;
    const hasLines = totals && Array.isArray(totals.lines) && totals.lines.length;
    const enabled = settings && settings.enabled && settings.shippingFee > 0 && hasLines;
    if (!els.shippingRow || !els.shippingAmount) return;
    let hintEl = document.getElementById("checkoutShippingHint");
    if (!hintEl && els.shippingRow.parentNode) {
      hintEl = document.createElement("p");
      hintEl.id = "checkoutShippingHint";
      hintEl.className = "shipping-hint";
      els.shippingRow.parentNode.insertBefore(hintEl, els.shippingRow.nextSibling);
    }
    if (!enabled) {
      els.shippingRow.hidden = true;
      if (hintEl) hintEl.hidden = true;
      return;
    }
    els.shippingRow.hidden = false;
    const shipping = totals.shipping || 0;
    const cartInfo =
      window.PatygoShipping && typeof window.PatygoShipping.cartShippingInfo === "function"
        ? window.PatygoShipping.cartShippingInfo(totals.merchandiseTotal)
        : null;
    if (shipping <= 0) {
      if (els.shippingLabel) els.shippingLabel.textContent = "Kargo";
      els.shippingAmount.textContent = "Ücretsiz";
    } else {
      if (els.shippingLabel) els.shippingLabel.textContent = "Kargo (KDV dahil)";
      els.shippingAmount.textContent = formatTRY(shipping);
    }
    if (hintEl) {
      const hintText = cartInfo && cartInfo.hint ? cartInfo.hint : "";
      hintEl.textContent = hintText;
      hintEl.hidden = !hintText;
    }
  }

  function installmentQuotes(baseTotal) {
    const api = window.PatygoInstallments;
    return api && typeof api.quote === "function" ? api.quote(baseTotal) : [];
  }

  function renderInstallmentOptions(quotes, baseTotal) {
    const box = els.installmentOptions;
    if (!box) return;
    const key = baseTotal + "|" + quotes.map((q) => q.count + ":" + q.total).join(",");
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = "";
    const rows = [{ count: 1, total: baseTotal, monthly: baseTotal }].concat(quotes);
    rows.forEach((row) => {
      const label = document.createElement("label");
      label.className = "installment-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "installCount";
      input.value = String(row.count);
      input.checked = row.count === selectedInstallCount;
      input.addEventListener("change", () => {
        selectedInstallCount = row.count;
        if (calcFn) calcFn();
      });
      const title = document.createElement("span");
      title.textContent = row.count === 1 ? "Tek çekim" : row.count + " taksit";
      const detail = document.createElement("small");
      detail.textContent =
        row.count === 1
          ? formatTRY(row.total)
          : "Aylık " + formatTRY(row.monthly) + " · Toplam " + formatTRY(row.total);
      label.appendChild(input);
      label.appendChild(title);
      label.appendChild(detail);
      box.appendChild(label);
    });
  }

  // Server recomputes the surcharge from admin rates; this only previews it.
  function applyInstallment(summary) {
    const baseTotal = summary.total;
    const quotes = summary.lines && summary.lines.length ? installmentQuotes(baseTotal) : [];
    const chosen = quotes.find((q) => q.count === selectedInstallCount) || null;
    if (!chosen) selectedInstallCount = 1;
    if (els.installmentFieldset) els.installmentFieldset.hidden = !quotes.length;
    if (quotes.length) renderInstallmentOptions(quotes, baseTotal);
    const surcharge = chosen ? Math.round((chosen.total - baseTotal) * 100) / 100 : 0;
    if (els.installmentRow) els.installmentRow.hidden = !chosen;
    if (chosen) {
      if (els.installmentLabel) {
        els.installmentLabel.textContent =
          "Vade farkı (" + chosen.count + " taksit, %" + String(chosen.ratePercent).replace(".", ",") + ")";
      }
      if (els.installmentAmount) els.installmentAmount.textContent = formatTRY(surcharge);
    }
    summary.baseTotal = baseTotal;
    summary.installCount = chosen ? chosen.count : 1;
    summary.total = chosen ? chosen.total : baseTotal;
    if (els.grandTotal) els.grandTotal.textContent = formatTRY(summary.total);
    return summary;
  }

  function updateMinimumHint(totals) {
    const hasLines = totals && Array.isArray(totals.lines) && totals.lines.length;
    const info =
      hasLines &&
      window.PatygoShipping &&
      typeof window.PatygoShipping.minimumOrderInfo === "function"
        ? window.PatygoShipping.minimumOrderInfo(totals.merchandiseTotal)
        : null;
    let hint = document.getElementById("checkoutMinimumHint");
    if (!hint && els.payBtn && els.payBtn.parentNode) {
      hint = document.createElement("p");
      hint.id = "checkoutMinimumHint";
      hint.className = "minimum-order-hint";
      hint.setAttribute("role", "status");
      els.payBtn.parentNode.insertBefore(hint, els.payBtn);
    }
    const message = info && !info.met ? info.message : "";
    if (hint) {
      hint.textContent = message;
      hint.hidden = !message;
    }
    return message;
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function fieldError(input, message) {
    if (!input) return;
    const box = document.getElementById(input.id + "-error");
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    if (box) {
      box.textContent = message || "";
      box.hidden = !message;
    }
  }

  function invoiceType() {
    const picked = els.form && els.form.querySelector('input[name="customerType"]:checked');
    return picked && picked.value === "kurumsal" ? "kurumsal" : "bireysel";
  }

  function sameAddressChecked() {
    const same = document.getElementById("sameAddress");
    return !same || same.checked;
  }

  function readAddress(prefix) {
    const f = els.form.elements;
    return {
      line: f[prefix + "Adres"].value.trim(),
      district: f[prefix + "Ilce"].value.trim(),
      city: f[prefix + "Il"].value,
      postalCode: f[prefix + "Posta"].value.trim(),
    };
  }

  /** Each rule returns "" when valid; rules mirror the /api/payment/start checks. */
  function fieldRules() {
    const identity = window.PatygoCustomerIdentity || {};
    const fromCheck = (check) => (check && !check.ok ? check.error : "");
    const required = (message) => (input) => (String(input.value || "").trim() ? "" : message);
    const minLength = (n, message) => (input) => (String(input.value || "").trim().length >= n ? "" : message);
    const rules = {
      ad: (input) =>
        identity.validateCustomerName
          ? fromCheck(identity.validateCustomerName(input.value))
          : required("Ad soyad gerekli.")(input),
      email: (input) => {
        const value = input.value.trim();
        if (!value) return "E-posta gerekli.";
        return isValidEmail(value) ? "" : "Geçerli bir e-posta adresi girin.";
      },
      tel: (input) =>
        identity.validateCustomerPhone
          ? fromCheck(identity.validateCustomerPhone(input.value))
          : required("Cep telefonu gerekli.")(input),
      tckn: (input) => (identity.validateTckn ? fromCheck(identity.validateTckn(input.value)) : ""),
      firma: minLength(2, "Firma ünvanı gerekli."),
      vergiDairesi: minLength(2, "Vergi dairesi gerekli."),
      vkn: (input) =>
        identity.validateTaxNumber
          ? fromCheck(identity.validateTaxNumber(input.value))
          : required("Vergi numarası gerekli.")(input),
    };
    ["fatura", "teslimat"].forEach((prefix) => {
      rules[prefix + "Il"] = required("İl seçin.");
      rules[prefix + "Ilce"] = required("İlçe gerekli.");
      rules[prefix + "Adres"] = minLength(10, "Açık adresi yazın (mahalle, sokak, bina no).");
      rules[prefix + "Posta"] = (input) =>
        identity.validatePostalCode ? fromCheck(identity.validatePostalCode(input.value)) : "";
    });
    return rules;
  }

  function activeFieldNames() {
    const names = ["ad", "email", "tel"];
    if (invoiceType() === "kurumsal") names.push("firma", "vergiDairesi", "vkn");
    else names.push("tckn");
    names.push("faturaIl", "faturaIlce", "faturaAdres", "faturaPosta");
    if (!sameAddressChecked()) names.push("teslimatIl", "teslimatIlce", "teslimatAdres", "teslimatPosta");
    return names;
  }

  function validateField(name, rules) {
    const input = els.form && els.form.elements[name];
    if (!input || !rules[name]) return "";
    const message = rules[name](input);
    fieldError(input, message);
    return message;
  }

  function syncInvoiceType() {
    const type = invoiceType();
    els.form.querySelectorAll("[data-invoice]").forEach((block) => {
      const on = block.getAttribute("data-invoice") === type;
      block.hidden = !on;
      if (!on) block.querySelectorAll("input").forEach((input) => fieldError(input, ""));
    });
  }

  function syncShippingGroup() {
    const group = document.getElementById("shippingAddressGroup");
    if (!group) return;
    const same = sameAddressChecked();
    group.hidden = same;
    if (same) group.querySelectorAll("input, select, textarea").forEach((input) => fieldError(input, ""));
  }

  /** Errors appear when a field is left (not while typing) and clear as soon as the value becomes valid. */
  function bindLiveValidation(rules) {
    Object.keys(rules).forEach((name) => {
      const input = els.form.elements[name];
      if (!input) return;
      const leaveEvent = input.tagName === "SELECT" ? "change" : "blur";
      input.addEventListener(leaveEvent, () => {
        const identity = window.PatygoCustomerIdentity;
        if (name === "tel" && identity && identity.formatTrMobilePhone) {
          input.value = identity.formatTrMobilePhone(input.value);
        }
        if (!String(input.value || "").trim() && input.getAttribute("aria-invalid") !== "true") return;
        validateField(name, rules);
      });
      input.addEventListener("input", () => {
        if (input.getAttribute("aria-invalid") === "true") validateField(name, rules);
      });
    });
    els.form
      .querySelectorAll('input[name="customerType"]')
      .forEach((radio) => radio.addEventListener("change", syncInvoiceType));
    const same = document.getElementById("sameAddress");
    if (same) same.addEventListener("change", syncShippingGroup);
    syncInvoiceType();
    syncShippingGroup();
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
      sessionStorage.removeItem(PENDING_ORDER_TOKEN_KEY);
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
    let token = "";
    try {
      token = sessionStorage.getItem(PENDING_ORDER_TOKEN_KEY) || "";
    } catch (_) {}
    const qs = new URLSearchParams({ orderId });
    if (token) qs.set("token", token);
    const res = await fetch("/api/payment/order?" + qs.toString());
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
        const merchandiseTotal = Math.round((sub + vat) * 100) / 100;
        const shipping =
          window.PatygoShipping && typeof window.PatygoShipping.feeForMerchandise === "function"
            ? window.PatygoShipping.feeForMerchandise(merchandiseTotal)
            : 0;
        const total = Math.round((merchandiseTotal + shipping) * 100) / 100;
        lines = [{ product, qty, line: sub, lineVat: vat, lineIncl: merchandiseTotal }];
        if (els.qtyLabel) els.qtyLabel.textContent = String(qty);
        if (els.unitPrice) els.unitPrice.textContent = formatTRY(priceIncl(product));
        if (els.unitPriceRow) els.unitPriceRow.hidden = false;
        if (els.subtotal) els.subtotal.textContent = formatTRY(sub);
        if (els.vatAmount) els.vatAmount.textContent = formatTRY(vat);
        if (els.grandTotal) els.grandTotal.textContent = formatTRY(total);
        const summary = { qty, sub, vat, merchandiseTotal, shipping, total, lines };
        updateShippingRow(summary);
        summary.minimumError = updateMinimumHint(summary);
        return applyInstallment(summary);
      }
      const t = window.PatygoCart.totals(window.PatygoCatalog.byId || catalogById || {});
      lines = t.lines;
      if (els.qtyLabel) {
        els.qtyLabel.textContent = String(t.lines.reduce((n, l) => n + l.qty, 0));
      }
      // Farklı ürünlerden oluşan sepette tek bir birim fiyat yoktur; satır gizlenir.
      const singleProduct = t.lines.length === 1 ? t.lines[0].product : null;
      if (els.unitPrice) els.unitPrice.textContent = singleProduct ? formatTRY(priceIncl(singleProduct)) : "";
      if (els.unitPriceRow) els.unitPriceRow.hidden = !singleProduct;
      if (els.subtotal) els.subtotal.textContent = formatTRY(t.sub);
      if (els.vatAmount) els.vatAmount.textContent = formatTRY(t.vat);
      if (els.grandTotal) els.grandTotal.textContent = formatTRY(t.total);
      updateShippingRow(t);
      return applyInstallment({
        qty: t.lines.reduce((n, l) => n + l.qty, 0),
        sub: t.sub,
        vat: t.vat,
        merchandiseTotal: t.merchandiseTotal,
        shipping: t.shipping,
        total: t.total,
        lines: t.lines,
        minimumError: updateMinimumHint(t),
      });
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
        product.thumb ||
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
        (first.thumb || (Array.isArray(first.images) && first.images.find(Boolean)) || first.image || "");
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

    calc();
    if (!booted && window.PatygoAnalytics) window.PatygoAnalytics.track("checkout_started");

    if (els.adet && mode === "direct" && !els.adet.dataset.bound) {
      els.adet.dataset.bound = "1";
      els.adet.addEventListener("input", () => calcFn && calcFn());
      els.adet.addEventListener("change", () => calcFn && calcFn());
    }

    if (els.form && !submitBound) {
      submitBound = true;
      const rules = fieldRules();
      bindLiveValidation(rules);
      const fail = (message) => {
        els.note.classList.remove("ok");
        els.note.classList.add("err");
        els.note.textContent = message;
      };
      els.form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        let firstInvalid = null;
        activeFieldNames().forEach((name) => {
          if (validateField(name, rules) && !firstInvalid) firstInvalid = els.form.elements[name];
        });
        if (firstInvalid) {
          fail("Lütfen işaretli alanları düzeltin.");
          firstInvalid.focus();
          return;
        }
        if (!els.form.onaySozlesmeler?.checked) {
          fail("Devam etmek için sözleşmeleri okuduğunuzu ve kabul ettiğinizi onaylayın.");
          return;
        }
        const f = els.form.elements;
        const ad = f.ad.value.trim();
        const email = f.email.value.trim();
        const tel = f.tel.value.trim();
        const type = invoiceType();
        const billing = readAddress("fatura");
        const shipping = sameAddressChecked() ? null : readAddress("teslimat");

        const totals = calcFn ? calcFn() : { lines: [] };
        if (!totals.lines.length) {
          els.note.classList.add("err");
          els.note.textContent = "Sepet boş.";
          return;
        }
        if (totals.minimumError) {
          els.note.classList.remove("ok");
          els.note.classList.add("err");
          els.note.textContent = totals.minimumError;
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
                email,
                phone: tel,
                customerType: type,
                company: type === "kurumsal" ? f.firma.value.trim() : "",
                taxOffice: type === "kurumsal" ? f.vergiDairesi.value.trim() : "",
                taxId: (type === "kurumsal" ? f.vkn.value : f.tckn.value).replace(/\D/g, ""),
                note: "",
                billing: billing,
                shipping: shipping || undefined,
              },
              contractsAccepted: true,
              kvkkAccepted: true,
              installCount: totals.installCount || 1,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || "Ödeme başlatılamadı.");
          }
          if (els.orderIdPreview) {
            els.orderIdPreview.textContent = data.orderId;
            const row = document.getElementById("orderIdRow");
            if (row) row.hidden = false;
          }
          try {
            sessionStorage.setItem(PENDING_ORDER_KEY, data.orderId);
            if (data.orderAccessToken) {
              sessionStorage.setItem(PENDING_ORDER_TOKEN_KEY, data.orderAccessToken);
            }
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
    if (window.PatygoShipping) {
      try {
        await window.PatygoShipping.load();
      } catch (_) {}
    }
    if (window.PatygoInstallments) {
      window.PatygoInstallments.load().then(() => calcFn && calcFn()).catch(() => {});
    }

    // Sepet anlık görüntüsüyle hemen dene; katalog gelince yeniden dene
    tryBoot();
    if (window.PatygoCatalog && window.PatygoCatalog.ready) {
      window.PatygoCatalog.ready.then(tryBoot).catch(tryBoot);
    }
    window.addEventListener("patygo:catalog", tryBoot);
  }

  start();
})();
