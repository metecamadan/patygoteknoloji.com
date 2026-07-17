/* Patygo Teknoloji — site etkileşimleri */
(function () {
  "use strict";

  /* Header gölge (scroll) */
  const header = document.querySelector(".site-header");
  const onScroll = () => {
    if (header) header.classList.toggle("scrolled", window.scrollY > 8);
    const top = document.querySelector(".fab .top");
    if (top) top.classList.toggle("show", window.scrollY > 500);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Mobil menü */
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      })
    );
  }

  /* Scroll reveal */
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
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add("in"));
  }

  /* Sayaç animasyonu */
  const counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && counters.length) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target;
          const target = parseFloat(el.dataset.count);
          const suffix = el.dataset.suffix || "";
          const dur = 1400;
          const start = performance.now();
          const step = (now) => {
            const p = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          cio.unobserve(el);
        });
      },
      { threshold: 0.5 }
    );
    counters.forEach((el) => cio.observe(el));
  }

  /* Akordeon (SSS) */
  document.querySelectorAll(".acc-head").forEach((head) => {
    head.addEventListener("click", () => {
      const item = head.closest(".acc-item");
      const body = item.querySelector(".acc-body");
      const isOpen = item.classList.contains("open");
      item.classList.toggle("open", !isOpen);
      body.style.maxHeight = isOpen ? null : body.scrollHeight + "px";
    });
  });

  /* İletişim formu (demo) */
  const form = document.querySelector("#contact-form");
  if (form) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const note = form.querySelector(".form-note");
      if (note) {
        note.classList.add("ok");
        note.textContent =
          "Teşekkürler! Talebiniz alındı. Ekibimiz en kısa sürede sizinle iletişime geçecek.";
      }
      form.reset();
      if (note) note.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  /* Aktif yıl */
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
})();
