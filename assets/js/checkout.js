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
    couponInput: document.getElementById("couponInput"),
    couponApplyBtn: document.getElementById("couponApplyBtn"),
    couponNote: document.getElementById("couponNote"),
    couponRow: document.getElementById("couponRow"),
    couponLabel: document.getElementById("couponLabel"),
    couponAmount: document.getElementById("couponAmount"),
  };

  let selectedInstallCount = 1;
  let appliedCoupon = null;

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

  function setCouponNote(kind, text) {
    if (!els.couponNote) return;
    els.couponNote.classList.remove("ok", "err");
    if (kind) els.couponNote.classList.add(kind);
    els.couponNote.textContent = text || "";
    els.couponNote.hidden = !text;
  }

  // Mirrors lib/coupons.js evaluateCoupon; the server recomputes it at payment start.
  function couponDiscountFor(merchandiseTotal) {
    if (!appliedCoupon) return { discount: 0, error: "" };
    const merch = Math.round((Number(merchandiseTotal) || 0) * 100) / 100;
    if (appliedCoupon.minOrder > 0 && merch < appliedCoupon.minOrder) {
      return {
        discount: 0,
        error: "Bu kupon " + formatTRY(appliedCoupon.minOrder) + " ve üzeri ürün toplamında geçerlidir.",
      };
    }
    let discount =
      appliedCoupon.type === "amount"
        ? appliedCoupon.value
        : Math.round(merch * appliedCoupon.value) / 100;
    if (appliedCoupon.type === "percent" && appliedCoupon.maxDiscount > 0) {
      discount = Math.min(discount, appliedCoupon.maxDiscount);
    }
    discount = Math.round(Math.min(discount, Math.max(0, merch - 1)) * 100) / 100;
    return { discount: discount > 0 ? discount : 0, error: "" };
  }

  function applyCoupon(summary) {
    const result = couponDiscountFor(summary.merchandiseTotal);
    const discount = summary.lines && summary.lines.length ? result.discount : 0;
    if (els.couponRow) els.couponRow.hidden = !(discount > 0);
    if (discount > 0) {
      if (els.couponLabel) els.couponLabel.textContent = "Kupon (" + appliedCoupon.code + ")";
      if (els.couponAmount) els.couponAmount.textContent = "-" + formatTRY(discount);
    }
    if (appliedCoupon) {
      setCouponNote(
        result.error ? "err" : "ok",
        result.error || appliedCoupon.code + " uygulandı: " + formatTRY(discount) + " indirim."
      );
    }
    summary.couponDiscount = discount;
    summary.couponCode = discount > 0 ? appliedCoupon.code : "";
    summary.total = Math.round((summary.total - discount) * 100) / 100;
    return summary;
  }

  function syncCouponButton() {
    if (els.couponApplyBtn) els.couponApplyBtn.textContent = appliedCoupon ? "Kaldır" : "Uygula";
    if (els.couponInput) els.couponInput.readOnly = Boolean(appliedCoupon);
  }

  async function submitCoupon(lines) {
    if (appliedCoupon) {
      appliedCoupon = null;
      setCouponNote("", "");
      if (els.couponInput) els.couponInput.value = "";
      syncCouponButton();
      if (calcFn) calcFn();
      return;
    }
    const code = els.couponInput ? els.couponInput.value.trim() : "";
    if (!code) {
      setCouponNote("err", "Kupon kodunu yazın.");
      return;
    }
    const items = (lines() || []).map((l) => ({ productId: l.product.id, qty: l.qty }));
    if (!items.length) {
      setCouponNote("err", "Sepetiniz boş.");
      return;
    }
    if (els.couponApplyBtn) els.couponApplyBtn.disabled = true;
    try {
      const res = await fetch("/api/coupons/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Kupon uygulanamadı.");
      appliedCoupon = {
        code: data.code,
        type: data.type === "amount" ? "amount" : "percent",
        value: Number(data.value) || 0,
        maxDiscount: Number(data.maxDiscount) || 0,
        minOrder: Number(data.minOrder) || 0,
      };
      if (els.couponInput) els.couponInput.value = data.code;
      syncCouponButton();
      if (calcFn) calcFn();
    } catch (err) {
      setCouponNote("err", err.message || "Kupon uygulanamadı.");
    } finally {
      if (els.couponApplyBtn) els.couponApplyBtn.disabled = false;
    }
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
      rules[prefix + "Ilce"] = required("İlçe seçin.");
      rules[prefix + "Adres"] = minLength(10, "Açık adresi yazın (mahalle, sokak, bina no).");
    });
    return rules;
  }

  function activeFieldNames() {
    const names = ["ad", "email", "tel"];
    if (invoiceType() === "kurumsal") names.push("firma", "vergiDairesi", "vkn");
    else names.push("tckn");
    names.push("faturaIl", "faturaIlce", "faturaAdres");
    if (!sameAddressChecked()) names.push("teslimatIl", "teslimatIlce", "teslimatAdres");
    return names;
  }

  function validateField(name, rules) {
    const input = els.form && els.form.elements[name];
    if (!input || !rules[name]) return "";
    const message = rules[name](input);
    fieldError(input, message);
    return message;
  }

  const DISTRICTS_URL = "/assets/geo/tr-districts.json?v=ilce-1";
  let districtsPromise = null;

  function loadDistricts() {
    if (!districtsPromise) {
      districtsPromise = fetch(DISTRICTS_URL)
        .then((res) => {
          if (!res.ok) throw new Error("districts " + res.status);
          return res.json();
        })
        .catch(() => {
          districtsPromise = null;
          return null;
        });
    }
    return districtsPromise;
  }

  function fillDistrictSelect(select, names, placeholder) {
    select.textContent = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);
    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.disabled = !names.length;
  }

  /** İlçe <select>s list only the districts of the chosen il (assets/geo/tr-districts.json, same file the server validates against). */
  function bindDistrictSelects() {
    if (!els.form) return;
    els.form.querySelectorAll("select[data-district-for]").forEach((select) => {
      const province = els.form.elements[select.dataset.districtFor];
      if (!province || select.dataset.bound) return;
      select.dataset.bound = "1";
      const sync = async () => {
        const city = province.value;
        fieldError(select, "");
        if (!city) {
          fillDistrictSelect(select, [], "Önce il seçin");
          return;
        }
        fillDistrictSelect(select, [], "İlçeler yükleniyor…");
        const all = await loadDistricts();
        if (province.value !== city) return;
        const names = (all && all[city]) || [];
        if (!names.length) {
          fillDistrictSelect(select, [], "İlçeler yüklenemedi");
          fieldError(select, "İlçe listesi yüklenemedi; ili yeniden seçin veya sayfayı yenileyin.");
          return;
        }
        fillDistrictSelect(select, names, "Seçin");
      };
      province.addEventListener("change", sync);
      sync();
    });
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

  /** Funnel + hero reflect the outcome: every step done after payment, step 3 flagged when it failed. */
  function markFunnelOutcome(paid) {
    const steps = document.querySelectorAll("#checkoutFunnel li");
    steps.forEach((li, index) => {
      const last = index === steps.length - 1;
      li.classList.toggle("is-done", paid || !last);
      li.classList.toggle("is-current", !paid && last);
      li.classList.toggle("is-error", !paid && last);
      if (!paid && last) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
      const badge = li.querySelector("span");
      if (badge) badge.textContent = paid || !last ? "✓" : "!";
    });
    const title = document.getElementById("checkoutHeroTitle");
    const lead = document.getElementById("checkoutHeroLead");
    if (title) title.textContent = paid ? "Siparişiniz tamamlandı" : "Ödeme tamamlanamadı";
    if (lead) {
      lead.textContent = paid
        ? "Teşekkür ederiz. Siparişinizi hazırlamaya başlıyoruz."
        : "Kartınızdan çekim yapılmadı. Bilgileriniz duruyor; ödemeyi tekrar deneyebilirsiniz.";
    }
  }

  function appendRow(list, tag, label, value, className) {
    const row = document.createElement(tag === "dl" ? "div" : "li");
    if (className) row.className = className;
    const a = document.createElement(tag === "dl" ? "dt" : "span");
    a.textContent = label;
    const b = document.createElement(tag === "dl" ? "dd" : "span");
    b.textContent = value;
    row.append(a, b);
    list.appendChild(row);
  }

  function renderOrderSummary(order) {
    const box = document.getElementById("successSummaryBox");
    const itemsEl = document.getElementById("successItems");
    const totalsEl = document.getElementById("successTotals");
    if (!box || !itemsEl || !totalsEl || !order || !Array.isArray(order.items) || !order.items.length) return false;
    itemsEl.textContent = "";
    totalsEl.textContent = "";
    order.items.forEach((item) => {
      const qty = Math.max(1, Number(item.qty) || 1);
      const lineIncl = (Number(item.line) || 0) + (Number(item.lineVat) || 0);
      appendRow(itemsEl, "ul", (item.name || "Ürün") + " × " + qty, formatTRY(lineIncl));
    });
    const coupon = order.coupon && Number(order.coupon.discount) > 0 ? order.coupon : null;
    const inst = order.installment && Number(order.installment.count) > 1 ? order.installment : null;
    const shipping = Number(order.shippingFee) || 0;
    appendRow(totalsEl, "dl", "Ürünler (KDV dahil)", formatTRY(order.merchandiseTotal));
    if (coupon) appendRow(totalsEl, "dl", "Kupon (" + coupon.code + ")", "-" + formatTRY(coupon.discount), "is-discount");
    appendRow(totalsEl, "dl", "Kargo", shipping > 0 ? formatTRY(shipping) : "Ücretsiz");
    if (inst) appendRow(totalsEl, "dl", "Vade farkı (" + inst.count + " taksit)", formatTRY(inst.surcharge));
    appendRow(totalsEl, "dl", "Ödenen tutar", formatTRY(order.total), "is-total");
    appendRow(totalsEl, "dl", "Ödeme", inst ? inst.count + " taksit · Akbank" : "Tek çekim · Akbank");
    box.hidden = false;
    return true;
  }

  function renderNextSteps(order) {
    const list = document.getElementById("successNext");
    if (!list || !order) return;
    list.textContent = "";
    const add = (label, value) => appendRow(list, "ul", label, value);
    const shipping = window.PatygoShipping;
    const dispatch = () => {
      if (shipping && typeof shipping.estimateDispatchDate === "function") {
        const at = Date.parse(order.createdAt || "") || Date.now();
        add("Tahmini kargoya veriliş", shipping.formatDispatchDate(shipping.estimateDispatchDate(at)));
      }
      if (order.deliveryArea) add("Teslimat", order.deliveryArea);
      if (order.mailEnabled) add("Bilgilendirme", "Sipariş onayı ve kargo takip bilgisi e-postanıza gönderilir.");
      list.hidden = !list.children.length;
    };
    if (shipping && typeof shipping.load === "function") shipping.load().then(dispatch, dispatch);
    else dispatch();
  }

  function bindCopyOrderId() {
    const btn = document.getElementById("successCopyBtn");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const id = els.successOrderId ? els.successOrderId.textContent.trim() : "";
      if (!id || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(id);
        btn.textContent = "Kopyalandı";
        setTimeout(() => (btn.textContent = "Kopyala"), 2000);
      } catch (_) {}
    });
  }

  function showResult(kind, order) {
    if (els.root) {
      els.root.hidden = true;
      els.root.style.display = "none";
    }
    const paid = kind === "success";
    if (els.success) {
      els.success.hidden = false;
      els.success.style.display = "block";
      els.success.classList.toggle("is-paid", paid);
      els.success.classList.toggle("is-failed", !paid);
    }
    markFunnelOutcome(paid);
    if (els.successTitle) {
      els.successTitle.textContent = paid ? "Siparişiniz alındı" : "Ödeme tamamlanamadı";
    }
    if (els.successLead) {
      if (paid) {
        els.successLead.textContent = "Ödemeniz Akbank güvenli ödeme ekranında onaylandı.";
      } else {
        const bankMsg =
          order &&
          order.bankResponse &&
          (order.bankResponse.responseMessage || order.bankResponse.responseCode);
        els.successLead.textContent = bankMsg
          ? "Banka cevabı: " + bankMsg + ". Kartınızdan çekim yapılmadı."
          : "Kart işlemi tamamlanmadı veya banka reddetti. Kartınızdan çekim yapılmadı.";
      }
    }
    if (els.successOrderId) els.successOrderId.textContent = (order && order.id) || returnedOrderId || "—";
    bindCopyOrderId();
    const hasSummary = paid && renderOrderSummary(order);
    if (paid) renderNextSteps(order);
    if (els.successSummary) {
      els.successSummary.hidden = hasSummary;
      els.successSummary.textContent = paid
        ? "Ödeme başarıyla alındı. Sipariş numaranızı saklayın; destek için kullanılır."
        : "Bu sipariş için ödeme alınmadı. Sepetiniz duruyor; dilerseniz tekrar deneyebilirsiniz.";
    }
    const retry = document.getElementById("retryPayBtn");
    if (retry) retry.hidden = paid;
    const continueBtn = document.getElementById("continueShoppingBtn");
    if (continueBtn) continueBtn.className = paid ? "btn btn-primary" : "btn btn-outline";
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
        return applyInstallment(applyCoupon(summary));
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
      return applyInstallment(
        applyCoupon({
          qty: t.lines.reduce((n, l) => n + l.qty, 0),
          sub: t.sub,
          vat: t.vat,
          merchandiseTotal: t.merchandiseTotal,
          shipping: t.shipping,
          total: t.total,
          lines: t.lines,
          minimumError: updateMinimumHint(t),
        })
      );
    }
    calcFn = calc;

    if (els.couponApplyBtn && !els.couponApplyBtn.dataset.bound) {
      els.couponApplyBtn.dataset.bound = "1";
      const currentLines = () => (calcFn ? calcFn().lines : []);
      els.couponApplyBtn.addEventListener("click", () => submitCoupon(currentLines));
      if (els.couponInput) {
        els.couponInput.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          if (!appliedCoupon) submitCoupon(currentLines);
        });
      }
    }

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
              couponCode: totals.couponCode || undefined,
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
    bindDistrictSelects();
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
