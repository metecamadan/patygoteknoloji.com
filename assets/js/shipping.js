(function () {
  "use strict";

  let cached = null;
  let loading = null;
  let loadingStartedAt = 0;
  const LOADING_MAX_MS = 6000;

  function normalize(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    return {
      freeShippingThreshold: Math.max(0, Number(s.freeShippingThreshold) || 0),
      shippingFee: Math.max(0, Number(s.shippingFee) || 0),
      minOrderAmount: Math.max(0, Number(s.minOrderAmount) || 0),
      enabled: Boolean(s.enabled) || Number(s.shippingFee) > 0,
    };
  }

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function formatMoney(n) {
    if (window.PatygoCatalog && typeof window.PatygoCatalog.formatPrice === "function") {
      return window.PatygoCatalog.formatPrice(n);
    }
    return (
      "₺" +
      round2(n).toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function feeForMerchandise(merchandiseInclVat, settings) {
    const cfg = normalize(settings || cached || {});
    if (!cfg.enabled || cfg.shippingFee <= 0) return 0;
    const merch = round2(merchandiseInclVat);
    if (cfg.freeShippingThreshold > 0 && merch >= cfg.freeShippingThreshold) return 0;
    return cfg.shippingFee;
  }

  /** Tek ürün KDV dahil fiyatına göre (Akakçe ile aynı kural). */
  function productShippingInfo(grossInclVat, settings) {
    const cfg = normalize(settings || cached || {});
    if (!cfg.enabled || cfg.shippingFee <= 0) return null;
    const gross = round2(grossInclVat);
    const appliedFee = feeForMerchandise(gross, cfg);
    const free = appliedFee <= 0;
    const thresholdHint =
      cfg.freeShippingThreshold > 0
        ? formatMoney(cfg.freeShippingThreshold) + " ve üzeri ücretsiz kargo"
        : null;
    return {
      free,
      fee: cfg.shippingFee,
      text: free ? "Ücretsiz kargo" : "Kargo: " + formatMoney(cfg.shippingFee),
      thresholdHint,
    };
  }

  /** Sepet KDV dahil tutarına göre. */
  function cartShippingInfo(merchandiseTotal, settings) {
    const cfg = normalize(settings || cached || {});
    if (!cfg.enabled || cfg.shippingFee <= 0) return null;
    const merch = round2(merchandiseTotal);
    const appliedFee = feeForMerchandise(merch, cfg);
    const free = appliedFee <= 0;
    let hint = null;
    if (!free && cfg.freeShippingThreshold > 0) {
      const remaining = round2(cfg.freeShippingThreshold - merch);
      if (remaining > 0) {
        hint = formatMoney(remaining) + " daha ekleyin, kargo ücretsiz";
      }
    } else if (free && cfg.freeShippingThreshold > 0) {
      hint = formatMoney(cfg.freeShippingThreshold) + " üzeri ücretsiz kargo";
    }
    return {
      free,
      fee: appliedFee,
      hint,
      threshold: cfg.freeShippingThreshold,
    };
  }

  /** Kargo hariç, KDV dahil ürün tutarı; sunucu aynı kuralla siparişi reddeder. */
  function minimumOrderInfo(merchandiseTotal, settings) {
    const cfg = normalize(settings || cached || {});
    if (cfg.minOrderAmount <= 0) return null;
    const shortfall = Math.max(0, round2(cfg.minOrderAmount - round2(merchandiseTotal)));
    return {
      met: shortfall <= 0,
      minimum: cfg.minOrderAmount,
      shortfall,
      message:
        shortfall > 0
          ? "Minimum sepet tutarı " +
            formatMoney(cfg.minOrderAmount) +
            " (KDV dahil, kargo hariç). Ödemeye geçmek için " +
            formatMoney(shortfall) +
            " daha ürün ekleyin."
          : "",
    };
  }

  /** Listing cards show the free-shipping threshold instead of repeating the flat fee on every card. */
  function createProductShippingEl(grossInclVat, options) {
    const info = productShippingInfo(grossInclVat);
    if (!info) return null;
    const el = document.createElement("p");
    el.className = "product-shipping" + (info.free ? " product-shipping--free" : "");
    el.textContent =
      options && options.card && !info.free && info.thresholdHint ? info.thresholdHint : info.text;
    return el;
  }

  function shippingFetchSignal() {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(5000);
    }
    const controller = new AbortController();
    setTimeout(function () {
      controller.abort();
    }, 5000);
    return controller.signal;
  }

  function load() {
    if (cached) return Promise.resolve(cached);
    if (loading && Date.now() - loadingStartedAt < LOADING_MAX_MS) return loading;
    loading = null;
    loadingStartedAt = Date.now();
    loading = fetch("/api/shipping", {
      cache: "default",
      signal: shippingFetchSignal(),
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then((body) => {
        cached = normalize(body);
        return cached;
      })
      .catch(() => {
        cached = normalize({});
        return cached;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  window.PatygoShipping = {
    load,
    get settings() {
      return cached ? Object.assign({}, cached) : null;
    },
    feeForMerchandise,
    productShippingInfo,
    cartShippingInfo,
    minimumOrderInfo,
    createProductShippingEl,
    formatMoney,
    normalize,
  };
})();
