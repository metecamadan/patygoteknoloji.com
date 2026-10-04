(function () {
  // Mirrors lib/installment-settings.js quoteInstallments; the server recomputes the charged total.
  const state = { settings: { enabled: false, minAmount: 0, options: [] }, promise: null };

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function load() {
    if (state.promise) return state.promise;
    state.promise = fetch("/api/installments", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.enabled && data.posReady !== false && Array.isArray(data.options)) {
          state.settings = {
            enabled: true,
            minAmount: Number(data.minAmount) || 0,
            options: data.options
              .map((row) => ({ count: Number(row.count), ratePercent: Number(row.ratePercent) }))
              .filter((row) => row.count >= 2 && row.ratePercent >= 0),
          };
        }
        return state.settings;
      })
      .catch(() => state.settings);
    return state.promise;
  }

  function quote(amount) {
    const cfg = state.settings;
    const base = round2(amount);
    if (!cfg.enabled || !(base > 0) || base < cfg.minAmount) return [];
    return cfg.options.map((option) => {
      const total = round2(base * (1 + option.ratePercent / 100));
      return { count: option.count, ratePercent: option.ratePercent, total, monthly: round2(total / option.count) };
    });
  }

  window.PatygoInstallments = {
    load,
    quote,
    get settings() {
      return state.settings;
    },
  };
})();
