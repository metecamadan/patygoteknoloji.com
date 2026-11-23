(function () {
  "use strict";

  var DEAL_AUTO_MS = 5000;
  var BANNER_AUTO_MS = 6000;

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
    var limit = max || 72;
    var text = String(name || "").trim();
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
    var path = String(urlPath || "").trim();
    if (!path) return "/urunler";
    if (/^https?:\/\//i.test(path)) return path;
    return path.startsWith("/") ? path : "/" + path;
  }

  function makeCarousel(opts) {
    var track = opts.track;
    var viewport = opts.viewport || (track && track.parentElement);
    var dotsWrap = opts.dotsWrap;
    var prevBtn = opts.prevBtn;
    var nextBtn = opts.nextBtn;
    var count = opts.count;
    var autoMs = opts.autoMs;
    var onPaint = opts.onPaint;
    var reduceMotion = opts.reduceMotion;
    var index = 0;
    var timer = null;

    function slideWidth() {
      return viewport && viewport.clientWidth ? viewport.clientWidth : 0;
    }

    function layout() {
      var w = slideWidth();
      if (!track || !w) return;
      track.style.width = w * count + "px";
      Array.prototype.forEach.call(track.children, function (el) {
        el.style.flex = "0 0 " + w + "px";
        el.style.width = w + "px";
        el.style.minWidth = w + "px";
        el.style.maxWidth = w + "px";
      });
    }

    function paint() {
      layout();
      var w = slideWidth();
      if (track) {
        track.style.transform = w ? "translateX(-" + index * w + "px)" : "translateX(0)";
      }
      if (dotsWrap) {
        Array.prototype.forEach.call(dotsWrap.querySelectorAll("button"), function (el, i) {
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
      timer = setInterval(function () {
        go(index + 1, false);
      }, autoMs);
    }

    function stop() {
      clearInterval(timer);
    }

    if (dotsWrap) {
      Array.prototype.forEach.call(dotsWrap.querySelectorAll("button"), function (dot, i) {
        dot.addEventListener("click", function () {
          go(i, true);
        });
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        go(index - 1, true);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        go(index + 1, true);
      });
    }
    if (count < 2) {
      if (prevBtn) prevBtn.hidden = true;
      if (nextBtn) nextBtn.hidden = true;
      if (dotsWrap) dotsWrap.hidden = true;
    }

    window.addEventListener("resize", function () {
      paint();
    });

    paint();
    restart();
    return { go: go, restart: restart, stop: stop, getIndex: function () { return index; } };
  }

  function renderBannerSlide(slide, index) {
    var article = document.createElement("article");
    article.className = "home-banner-slide" + (index === 0 ? " is-active" : "");
    article.setAttribute("aria-roledescription", "slide");
    var href = productHref(slide.urlPath);
    var desktop = slide.imageDesktop || slide.image || "";
    var mobile = slide.imageMobile || desktop;
    var alt = slide.eyebrow
      ? slide.eyebrow + " — " + (slide.name || "")
      : slide.name || "Kampanya";
    var loading = index === 0 ? "eager" : "lazy";
    article.innerHTML =
      '<a class="home-banner-link" href="' +
      escapeAttr(href) +
      '">' +
      "<picture>" +
      (mobile && mobile !== desktop
        ? '<source media="(max-width: 900px)" srcset="' + escapeAttr(mobile) + '" />'
        : "") +
      '<img src="' +
      escapeAttr(desktop) +
      '" alt="' +
      escapeAttr(alt) +
      '" width="1200" height="350" loading="' +
      loading +
      '" decoding="async" />' +
      "</picture>" +
      "</a>";
    return article;
  }

  function renderDealSlide(deal, index) {
    var article = document.createElement("article");
    article.className = "home-deal-slide" + (index === 0 ? " is-active" : "");
    article.setAttribute("aria-roledescription", "slide");
    var thumb = deal.productImage || "";
    var dealHref = productHref(deal.productUrlPath);
    article.innerHTML =
      '<a class="home-deal-card" href="' +
      escapeAttr(dealHref) +
      '">' +
      '<span class="home-deal-eyebrow">' +
      escapeHtml(deal.eyebrow || "Fırsat") +
      "</span>" +
      '<div class="home-deal-media">' +
      '<img src="' +
      escapeAttr(thumb) +
      '" alt="" loading="' +
      (index === 0 ? "eager" : "lazy") +
      '" decoding="async" />' +
      "</div>" +
      '<p class="home-deal-brand">' +
      escapeHtml(deal.brand || "") +
      "</p>" +
      '<h3 class="home-deal-title">' +
      escapeHtml(shortName(deal.name, 64)) +
      "</h3>" +
      '<div class="home-deal-price"><strong>' +
      escapeHtml(formatTry(deal.priceIncl)) +
      "</strong><span>KDV dahil</span></div>" +
      '<span class="btn btn-primary home-deal-cta">Ürüne git</span>' +
      "</a>";
    return article;
  }

  function mountDuo(slides, deals) {
    var wrap = document.querySelector("[data-hero-slider-wrap]");
    var classic = document.querySelector("[data-classic-hero]");
    var duo = document.querySelector("[data-home-duo]");
    var banner = duo && duo.querySelector("[data-home-banner]");
    var bannerTrack = duo && duo.querySelector("[data-banner-track]");
    var bannerViewport = banner && banner.querySelector(".home-banner-viewport");
    var dealAside = duo && duo.querySelector("[data-home-deal]");
    var dealTrack = duo && duo.querySelector("[data-deal-track]");
    var dealViewport = dealAside && dealAside.querySelector(".home-deal-viewport");
    var dealDots = duo && duo.querySelector("[data-deal-dots]");
    var live = duo && duo.querySelector("[data-duo-live]");
    if (!wrap || !duo || !bannerTrack || !dealTrack || !dealDots) return false;
    if (!slides.length || !deals.length) return false;

    bannerTrack.innerHTML = "";
    dealTrack.innerHTML = "";
    dealDots.innerHTML = "";

    slides.forEach(function (slide, index) {
      bannerTrack.appendChild(renderBannerSlide(slide, index));
    });
    deals.forEach(function (deal, index) {
      dealTrack.appendChild(renderDealSlide(deal, index));
      var dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", "Ürün " + (index + 1));
      dot.setAttribute("aria-selected", index === 0 ? "true" : "false");
      dealDots.appendChild(dot);
    });

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var bannerCarousel = makeCarousel({
      track: bannerTrack,
      viewport: bannerViewport,
      prevBtn: duo.querySelector("[data-banner-prev]"),
      nextBtn: duo.querySelector("[data-banner-next]"),
      count: slides.length,
      autoMs: BANNER_AUTO_MS,
      reduceMotion: reduceMotion,
      onPaint: function (i) {
        Array.prototype.forEach.call(bannerTrack.querySelectorAll(".home-banner-slide"), function (el, n) {
          el.classList.toggle("is-active", n === i);
        });
      },
    });

    var dealCarousel = makeCarousel({
      track: dealTrack,
      viewport: dealViewport,
      dotsWrap: dealDots,
      count: deals.length,
      autoMs: DEAL_AUTO_MS,
      reduceMotion: reduceMotion,
      onPaint: function (i) {
        Array.prototype.forEach.call(dealTrack.querySelectorAll(".home-deal-slide"), function (el, n) {
          el.classList.toggle("is-active", n === i);
        });
        if (live) {
          var d = deals[i];
          live.textContent =
            "Ürün " + (i + 1) + "/" + deals.length + ": " + (d.brand || "") + " " + shortName(d.name, 40);
        }
      },
    });

    duo.addEventListener("mouseenter", function () {
      bannerCarousel.stop();
      dealCarousel.stop();
    });
    duo.addEventListener("mouseleave", function () {
      bannerCarousel.restart();
      dealCarousel.restart();
    });

    if (classic) classic.hidden = true;
    wrap.hidden = false;
    return true;
  }

  function legacyToLists(data) {
    var slides = data && Array.isArray(data.slides) ? data.slides : [];
    var deals = data && Array.isArray(data.deals) ? data.deals : [];
    if (deals.length && slides.length) return { slides: slides, deals: deals };

    // Eski API: tek listede pair
    var items = data && Array.isArray(data.items) ? data.items : slides;
    if (!items.length) return { slides: [], deals: [] };
    var hasSplit = items[0] && (items[0].productUrlPath || items[0].productImage);
    if (!hasSplit || (data.deals && data.deals.length === 0 && data.slides && data.slides[0] && !data.slides[0].productId)) {
      return { slides: slides, deals: deals };
    }
    if (!deals.length && items[0] && items[0].productId) {
      deals = items.map(function (item) {
        return {
          id: item.id,
          productId: item.productId,
          brand: item.brand,
          name: item.name,
          productImage: item.productImage,
          productUrlPath: item.productUrlPath || item.urlPath,
          priceIncl: item.priceIncl,
          eyebrow: item.eyebrow,
        };
      });
      slides = items.map(function (item) {
        return {
          id: item.id,
          name: item.name,
          imageDesktop: item.imageDesktop || item.image,
          imageMobile: item.imageMobile,
          urlPath: item.urlPath,
          eyebrow: item.eyebrow,
          tone: item.tone,
        };
      });
    }
    return { slides: slides, deals: deals };
  }

  async function init() {
    var wrap = document.querySelector("[data-hero-slider-wrap]");
    if (!wrap) return;
    try {
      var res = await fetch("/api/home-slider", { credentials: "same-origin" });
      if (!res.ok) return;
      var data = await res.json();
      var lists = legacyToLists(data);
      if (lists.slides.length && lists.deals.length) mountDuo(lists.slides, lists.deals);
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
