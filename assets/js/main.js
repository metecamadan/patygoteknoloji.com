/* Patygo Teknoloji — site etkileşimleri */
(function () {
  "use strict";

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
    };
    toggle.addEventListener("click", () => {
      setMenu(!links.classList.contains("open"));
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => setMenu(false))
    );
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

  /* Ürün sekmeleri */
  const tabs = document.querySelectorAll(".product-tabs button");
  const cards = document.querySelectorAll(".product-card");
  if (tabs.length && cards.length) {
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabs.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const filter = btn.dataset.filter;
        cards.forEach((card) => {
          const show = filter === "all" || card.dataset.cat === filter;
          card.hidden = !show;
        });
      });
    });
  }

  document.querySelectorAll(".acc-head").forEach((head) => {
    head.addEventListener("click", () => {
      const item = head.closest(".acc-item");
      const body = item.querySelector(".acc-body");
      const isOpen = item.classList.contains("open");
      item.classList.toggle("open", !isOpen);
      body.style.maxHeight = isOpen ? null : body.scrollHeight + "px";
    });
  });

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
    });
  }

  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
})();
