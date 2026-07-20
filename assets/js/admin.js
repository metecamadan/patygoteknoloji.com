(function () {
  "use strict";

  const TOKEN_KEY = "patygo_admin_token";
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let products = [];
  let selectedIndex = -1;

  const loginView = document.getElementById("loginView");
  const panelView = document.getElementById("panelView");
  const loginForm = document.getElementById("loginForm");
  const loginNote = document.getElementById("loginNote");
  const productList = document.getElementById("productList");
  const productForm = document.getElementById("productForm");
  const formNote = document.getElementById("formNote");
  const formTitle = document.getElementById("formTitle");
  const productCount = document.getElementById("productCount");
  const imagePreview = document.getElementById("imagePreview");

  const fields = {
    editIndex: document.getElementById("editIndex"),
    id: document.getElementById("pId"),
    brand: document.getElementById("pBrand"),
    name: document.getElementById("pName"),
    price: document.getElementById("pPrice"),
    category: document.getElementById("pCategory"),
    description: document.getElementById("pDescription"),
    details: document.getElementById("pDetails"),
    image: document.getElementById("pImage"),
    imageFile: document.getElementById("pImageFile"),
    featured: document.getElementById("pFeatured"),
    active: document.getElementById("pActive"),
  };

  function note(el, type, text) {
    el.classList.remove("ok", "err");
    if (type) el.classList.add(type);
    el.textContent = text || "";
  }

  function money(n) {
    return "₺" + Math.round(Number(n) || 0).toLocaleString("tr-TR");
  }

  async function api(path, options) {
    if (location.protocol === "file:") {
      throw new Error("Paneli file:// ile açmayın. http://127.0.0.1:5173/admin.html kullanın.");
    }
    const opts = options || {};
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(path, Object.assign({}, opts, { headers, signal: ctrl.signal }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "İstek başarısız (" + res.status + ")");
      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("Sunucu yanıt vermedi. node server.js çalışıyor mu?");
      }
      if (err && err.message && /Failed to fetch|NetworkError|fetch/i.test(err.message)) {
        throw new Error("API'ye ulaşılamadı. Adres: http://127.0.0.1:5173/admin.html");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function showPanel(on) {
    loginView.hidden = on;
    panelView.hidden = !on;
  }

  function emptyForm() {
    selectedIndex = -1;
    fields.editIndex.value = "-1";
    fields.id.value = "";
    fields.id.readOnly = false;
    fields.brand.value = "";
    fields.name.value = "";
    fields.price.value = "";
    fields.category.value = "bilgisayar";
    fields.description.value = "";
    fields.details.value = "";
    fields.image.value = "";
    fields.imageFile.value = "";
    fields.featured.checked = true;
    fields.active.checked = true;
    imagePreview.hidden = true;
    imagePreview.innerHTML = "";
    formTitle.textContent = "Yeni ürün";
    note(formNote, "", "");
  }

  function fillForm(p, index) {
    selectedIndex = index;
    fields.editIndex.value = String(index);
    fields.id.value = p.id || "";
    fields.id.readOnly = true;
    fields.brand.value = p.brand || "";
    fields.name.value = p.name || "";
    fields.price.value = p.price || 0;
    fields.category.value = p.category || "bilgisayar";
    fields.description.value = p.description || "";
    fields.details.value = p.details || "";
    fields.image.value = p.image || "";
    fields.featured.checked = !!p.featured;
    fields.active.checked = p.active !== false;
    formTitle.textContent = "Ürünü düzenle";
    if (p.image) {
      imagePreview.hidden = false;
      imagePreview.innerHTML = "";
      const img = document.createElement("img");
      img.src = p.image;
      img.alt = p.name || "";
      imagePreview.appendChild(img);
    } else {
      imagePreview.hidden = true;
      imagePreview.innerHTML = "";
    }
    note(formNote, "", "");
  }

  function renderList() {
    productList.innerHTML = "";
    productCount.textContent = products.length + " ürün";
    products.forEach((p, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-item" + (index === selectedIndex ? " active" : "");
      const media = p.image
        ? Object.assign(document.createElement("img"), { src: p.image, alt: "" })
        : Object.assign(document.createElement("div"), { className: "ph", textContent: "Görsel yok" });
      const meta = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = p.name;
      const small = document.createElement("small");
      small.textContent = p.brand + " · " + money(p.price) + " +KDV · " + p.category;
      meta.appendChild(strong);
      meta.appendChild(small);
      const badges = document.createElement("div");
      badges.className = "admin-badges";
      const a = document.createElement("span");
      a.className = "admin-badge " + (p.active !== false ? "on" : "off");
      a.textContent = p.active !== false ? "Yayında" : "Gizli";
      badges.appendChild(a);
      if (p.featured) {
        const f = document.createElement("span");
        f.className = "admin-badge";
        f.textContent = "Öne çıkan";
        badges.appendChild(f);
      }
      btn.appendChild(media);
      btn.appendChild(meta);
      btn.appendChild(badges);
      btn.addEventListener("click", () => {
        fillForm(p, index);
        renderList();
      });
      productList.appendChild(btn);
    });
  }

  async function refresh() {
    const data = await api("/api/admin/products");
    products = Array.isArray(data.products) ? data.products : [];
    renderList();
  }

  async function persist(list, msg) {
    const data = await api("/api/admin/products", {
      method: "PUT",
      body: JSON.stringify({ products: list }),
    });
    products = data.products || list;
    renderList();
    note(formNote, "ok", msg || "Kaydedildi ve yayınlandı.");
  }

  loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    note(loginNote, "", "Giriş yapılıyor…");
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: document.getElementById("password").value }),
      });
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      showPanel(true);
      await refresh();
      emptyForm();
      note(loginNote, "", "");
    } catch (err) {
      showPanel(false);
      note(loginNote, "err", err.message || "Giriş başarısız");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    showPanel(false);
  });

  document.getElementById("newProductBtn").addEventListener("click", () => {
    emptyForm();
    renderList();
  });

  fields.imageFile.addEventListener("change", async () => {
    const file = fields.imageFile.files && fields.imageFile.files[0];
    if (!file) return;
    note(formNote, "", "Görsel yükleniyor…");
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const uploaded = await api("/api/admin/upload", {
        method: "POST",
        body: JSON.stringify({ dataUrl, name: fields.id.value || file.name }),
      });
      fields.image.value = uploaded.url;
      imagePreview.hidden = false;
      imagePreview.innerHTML = "";
      const img = document.createElement("img");
      img.src = uploaded.url;
      img.alt = "";
      imagePreview.appendChild(img);
      note(formNote, "ok", "Görsel yüklendi.");
    } catch (err) {
      note(formNote, "err", err.message || "Görsel yüklenemedi");
    }
  });

  productForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const item = {
      id: fields.id.value.trim(),
      brand: fields.brand.value.trim(),
      name: fields.name.value.trim(),
      price: Number(fields.price.value),
      category: fields.category.value,
      description: fields.description.value.trim(),
      details: fields.details.value.trim(),
      image: fields.image.value.trim(),
      featured: fields.featured.checked,
      active: fields.active.checked,
    };
    const next = products.slice();
    const idx = Number(fields.editIndex.value);
    if (idx >= 0 && next[idx]) next[idx] = item;
    else {
      if (next.some((p) => p.id === item.id)) {
        note(formNote, "err", "Bu ürün kodu zaten var.");
        return;
      }
      next.push(item);
    }
    try {
      await persist(next, "Ürün kaydedildi ve sitede yayınlandı.");
      const newIdx = next.findIndex((p) => p.id === item.id);
      fillForm(next[newIdx], newIdx);
      renderList();
    } catch (err) {
      note(formNote, "err", err.message || "Kayıt başarısız");
    }
  });

  document.getElementById("deleteBtn").addEventListener("click", async () => {
    const idx = Number(fields.editIndex.value);
    if (idx < 0 || !products[idx]) {
      note(formNote, "err", "Silinecek ürün seçin.");
      return;
    }
    if (!confirm("Bu ürünü silmek istediğinize emin misiniz?")) return;
    const next = products.slice();
    next.splice(idx, 1);
    try {
      await persist(next, "Ürün silindi.");
      emptyForm();
      renderList();
    } catch (err) {
      note(formNote, "err", err.message || "Silinemedi");
    }
  });

  if (token) {
    showPanel(true);
    refresh().catch(() => {
      token = "";
      sessionStorage.removeItem(TOKEN_KEY);
      showPanel(false);
    });
  }
})();
