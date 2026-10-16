(function () {
  "use strict";

  function formatTry(amount) {
    return (
      "₺" +
      Number(amount || 0).toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function shortName(name, max) {
    const limit = max || 72;
    const text = String(name || "").trim();
    if (text.length <= limit) return text;
    return text.slice(0, limit - 1).trimEnd() + "…";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function productHref(urlPath) {
    const path = String(urlPath || "").trim();
    if (!path) return "/urunler";
    if (/^https?:\/\//i.test(path)) return path;
    return path.startsWith("/") ? path : "/" + path;
  }

  function makeCarousel(opts) {
    const { track, dotsWrap, prevBtn, nextBtn, count, autoMs, onPaint, reduceMotion } = opts;
    let index = 0;
    let timer = null;

    function paint() {
      if (track) track.style.transform = "translateX(-" + index * 100 + "%)";
      if (dotsWrap) {
        dotsWrap.querySelectorAll("button").forEach((el, i) => {
          el.setAttribute("aria-selected", i === index ? "true" : "false");
        });
      }
      if (typeof onPaint === "function") onPaint(index);
    }

    function go(next, user) {
      if (count < 1) return;
      index = ((next % count) + count) % count;
      paint();
      if (user) restart();
    }

    function restart() {
      if (reduceMotion || count < 2 || !autoMs) return;
      clearInterval(timer);
      timer = setInterval(() => go(index + 1, false), autoMs);
    }

    function stop() {
      clearInterval(timer);
    }

    if (dotsWrap) {
      dotsWrap.querySelectorAll("button").forEach((dot, i) => {
        dot.addEventListener("click", () => go(i, true));
      });
    }
    if (prevBtn) prevBtn.addEventListener("click", () => go(index - 1, true));
    if (nextBtn) nextBtn.addEventListener("click", () => go(index + 1, true));
    if (count < 2) {
      if (prevBtn) prevBtn.hidden = true;
      if (nextBtn) nextBtn.hidden = true;
      if (dotsWrap) dotsWrap.hidden = true;
    }

    paint();
    restart();
    return { go, restart, stop, getIndex: () => index };
  }

  function renderBannerSlide(slide, index) {
    const article = document.createElement("article");
    article.className = "home-banner-slide" + (index === 0 ? " is-active" : "");
    article.setAttribute("aria-roledescription", "slide");
    const href = productHref(slide.urlPath);
    article.innerHTML =
      '<a class="home-banner-link" href="' +
      escapeAttr(href) +
      '">' +
      '<img src="' +
      escapeAttr(slide.image) +
      '" alt="' +
      escapeAttr(slide.eyebrow ? slide.eyebrow + " — " + (slide.name || "") : slide.name || "Kampanya") +
      '" loading="' +
      (index === 0 ? "eager" : "lazy") +
      '" decoding="async" />' +
      "</a>";
    return article;
  }

  function renderDealSlide(slide, index) {
    const article = document.createElement("article");
    article.className = "home-deal-slide" + (index === 0 ? " is-active" : "");
    article.setAttribute("aria-roledescription", "slide");
    const thumb = slide.productImage || slide.image;
    article.innerHTML =
      '<a class="home-deal-card" href="' +
      escapeAttr(productHref(slide.urlPath)) +
      '">' +
      '<span class="home-deal-eyebrow">' +
      escapeHtml(slide.eyebrow || "Fırsat") +
      "</span>" +
      '<div class="home-deal-media">' +
      '<img src="' +
      escapeAttr(thumb) +
      '" alt="" loading="' +
      (index === 0 ? "eager" : "lazy") +
      '" decoding="async" />' +
      "</div>" +
      '<p class="home-deal-brand">' +
      escapeHtml(slide.brand || "") +
      "</p>" +
      '<h3 class="home-deal-title">' +
      escapeHtml(shortName(slide.name, 64)) +
      "</h3>" +
      '<div class="home-deal-price"><strong>' +
      escapeHtml(formatTry(slide.priceIncl)) +
      "</strong><span>KDV dahil</span></div>" +
      '<span class="btn btn-primary home-deal-cta">Ürüne git</span>' +
      "</a>";
    return article;
  }

  function mountDuo(slides) {
    const wrap = document.querySelector("[data-hero-slider-wrap]");
    const classic = document.querySelector("[data-classic-hero]");
    const duo = document.querySelector("[data-home-duo]");
    const bannerTrack = duo && duo.querySelector("[data-banner-track]");
    const dealTrack = duo && duo.querySelector("[data-deal-track]");
    const dealDots = duo && duo.querySelector("[data-deal-dots]");
    const live = duo && duo.querySelector("[data-duo-live]");
    if (!wrap || !duo || !bannerTrack || !dealTrack || !dealDots || !slides.length) return false;

    bannerTrack.innerHTML = "";
    dealTrack.innerHTML = "";
    dealDots.innerHTML = "";

    slides.forEach((slide, index) => {
      bannerTrack.appendChild(renderBannerSlide(slide, index));
      dealTrack.appendChild(renderDealSlide(slide, index));
      const dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", "Ürün " + (index + 1));
      dot.setAttribute("aria-selected", index === 0 ? "true" : "false");
      dealDots.appendChild(dot);
    });

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const banner = makeCarousel({
      track: bannerTrack,
      prevBtn: duo.querySelector("[data-banner-prev]"),
      nextBtn: duo.querySelector("[data-banner-next]"),
      count: slides.length,
      autoMs: 6000,
      reduceMotion,
      onPaint: function (i) {
        bannerTrack.querySelectorAll(".home-banner-slide").forEach((el, n) => {
          el.classList.toggle("is-active", n === i);
        });
      },
    });

    const deal = makeCarousel({
      track: dealTrack,
      dotsWrap: dealDots,
      count: slides.length,
      autoMs: 4500,
      reduceMotion,
      onPaint: function (i) {
        dealTrack.querySelectorAll(".home-deal-slide").forEach((el, n) => {
          el.classList.toggle("is-active", n === i);
        });
        if (live) {
          const s = slides[i];
          live.textContent = "Ürün " + (i + 1) + ": " + (s.brand || "") + " " + shortName(s.name, 40);
        }
      },
    });

    duo.addEventListener("mouseenter", () => {
      banner.stop();
      deal.stop();
    });
    duo.addEventListener("mouseleave", () => {
      banner.restart();
      deal.restart();
    });

    if (classic) classic.hidden = true;
    wrap.hidden = false;
    return true;
  }

  async function init() {
    const wrap = document.querySelector("[data-hero-slider-wrap]");
    if (!wrap) return;
    try {
      const res = await fetch("/api/home-slider", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      const slides = data && Array.isArray(data.slides) ? data.slides : [];
      if (slides.length) mountDuo(slides);
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
