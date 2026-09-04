(function () {
  "use strict";

  const TOKEN_KEY = "patygo_admin_token";
  const PANEL_SRC = "/assets/js/admin-panel.js?v=login-split-1";
  const loginForm = document.getElementById("loginForm");
  const loginNote = document.getElementById("loginNote");

  function note(el, type, text) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-ok", type === "ok");
    el.classList.toggle("is-err", type === "err");
  }

  function loadAdminPanel() {
    if (window.__patygoAdminPanelPromise) return window.__patygoAdminPanelPromise;
    window.__patygoAdminPanelPromise = new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[data-patygo-admin-panel="1"]');
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = PANEL_SRC;
      script.dataset.patygoAdminPanel = "1";
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        window.__patygoAdminPanelPromise = null;
        reject(new Error("Panel yüklenemedi. Sayfayı yenileyip tekrar deneyin."));
      };
      document.body.appendChild(script);
    });
    return window.__patygoAdminPanelPromise;
  }

  async function loginRequest(payload) {
    if (location.protocol === "file:") {
      throw new Error(
        "Paneli file:// ile açmayın. https://patygoteknoloji.com/admin veya yerel sunucu /admin kullanın."
      );
    }
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, 60000);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "İstek başarısız (" + res.status + ")");
      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error(
          "Sunucu girişe yanıt vermedi. Bu şifre hatası değil — birkaç saniye sonra tekrar deneyin."
        );
      }
      if (err && err.message && /Failed to fetch|NetworkError|Load failed|fetch/i.test(err.message)) {
        throw new Error(
          "Panele ulaşılamadı. Bu şifre hatası değil — bağlantıyı kontrol edip tekrar deneyin."
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function onLoginSubmit(ev) {
    ev.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    note(loginNote, "", "Giriş yapılıyor…");
    try {
      const emailEl = document.getElementById("loginEmail");
      const email = emailEl ? String(emailEl.value || "").trim() : "";
      const payload = { password: document.getElementById("password").value };
      if (email) payload.email = email;
      let data;
      try {
        data = await loginRequest(payload);
      } catch (firstErr) {
        const msg = String((firstErr && firstErr.message) || "");
        const retryable =
          /yanıt vermedi|ulaşılamadı|zaman aşımı|Failed to fetch|NetworkError|API isteği/i.test(msg) &&
          !/E-posta veya şifre|Şifre hatalı|şifre hatalı/i.test(msg);
        if (!retryable) throw firstErr;
        note(loginNote, "", "Bağlantı yenileniyor, tekrar deneniyor…");
        await new Promise(function (r) {
          setTimeout(r, 900);
        });
        data = await loginRequest(payload);
      }
      if (!data || !data.token) throw new Error("Giriş başarısız");
      sessionStorage.setItem(TOKEN_KEY, data.token);
      note(loginNote, "", "Panel yükleniyor…");
      await loadAdminPanel();
      loginForm.removeEventListener("submit", onLoginSubmit);
      note(loginNote, "", "");
    } catch (err) {
      note(loginNote, "err", (err && err.message) || "Giriş başarısız");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const existingToken = sessionStorage.getItem(TOKEN_KEY) || "";
  if (existingToken) {
    note(loginNote, "", "Panel yükleniyor…");
    loadAdminPanel().catch(function (err) {
      note(loginNote, "err", (err && err.message) || "Panel yüklenemedi");
    });
    return;
  }

  if (loginForm) {
    loginForm.addEventListener("submit", onLoginSubmit);
  }
})();
