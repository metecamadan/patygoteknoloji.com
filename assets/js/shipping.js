(function () {
  "use strict";

  let cached = null;
  let loading = null;

  function normalize(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    return {
      freeShippingThreshold: Math.max(0, Number(s.freeShippingThreshold) || 0),
      shippingFee: Math.max(0, Number(s.shippingFee) || 0),
      enabled: Boolean(s.enabled) || Number(s.shippingFee) > 0,
    };
  }

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function feeForMerchandise(merchandiseInclVat, settings) {
    const cfg = normalize(settings || cached || {});
    if (!cfg.enabled || cfg.shippingFee <= 0) return 0;
    const merch = round2(merchandiseInclVat);
    if (cfg.freeShippingThreshold > 0 && merch >= cfg.freeShippingThreshold) return 0;
    return cfg.shippingFee;
  }

  function load() {
    if (cached) return Promise.resolve(cached);
    if (loading) return loading;
    loading = fetch("/api/shipping", { cache: "default" })
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
    normalize,
  };
})();
