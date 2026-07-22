/* Patygo Teknoloji — site etkileşimleri */
(function () {
  "use strict";

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

  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    const setMenu = (open) => {
      links.classList.toggle("open", open);
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
      if (!open) {
        links.querySelectorAll(".nav-mega.open").forEach((item) => {
          item.classList.remove("open");
          const btn = item.querySelector(".nav-mega-toggle");
          if (btn) btn.setAttribute("aria-expanded", "false");
        });
      }
    };
    toggle.addEventListener("click", () => {
      setMenu(!links.classList.contains("open"));
    });
    links.addEventListener("click", (ev) => {
      const a = ev.target.closest("a");
      if (a && links.contains(a)) setMenu(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 860) setMenu(false);
    });
  }

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
})();
