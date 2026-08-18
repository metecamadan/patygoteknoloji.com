/* Patygo Teknoloji — site etkileşimleri */
(function () {
  "use strict";

  const mainEl = document.querySelector("main");
  if (mainEl && !mainEl.id) mainEl.id = "main-content";
  if (!document.querySelector(".skip-link")) {
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#main-content";
    skip.textContent = "Ana içeriğe geç";
    document.body.insertBefore(skip, document.body.firstChild);
  }

  const analyticsDisabled =
    navigator.doNotTrack === "1" || window.doNotTrack === "1";
  let analyticsSession = "";
  if (!analyticsDisabled) {
    try {
      analyticsSession = sessionStorage.getItem("patygo_analytics_session") || "";
      if (!analyticsSession) {
        analyticsSession =
          window.crypto?.randomUUID?.() ||
          "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
        sessionStorage.setItem("patygo_analytics_session", analyticsSession);
      }
    } catch (_) {
      analyticsSession = "s-" + Date.now().toString(36);
    }
  }

  function trackAnalytics(type, meta) {
    if (analyticsDisabled || !analyticsSession) return;
    const extra = meta && typeof meta === "object" ? meta : {};
    const payload = JSON.stringify({
      type,
      path: location.pathname + (location.search || ""),
      productId: extra.productId || "",
      sessionId: analyticsSession,
    });
    try {
      if (navigator.sendBeacon) {
        const sent = navigator.sendBeacon(
          "/api/analytics/event",
          new Blob([payload], { type: "application/json" })
        );
        if (sent) return;
      }
      fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
        cache: "no-store",
      }).catch(() => {});
    } catch (_) {}
  }

  window.PatygoAnalytics = { track: trackAnalytics };
  const detailId = new URLSearchParams(location.search).get("id") || "";
  trackAnalytics(
    "page_view",
    /urun-detay/i.test(location.pathname) && detailId ? { productId: detailId } : undefined
  );

  const header = document.querySelector(".site-header");
  const onScroll = () => {
    if (header) header.classList.toggle("scrolled", window.scrollY > 8);
    const top = document.querySelector(".fab .top");
    if (top) top.classList.toggle("show", window.scrollY > 500);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  function initCategoryNav() {
    const nav = document.querySelector(".nav");
    const brand = nav && nav.querySelector(".brand");
    const links = document.querySelector(".nav-links");
    const legacyToggle = document.querySelector(".nav-toggle");
    if (!nav || !brand || !links) return;

    let catBtn = document.getElementById("navCategories");
    if (!catBtn) {
      catBtn = document.createElement("button");
      catBtn.type = "button";
      catBtn.id = "navCategories";
      catBtn.className = "nav-categories-btn";
      catBtn.setAttribute("aria-controls", "navLinks");
      catBtn.setAttribute("aria-expanded", "false");
      catBtn.setAttribute("aria-label", "Kategoriler");
      catBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/></svg>' +
        '<span class="nav-categories-label">Kategoriler</span>';
      nav.insertBefore(catBtn, brand);
    }

    const homeSlot = { parent: links.parentElement, before: links.nextElementSibling };

    function isMobileNav() {
      return window.matchMedia("(max-width: 860px)").matches;
    }

    function portalNavLinks() {
      if (isMobileNav()) {
        if (links.parentElement !== document.body) {
          homeSlot.parent = links.parentElement;
          homeSlot.before = links.nextElementSibling;
          document.body.appendChild(links);
        }
        links.classList.add("nav-sheet");
        return;
      }
      links.classList.remove("nav-sheet", "open");
      if (links.parentElement === document.body && homeSlot.parent) {
        if (homeSlot.before && homeSlot.before.parentElement === homeSlot.parent) {
          homeSlot.parent.insertBefore(links, homeSlot.before);
        } else {
          homeSlot.parent.appendChild(links);
        }
      }
    }

    function closeAllMegaState() {
      links.querySelectorAll(".nav-mega.open").forEach((item) => {
        item.classList.remove("open");
        const btn = item.querySelector(".nav-mega-toggle");
        if (btn) btn.setAttribute("aria-expanded", "false");
      });
      links.querySelectorAll(".nav-mega-group.open").forEach((group) => {
        group.classList.remove("open");
        const btn = group.querySelector(".nav-mega-group-toggle");
        if (btn) btn.setAttribute("aria-expanded", "false");
      });
    }

    function setMenu(open) {
      links.classList.toggle("open", open);
      catBtn.classList.toggle("open", open);
      catBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (legacyToggle) {
        legacyToggle.classList.remove("open");
        legacyToggle.setAttribute("aria-expanded", "false");
      }
      document.body.classList.toggle("nav-open", open);
      document.body.style.overflow = open ? "hidden" : "";
      if (!open) closeAllMegaState();
    }

    catBtn.addEventListener("click", () => {
      setMenu(!links.classList.contains("open"));
    });
    if (legacyToggle) {
      legacyToggle.addEventListener("click", () => {
        if (!isMobileNav()) return;
        setMenu(!links.classList.contains("open"));
      });
    }
    links.addEventListener("click", (ev) => {
      const a = ev.target.closest("a");
      if (a && links.contains(a)) setMenu(false);
    });
    document.addEventListener("click", (ev) => {
      if (!links.classList.contains("open") || !isMobileNav()) return;
      if (catBtn.contains(ev.target) || links.contains(ev.target)) return;
      setMenu(false);
    });
    window.addEventListener("resize", () => {
      portalNavLinks();
      if (!isMobileNav()) setMenu(false);
    });
    portalNavLinks();
  }

  initCategoryNav();

  const revealables = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealables.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -30px 0px" }
    );
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add("in"));
  }

  /* Ürün sekmeleri catalog.js tarafından bağlanır */

  document.querySelectorAll(".acc-head").forEach((head) => {
    head.addEventListener("click", () => {
      const item = head.closest(".acc-item");
      const body = item.querySelector(".acc-body");
      const isOpen = item.classList.contains("open");
      item.classList.toggle("open", !isOpen);
      body.style.maxHeight = isOpen ? null : body.scrollHeight + "px";
    });
  });

  /* Teklif / iletişim formları → /api/contact → info@patygoteknoloji.com */
  document.querySelectorAll("form#contact-form").forEach((form) => {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const note = form.querySelector(".form-note");
      const btn = form.querySelector('button[type="submit"]');
      const setNote = (type, text) => {
        if (!note) return;
        note.classList.remove("ok", "err");
        if (type) note.classList.add(type);
        note.textContent = text;
      };

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const raw = new FormData(form);
      const data = {
        firma: String(raw.get("firma") || "").trim(),
        vkn: String(raw.get("vkn") || "").trim(),
        email: String(raw.get("email") || "").trim(),
        tel: String(raw.get("tel") || "").trim(),
        urun: String(raw.get("urun") || "").trim(),
        kategori: String(raw.get("kategori") || "").trim(),
        konu: String(raw.get("konu") || "").trim(),
        mesaj: String(raw.get("mesaj") || "").trim(),
        _subject: String(raw.get("_subject") || "Patygo Teklif / İletişim Talebi").trim(),
        _honey: String(raw.get("_honey") || ""),
      };

      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = "Gönderiliyor…";
      }
      setNote("", "Talebiniz gönderiliyor…");

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(data),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) {
          throw new Error(json.error || "Gönderim başarısız");
        }
        setNote(
          "ok",
          "Teşekkürler! Talebiniz info@patygoteknoloji.com adresine iletildi. En kısa sürede dönüş yapacağız."
        );
        trackAnalytics("lead_submitted");
        form.reset();
      } catch (err) {
        setNote(
          "err",
          (err && err.message) ||
            "Gönderim şu an tamamlanamadı. Lütfen doğrudan info@patygoteknoloji.com adresine yazın veya WhatsApp’tan ulaşın."
        );
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.label || "Gönder";
        }
      }
    });
  });

  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  if (!document.querySelector(".quote-rail")) {
    const quote = document.createElement("a");
    quote.className = "quote-rail";
    quote.href = document.getElementById("teklif") ? "#teklif" : "/#teklif";
    quote.textContent = "Teklif Al";
    document.body.appendChild(quote);
  }
})();
