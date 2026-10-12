/* Patygo Teknoloji — çerez onayı ve Google Analytics (GA4) */
(function () {
  "use strict";

  const GA_ID = "G-ZW8V1C7EL0";
  const STORE_KEY = "patygo_consent_v1";
  const PURCHASE_KEY = "patygo_ga_purchases";
  const CONSENT_DAYS = 365;
  const PENDING_MAX = 20;
  const ALLOWED_VAT = [1, 8, 10, 20];

  let choice = readChoice();
  let loaded = false;
  // Events raised before the visitor answers; sent if they accept on this page, dropped otherwise.
  let pending = [];
  let banner = null;

  function readChoice() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!saved || typeof saved !== "object" || !saved.at) return null;
      if (Date.now() - Date.parse(saved.at) > CONSENT_DAYS * 864e5) return null;
      return { analytics: saved.analytics === true, ads: saved.ads === true, at: saved.at };
    } catch (_) {
      return null;
    }
  }

  function saveChoice(analytics, ads) {
    choice = { analytics: Boolean(analytics), ads: Boolean(ads), at: new Date().toISOString() };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(choice));
    } catch (_) {}
    applyChoice();
    closeBanner();
  }

  function gtag() {
    window.dataLayer.push(arguments);
  }

  function consentState() {
    const ads = choice && choice.ads ? "granted" : "denied";
    return {
      analytics_storage: choice && choice.analytics ? "granted" : "denied",
      ad_storage: ads,
      ad_user_data: ads,
      ad_personalization: ads,
    };
  }

  function wantsGoogle() {
    return Boolean(choice && (choice.analytics || choice.ads));
  }

  function applyChoice() {
    if (!choice) return;
    if (!choice.analytics) deleteCookies(/^(_ga|_gid)/);
    if (!choice.ads) deleteCookies(/^_gcl/);
    if (!loaded) {
      if (!wantsGoogle()) {
        pending = [];
        return;
      }
      loadGoogle();
    } else {
      gtag("consent", "update", consentState());
    }
    window["ga-disable-" + GA_ID] = !wantsGoogle();
    const queued = pending;
    pending = [];
    if (wantsGoogle()) queued.forEach((args) => gtag("event", args[0], args[1]));
  }

  function loadGoogle() {
    window.dataLayer = window.dataLayer || [];
    gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    gtag("consent", "update", consentState());
    gtag("js", new Date());
    gtag("config", GA_ID, {
      allow_google_signals: Boolean(choice.ads),
      allow_ad_personalization_signals: Boolean(choice.ads),
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(script);
    loaded = true;
  }

  function deleteCookies(pattern) {
    const host = location.hostname;
    const domains = ["", host, "." + host.replace(/^www\./, "")];
    document.cookie.split(";").forEach((part) => {
      const name = part.split("=")[0].trim();
      if (!pattern.test(name)) return;
      domains.forEach((domain) => {
        document.cookie =
          name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + (domain ? "; domain=" + domain : "");
      });
    });
  }

  function event(name, params) {
    if (choice) {
      if (wantsGoogle()) gtag("event", name, params || {});
      return;
    }
    if (pending.length < PENDING_MAX) pending.push([name, params || {}]);
  }

  function priceIncl(product) {
    const vat = Number(product && product.vatPercent);
    const rate = ALLOWED_VAT.includes(vat) ? vat : 20;
    return Math.round((Number(product && product.price) || 0) * (100 + rate)) / 100;
  }

  /** GA4 item for a catalog product (net price + VAT → the price the shopper sees). */
  function item(product, qty) {
    const p = product || {};
    const row = {
      item_id: String(p.id || p.productId || ""),
      item_name: String(p.name || ""),
      price: priceIncl(p),
      quantity: Math.max(1, Number(qty) || 1),
    };
    if (p.brand) row.item_brand = String(p.brand);
    if (p.category) row.item_category = String(p.category);
    if (p.mid) row.item_category2 = String(p.mid);
    if (p.alt) row.item_category3 = String(p.alt);
    return row;
  }

  function itemsValue(items) {
    return Math.round(items.reduce((sum, row) => sum + row.price * row.quantity, 0) * 100) / 100;
  }

  /** Paid order → GA4 purchase, at most once per order id on this browser. */
  function purchase(order) {
    if (!order || !order.id || !Array.isArray(order.items)) return;
    let sent = [];
    try {
      sent = JSON.parse(localStorage.getItem(PURCHASE_KEY) || "[]");
    } catch (_) {}
    if (!Array.isArray(sent)) sent = [];
    if (sent.includes(order.id)) return;
    const items = order.items.map((line) => {
      const quantity = Math.max(1, Number(line.qty) || 1);
      const lineIncl = (Number(line.line) || 0) + (Number(line.lineVat) || 0);
      const row = {
        item_id: String(line.productId || line.id || ""),
        item_name: String(line.name || ""),
        price: Math.round((lineIncl / quantity) * 100) / 100,
        quantity,
      };
      if (line.brand) row.item_brand = String(line.brand);
      return row;
    });
    const params = {
      transaction_id: String(order.id),
      currency: "TRY",
      value: Number(order.total) || 0,
      shipping: Number(order.shippingFee) || 0,
      items,
    };
    if (order.coupon && order.coupon.code) params.coupon = String(order.coupon.code);
    event("purchase", params);
    sent.push(order.id);
    try {
      localStorage.setItem(PURCHASE_KEY, JSON.stringify(sent.slice(-20)));
    } catch (_) {}
  }

  function closeBanner() {
    if (!banner) return;
    banner.remove();
    banner = null;
  }

  function button(label, action, className) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "btn " + className;
    el.dataset.consentAction = action;
    el.textContent = label;
    return el;
  }

  function toggle(key, label, hint) {
    const row = document.createElement("label");
    row.className = "consent-option";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.consent = key;
    if (key === "required") {
      box.checked = true;
      box.disabled = true;
    } else {
      box.checked = Boolean(choice && choice[key]);
    }
    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = label;
    text.appendChild(strong);
    text.appendChild(document.createTextNode(" — " + hint));
    row.appendChild(box);
    row.appendChild(text);
    return row;
  }

  function openBanner(showPrefs) {
    closeBanner();
    banner = document.createElement("section");
    banner.className = "consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-modal", "false");
    banner.setAttribute("aria-labelledby", "consentTitle");

    const title = document.createElement("h2");
    title.id = "consentTitle";
    title.className = "consent-title";
    title.textContent = "Çerez tercihleriniz";

    const text = document.createElement("p");
    text.className = "consent-text";
    text.appendChild(
      document.createTextNode(
        "Sitenin çalışması için zorunlu çerezleri kullanırız. İzin verirseniz ziyaret ve satışları ölçmek (Google Analytics) " +
          "ve size uygun reklamlar göstermek (Google reklamları) için ek çerezler kullanırız; bu veriler Google’a ve yurt dışına aktarılır. " +
          "Tercihinizi istediğiniz zaman sayfa altındaki “Çerez tercihleri” bağlantısından değiştirebilirsiniz. Ayrıntılar: "
      )
    );
    const link = document.createElement("a");
    link.href = "/cerez";
    link.textContent = "Çerez Politikası";
    text.appendChild(link);
    text.appendChild(document.createTextNode("."));

    const prefs = document.createElement("div");
    prefs.className = "consent-prefs";
    prefs.hidden = !showPrefs;
    prefs.appendChild(toggle("required", "Zorunlu", "sepet, ödeme ve güvenlik için her zaman açık"));
    prefs.appendChild(toggle("analytics", "İstatistik", "Google Analytics ile ziyaret ve satış ölçümü"));
    prefs.appendChild(toggle("ads", "Pazarlama", "Google reklamları ve yeniden pazarlama"));

    const actions = document.createElement("div");
    actions.className = "consent-actions";
    const prefsButton = button(showPrefs ? "Seçimi kaydet" : "Tercihler", showPrefs ? "save" : "prefs", "btn-outline");
    actions.appendChild(button("Reddet", "reject", "btn-primary"));
    actions.appendChild(prefsButton);
    actions.appendChild(button("Kabul et", "accept", "btn-primary"));

    actions.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-consent-action]");
      if (!target) return;
      const action = target.dataset.consentAction;
      if (action === "accept") saveChoice(true, true);
      else if (action === "reject") saveChoice(false, false);
      else if (action === "prefs") {
        prefs.hidden = false;
        target.dataset.consentAction = "save";
        target.textContent = "Seçimi kaydet";
        const first = prefs.querySelector('input[data-consent="analytics"]');
        if (first) first.focus();
      } else if (action === "save") {
        const value = (key) => {
          const box = prefs.querySelector('input[data-consent="' + key + '"]');
          return Boolean(box && box.checked);
        };
        saveChoice(value("analytics"), value("ads"));
      }
    });

    const inner = document.createElement("div");
    inner.className = "consent-inner";
    inner.appendChild(title);
    inner.appendChild(text);
    inner.appendChild(prefs);
    inner.appendChild(actions);
    banner.appendChild(inner);
    document.body.appendChild(banner);
  }

  function addPreferencesLinks() {
    document.querySelectorAll(".footer-bottom .legal-links").forEach((links) => {
      if (links.querySelector("[data-consent-open]")) return;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "consent-link";
      open.dataset.consentOpen = "";
      open.textContent = "Çerez tercihleri";
      links.appendChild(open);
    });
    document.addEventListener("click", (ev) => {
      const opener = ev.target.closest("[data-consent-open]");
      if (!opener) return;
      ev.preventDefault();
      openBanner(true);
    });
  }

  window.PatygoGa = { event, item, itemsValue, purchase, open: () => openBanner(true) };

  applyChoice();
  const start = () => {
    addPreferencesLinks();
    if (!choice) openBanner(false);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
