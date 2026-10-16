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

  function shortName(name) {
    const text = String(name || "").trim();
    if (text.length <= 78) return text;
    return text.slice(0, 75).trimEnd() + "…";
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

  function renderSlide(slide, index, total) {
    const article = document.createElement("article");
    article.className = "hero-slide" + (index === 0 ? " is-active" : "");
    article.dataset.tone = slide.tone || "navy";
    article.setAttribute("aria-roledescription", "slide");
    article.setAttribute("aria-label", index + 1 + " / " + total);
    /* Sol 4:3 görsel + sağ ürün paneli (grid 4fr / 1fr) */
    article.innerHTML =
      '<div class="hero-slide-inner">' +
      '<div class="hero-slide-media" data-slot="visual-4x3">' +
      '<div class="hero-slide-frame">' +
      '<img src="' +
      escapeAttr(slide.image) +
      '" alt="' +
      escapeAttr(slide.name || "") +
      '" loading="' +
      (index === 0 ? "eager" : "lazy") +
      '" decoding="async" />' +
      "</div></div>" +
      '<div class="hero-slide-copy" data-slot="product-rail">' +
      '<p class="hero-slide-eyebrow">' +
      escapeHtml(slide.eyebrow || "Öne çıkan") +
      "</p>" +
      '<p class="hero-slide-brand">' +
      escapeHtml(slide.brand || "") +
      "</p>" +
      '<h2 class="hero-slide-title">' +
      escapeHtml(shortName(slide.name)) +
      "</h2>" +
      '<div class="hero-slide-price"><strong>' +
      escapeHtml(formatTry(slide.priceIncl)) +
      "</strong><span>KDV dahil</span></div>" +
      '<div class="hero-slide-actions">' +
      '<a class="btn btn-primary btn-lg" href="' +
      escapeAttr(productHref(slide.urlPath)) +
      '">Ürüne git</a>' +
      '<a class="btn btn-ghost btn-lg" href="/urunler">Tüm katalog</a>' +
      "</div></div></div>";
    return article;
  }

  function mountSlider(slides) {
    const wrap = document.querySelector("[data-hero-slider-wrap]");
    const classic = document.querySelector("[data-classic-hero]");
    const root = document.querySelector("[data-hero-slider]");
    const track = root && root.querySelector("[data-slider-track]");
    const dotsWrap = root && root.querySelector("[data-slider-dots]");
    const live = root && root.querySelector("[data-slider-live]");
    if (!wrap || !root || !track || !dotsWrap || !slides.length) return false;

    track.innerHTML = "";
    dotsWrap.innerHTML = "";
    slides.forEach((slide, index) => {
      track.appendChild(renderSlide(slide, index, slides.length));
      const dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", "Slayt " + (index + 1));
      dot.setAttribute("aria-selected", index === 0 ? "true" : "false");
      dot.addEventListener("click", () => go(index, true));
      dotsWrap.appendChild(dot);
    });

    let index = 0;
    let timer = null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const AUTO_MS = 5500;

    function paint() {
      track.style.transform = "translateX(-" + index * 100 + "%)";
      track.querySelectorAll(".hero-slide").forEach((el, i) => {
        el.classList.toggle("is-active", i === index);
      });
      dotsWrap.querySelectorAll("button").forEach((el, i) => {
        el.setAttribute("aria-selected", i === index ? "true" : "false");
      });
      if (live) {
        const s = slides[index];
        live.textContent =
          "Slayt " + (index + 1) + ": " + (s.brand || "") + " " + shortName(s.name);
      }
    }

    function go(next, user) {
      index = ((next % slides.length) + slides.length) % slides.length;
      paint();
      if (user) restart();
    }

    function restart() {
      if (reduceMotion || slides.length < 2) return;
      clearInterval(timer);
      timer = setInterval(() => go(index + 1, false), AUTO_MS);
    }

    const prev = root.querySelector("[data-slider-prev]");
    const next = root.querySelector("[data-slider-next]");
    if (prev) prev.addEventListener("click", () => go(index - 1, true));
    if (next) next.addEventListener("click", () => go(index + 1, true));
    if (slides.length < 2) {
      if (prev) prev.hidden = true;
      if (next) next.hidden = true;
      dotsWrap.hidden = true;
    }

    root.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") go(index - 1, true);
      if (ev.key === "ArrowRight") go(index + 1, true);
    });
    root.tabIndex = 0;
    root.addEventListener("mouseenter", () => clearInterval(timer));
    root.addEventListener("mouseleave", restart);
    root.addEventListener("focusin", () => clearInterval(timer));
    root.addEventListener("focusout", (ev) => {
      if (!root.contains(ev.relatedTarget)) restart();
    });

    if (classic) classic.hidden = true;
    wrap.hidden = false;
    paint();
    restart();
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
      if (slides.length) mountSlider(slides);
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
