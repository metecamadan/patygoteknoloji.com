(function () {
  "use strict";

  const statusEl = document.getElementById("reviewStatus");
  const listEl = document.getElementById("reviewList");
  if (!statusEl || !listEl) return;

  const params = new URLSearchParams(location.search);
  const orderId = params.get("siparis") || "";
  const token = params.get("token") || "";
  // The token stays in memory only; the address bar keeps the order number.
  if (token && window.history && history.replaceState) {
    history.replaceState(null, "", location.pathname + (orderId ? "?siparis=" + encodeURIComponent(orderId) : ""));
  }

  const STATUS_TEXT = {
    pending: "Değerlendirmeniz alındı; kontrol edildikten sonra yayınlanacak.",
    approved: "Değerlendirmeniz ürün sayfasında yayında. Teşekkür ederiz.",
    rejected: "Değerlendirmeniz alındı.",
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== "") node.textContent = text;
    return node;
  }

  function showStatus(kind, text) {
    statusEl.className = "review-status" + (kind ? " is-" + kind : "");
    statusEl.textContent = text;
    statusEl.hidden = !text;
  }

  function doneNote(status) {
    return el("p", "review-done", STATUS_TEXT[status] || STATUS_TEXT.pending);
  }

  function buildForm(item, index) {
    const form = el("form", "review-form");
    form.noValidate = true;
    const prefix = "review" + index;
    form.innerHTML =
      '<fieldset class="review-rating"><legend>Puanınız</legend><div class="review-rating-stars">' +
      [5, 4, 3, 2, 1]
        .map(
          (n) =>
            '<input type="radio" name="rating" value="' + n + '" id="' + prefix + "r" + n + '" />' +
            '<label for="' + prefix + "r" + n + '" title="' + n + ' yıldız"><span class="sr-only">' + n + " yıldız</span>★</label>"
        )
        .join("") +
      "</div></fieldset>" +
      '<label for="' + prefix + 'title">Başlık <small>(isteğe bağlı)</small></label>' +
      '<input type="text" id="' + prefix + 'title" name="title" maxlength="120" />' +
      '<label for="' + prefix + 'body">Yorumunuz</label>' +
      '<textarea id="' + prefix + 'body" name="body" rows="4" minlength="10" maxlength="2000" required placeholder="Ürünü nasıl buldunuz? Kurulum, performans, paketleme…"></textarea>' +
      '<label class="review-check"><input type="checkbox" name="hideName" /> Adım görünmesin (“Doğrulanmış alıcı” olarak yayınlansın)</label>' +
      '<div class="review-actions"><button type="submit" class="btn btn-primary">Değerlendirmeyi gönder</button></div>' +
      '<p class="review-note" role="status" hidden></p>';
    const note = form.querySelector(".review-note");
    const show = (kind, text) => {
      note.className = "review-note" + (kind ? " is-" + kind : "");
      note.textContent = text;
      note.hidden = !text;
    };
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const checked = form.querySelector('input[name="rating"]:checked');
      if (!checked) return show("err", "1 ile 5 arasında puan seçin.");
      const body = form.elements.body.value.trim();
      if (body.length < 10) return show("err", "Yorumunuz en az 10 karakter olmalı.");
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        const res = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            token,
            productId: item.productId,
            rating: Number(checked.value),
            title: form.elements.title.value.trim(),
            body,
            hideName: form.elements.hideName.checked,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "Değerlendirme kaydedilemedi.");
        form.replaceWith(doneNote(data.status));
      } catch (err) {
        show("err", err.message || "Değerlendirme kaydedilemedi.");
        btn.disabled = false;
      }
    });
    return form;
  }

  function renderItems(items) {
    listEl.textContent = "";
    items.forEach((item, index) => {
      const card = el("article", "review-card");
      const title = el("h2", "review-product");
      if (item.urlPath) {
        const link = el("a", "", item.name);
        link.href = item.urlPath;
        title.appendChild(link);
      } else {
        title.textContent = item.name;
      }
      card.appendChild(title);
      card.appendChild(item.review ? doneNote(item.review.status) : buildForm(item, index));
      listEl.appendChild(card);
    });
  }

  async function load() {
    if (!orderId || !token) {
      showStatus("err", "Değerlendirme bağlantısı eksik. Lütfen teslimat e-postasındaki bağlantıyı kullanın.");
      return;
    }
    try {
      const res = await fetch(
        "/api/reviews/order?siparis=" + encodeURIComponent(orderId) + "&token=" + encodeURIComponent(token),
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Sipariş yüklenemedi.");
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) throw new Error("Bu siparişte değerlendirilecek ürün yok.");
      showStatus("", "Sipariş " + data.orderId + " · Her ürün için ayrı değerlendirme yapabilirsiniz.");
      renderItems(items);
    } catch (err) {
      showStatus("err", err.message || "Sipariş yüklenemedi.");
    }
  }

  load();
})();
