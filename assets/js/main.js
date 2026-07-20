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

  /* Teklif / iletişim formları → info@patygoteknoloji.com */
  const MAIL_ENDPOINT =
    "https://formsubmit.co/ajax/info@patygoteknoloji.com";

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

      const data = Object.fromEntries(new FormData(form).entries());
      delete data.onay;
      delete data._honey;
      if (!data._subject) {
        data._subject = "Patygo Teklif / İletişim Talebi";
      }
      data._template = data._template || "table";
      data._captcha = "false";
      data._replyto = data.email || "";

      if (btn) {
        btn.disabled = true;
        btn.dataset.label = btn.textContent;
        btn.textContent = "Gönderiliyor…";
      }
      setNote("", "Talebiniz gönderiliyor…");

      try {
        const res = await fetch(MAIL_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(data),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === "false" || json.success === false) {
          throw new Error(json.message || "Gönderim başarısız");
        }
        setNote(
          "ok",
          "Teşekkürler! Talebiniz info@patygoteknoloji.com adresine iletildi. En kısa sürede dönüş yapacağız."
        );
        form.reset();
      } catch (err) {
        setNote(
          "err",
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
