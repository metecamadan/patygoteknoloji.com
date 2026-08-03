(function () {
  "use strict";

  const TOKEN_KEY = "patygo_admin_token";
  const THEME_KEY = "patygo_admin_theme";
  const IDLE_MS = 30 * 60 * 1000;
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let products = [];
  let selectedIndex = -1;
  let currentImages = [];
  let supplierProducts = [];
  let supplierSlots = [];
  let feedStatus = null;
  let idleTimer = null;
  const selectedSupplierSkus = new Set();
  const MIN_PRODUCT_IMAGES = 5;
  const MAX_PRODUCT_IMAGES = 10;
  const imageCountHint = document.getElementById("imageCountHint");
  const saveProductBtn = document.getElementById("saveProductBtn");

  function isDarkTheme() {
    return document.documentElement.classList.contains("admin-theme-dark");
  }

  function applyAdminTheme(dark) {
    document.documentElement.classList.toggle("admin-theme-dark", !!dark);
    document.body.classList.toggle("admin-theme-dark", !!dark);
    const toggle = document.getElementById("adminThemeToggle");
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(!!dark));
      const label = toggle.querySelector(".admin-theme-toggle-label");
      if (label) label.textContent = dark ? "Light" : "Dark";
      toggle.title = dark ? "Açık temaya geç" : "Koyu temaya geç";
    }
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch (_) {}
  }

  applyAdminTheme(isDarkTheme() || (function () {
    try {
      return localStorage.getItem(THEME_KEY) === "dark";
    } catch (_) {
      return false;
    }
  })());

  const themeToggle = document.getElementById("adminThemeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      applyAdminTheme(!isDarkTheme());
    });
  }

  function countProductImages(product) {
    const list = Array.isArray(product && product.images)
      ? product.images.filter(Boolean)
      : product && product.image
        ? [product.image]
        : [];
    return list.length;
  }

  function assertManualProductsHaveGallery(list) {
    const badImages = (list || []).find(
      (product) => countProductImages(product) < MIN_PRODUCT_IMAGES
    );
    if (badImages) {
      throw new Error(
        (badImages.name || badImages.id || "Ürün") +
          ": panelden manuel kayıt için en az " +
          MIN_PRODUCT_IMAGES +
          " görsel zorunlu (şu an " +
          countProductImages(badImages) +
          ")."
      );
    }
    const badFeed = (list || []).find((product) => {
      return !(
        product &&
        product.id &&
        product.name &&
        product.brand &&
        product.manufacturerCode &&
        product.barcode &&
        product.gtipCode &&
        product.mainCategory &&
        product.midCategory &&
        product.subCategory &&
        Number.isFinite(Number(product.stockQty)) &&
        [1, 8, 10, 20].includes(Number(product.vatPercent)) &&
        product.currency &&
        product.unit &&
        product.description &&
        Number(product.price) > 0
      );
    });
    if (badFeed) {
      throw new Error(
        (badFeed.name || badFeed.id || "Ürün") +
          ": feed için zorunlu alanlar eksik (barkod, üretici kodu, kategori ağacı, stok, KDV vb.)."
      );
    }
  }

  function syncSaveButtonState() {
    if (!saveProductBtn) return;
    const imagesReady = currentImages.filter(Boolean).length >= MIN_PRODUCT_IMAGES;
    const requiredText = [
      fields.id,
      fields.brand,
      fields.name,
      fields.price,
      fields.manufacturerCode,
      fields.barcode,
      fields.gtip,
      fields.mainCategory,
      fields.midCategory,
      fields.subCategory,
      fields.stock,
      fields.vat,
      fields.currency,
      fields.unit,
      fields.description,
    ];
    const feedReady = requiredText.every((el) => el && String(el.value || "").trim() !== "");
    const priceOk = Number(fields.price && fields.price.value) > 0;
    const vatOk = [1, 8, 10, 20].includes(Number(fields.vat && fields.vat.value));
    const ready = imagesReady && feedReady && priceOk && vatOk;
    saveProductBtn.disabled = !ready;
    saveProductBtn.title = ready
      ? ""
      : !imagesReady
        ? "Kaydetmek için en az " + MIN_PRODUCT_IMAGES + " görsel yükleyin"
        : !vatOk
          ? "KDV oranı seçin (1, 8, 10 veya 20)"
          : "Feed için zorunlu alanları doldurun";
  }
  const loginView = document.getElementById("loginView");
  const panelView = document.getElementById("panelView");
  const loginForm = document.getElementById("loginForm");
  const loginNote = document.getElementById("loginNote");
  const productList = document.getElementById("productList");
  const productForm = document.getElementById("productForm");
  const formNote = document.getElementById("formNote");
  const catalogNote = document.getElementById("catalogNote");
  const formTitle = document.getElementById("formTitle");
  const productFormModal = document.getElementById("productFormModal");
  const productCount = document.getElementById("productCount");
  const imagePreview = document.getElementById("imagePreview");
  const productSearch = document.getElementById("productSearch");
  const productCategoryFilter = document.getElementById("productCategoryFilter");
  const productStatusFilter = document.getElementById("productStatusFilter");
  const supplierRows = document.getElementById("supplierProductRows");
  const supplierSearch = document.getElementById("supplierSearch");
  const supplierStatusFilter = document.getElementById("supplierStatusFilter");
  const supplierSlotFilter = document.getElementById("supplierSlotFilter");

  function openProductModal() {
    if (!productFormModal) return;
    productFormModal.hidden = false;
    document.body.classList.add("admin-modal-open");
  }

  function closeProductModal() {
    if (!productFormModal) return;
    productFormModal.hidden = true;
    document.body.classList.remove("admin-modal-open");
  }

  function isProductModalOpen() {
    return productFormModal && !productFormModal.hidden;
  }

  const fields = {
    editIndex: document.getElementById("editIndex"),
    id: document.getElementById("pId"),
    brand: document.getElementById("pBrand"),
    name: document.getElementById("pName"),
    price: document.getElementById("pPrice"),
    category: document.getElementById("pCategory"),
    description: document.getElementById("pDescription"),
    details: document.getElementById("pDetails"),
    imageFile: document.getElementById("pImageFile"),
    featured: document.getElementById("pFeatured"),
    active: document.getElementById("pActive"),
    manufacturerCode: document.getElementById("pManufacturerCode"),
    barcode: document.getElementById("pBarcode"),
    gtip: document.getElementById("pGtip"),
    specialCode: document.getElementById("pSpecialCode"),
    stock: document.getElementById("pStock"),
    vat: document.getElementById("pVat"),
    currency: document.getElementById("pCurrency"),
    unit: document.getElementById("pUnit"),
    mainCategory: document.getElementById("pMainCategory"),
    midCategory: document.getElementById("pMidCategory"),
    subCategory: document.getElementById("pSubCategory"),
  };

  const CATEGORY_FEED_DEFAULTS = {
    bilgisayar: {
      mainCategory: "KİŞİSEL BİLGİSAYARLAR",
      midCategory: "Taşınabilir Bilgisayarlar",
      subCategory: "Notebooklar",
    },
    yazici: {
      mainCategory: "YAZICILAR VE ÇEVRE BİRİMLERİ",
      midCategory: "Yazıcılar",
      subCategory: "Ofis Yazıcıları",
    },
    "kucuk-ev": {
      mainCategory: "EV ALETLERİ",
      midCategory: "Küçük Ev Aletleri",
      subCategory: "Genel",
    },
    "beyaz-esya": {
      mainCategory: "BEYAZ EŞYA",
      midCategory: "Soğutma",
      subCategory: "Buzdolabı",
    },
  };

  function applyCategoryDefaults(force) {
    const tree = CATEGORY_FEED_DEFAULTS[fields.category.value] || CATEGORY_FEED_DEFAULTS.bilgisayar;
    if (force || !fields.mainCategory.value.trim()) fields.mainCategory.value = tree.mainCategory;
    if (force || !fields.midCategory.value.trim()) fields.midCategory.value = tree.midCategory;
    if (force || !fields.subCategory.value.trim()) fields.subCategory.value = tree.subCategory;
  }

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
      throw new Error("Paneli file:// ile açmayın. https://patygoteknoloji.com/admin veya yerel sunucu /admin kullanın.");
    }
    const opts = options || {};
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const ctrl = new AbortController();
    const isSupplierRefresh = path.includes("/supplier/refresh");
    const timer = setTimeout(
      () => ctrl.abort(),
      Number(opts.timeout) || (isSupplierRefresh ? 60000 : 12000)
    );
    try {
      const res = await fetch(path, Object.assign({}, opts, { headers, signal: ctrl.signal }));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && token && !path.includes("/api/admin/login")) {
        endSession("Oturum süresi doldu. Tekrar giriş yapın.");
        throw new Error("Oturum süresi doldu. Tekrar giriş yapın.");
      }
      if (!res.ok) throw new Error(data.error || "İstek başarısız (" + res.status + ")");
      touchActivity();
      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error(
          isSupplierRefresh
            ? "XML çekimi zaman aşımına uğradı. Tedarikçi IP whitelist / firewall ayarını kontrol edin."
            : "İstek zaman aşımına uğradı. Lütfen tekrar deneyin."
        );
      }
      if (err && err.message && /Failed to fetch|NetworkError|Load failed|fetch/i.test(err.message)) {
        throw new Error(
          isSupplierRefresh
            ? "XML bağlantısı kesildi. Sunucu tedarikçiye bağlanamıyor olabilir (IP whitelist)."
            : "API isteği başarısız oldu (" + path + "). Sayfayı yenileyip tekrar deneyin."
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function endSession(message) {
    token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    showPanel(false);
    if (message) note(loginNote, "err", message);
  }

  function touchActivity() {
    if (!token) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      endSession("Oturum 30 dakika işlem yapılmadığı için sonlandırıldı.");
    }, IDLE_MS);
  }

  function showPanel(on) {
    loginView.hidden = !!on;
    panelView.hidden = !on;
    loginView.classList.toggle("is-hidden", !!on);
    panelView.classList.toggle("is-hidden", !on);
    document.body.classList.toggle("admin-authed", !!on);
    if (on) touchActivity();
    else if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function selectAdminTab(name, focus) {
    const tabs = Array.from(document.querySelectorAll(".admin-nav > [data-admin-tab]"));
    const pageMeta = {
      overview: ["Genel Bakış", "Trafik, talepler, siparişler ve katalog durumu."],
      calendar: ["Takvim", "Hatırlatıcı ve notları gün bazında yönetin."],
      orders: ["Siparişler", "Ödeme durumu, müşteri ve kalemleri yönetin."],
      users: ["Kullanıcılar", "Panel girişi için ad, soyad, e-posta ve şifre yönetin."],
      products: ["Ürünler", "Sol menüden Manuel veya XML ürünlerine geçin."],
      xml: ["XML Yönetimi", "Tedarikçi ürünlerini ve Akakçe yayınını yönetin."],
    };
    const productsMeta = {
      manual: ["Manuel Ürünler", "Katalogdaki manuel ürünleri ekleyin ve düzenleyin."],
      xml: ["XML Ürünleri", "Tedarikçi XML havuzundaki ürünleri yönetin."],
    };
    tabs.forEach((tab) => {
      const selected = tab.dataset.adminTab === name;
      tab.classList.toggle("active", selected);
      if (selected) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
      const panelId = tab.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) panel.hidden = !selected;
      if (selected && focus) tab.focus();
    });
    const productsChildren = document.getElementById("productsNavChildren");
    const productsTabBtn = document.getElementById("productsTab");
    if (productsChildren) productsChildren.hidden = name !== "products";
    if (productsTabBtn) productsTabBtn.setAttribute("aria-expanded", String(name === "products"));
    let meta = pageMeta[name] || pageMeta.overview;
    if (name === "products") {
      let view = "manual";
      try {
        const saved = sessionStorage.getItem("patygo_products_view");
        if (saved === "manual" || saved === "xml") view = saved;
      } catch (_) {}
      meta = productsMeta[view] || productsMeta.manual;
    }
    document.getElementById("adminPageTitle").textContent = meta[0];
    document.getElementById("adminPageSubtitle").textContent = meta[1];
    const newProductBtn = document.getElementById("newProductBtn");
    if (newProductBtn && name !== "products") newProductBtn.hidden = true;
    if (name === "xml" && token) loadSupplierData().catch(() => {});
    if (name === "overview" && token) loadDigitalDashboard().catch(() => {});
    if (name === "calendar" && token) {
      loadCalendarMonth().catch(() => {});
      ensureCalendarNotificationPermission().catch(() => {});
    }
    if (name === "users" && token) loadAdminUsers().catch(() => {});
    if (name === "orders" && token) loadAdminOrders().catch(() => {});
    try {
      sessionStorage.setItem("patygo_admin_tab", name);
    } catch (_) {}
  }

  document.querySelectorAll(".admin-nav > [data-admin-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      selectAdminTab(tab.dataset.adminTab, false);
      if (tab.dataset.adminTab === "products") {
        let view = "manual";
        try {
          const saved = sessionStorage.getItem("patygo_products_view");
          if (saved === "manual" || saved === "xml") view = saved;
        } catch (_) {}
        selectProductsView(view, false);
      }
    });
  });

  document.querySelectorAll("[data-open-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      selectAdminTab(button.dataset.openAdminTab, false);
      if (button.dataset.openAdminTab === "products") {
        const view = button.dataset.openProductsView || "manual";
        selectProductsView(view, false);
        if (view === "manual") emptyForm();
      }
    });
  });

  let initialAdminTab = "overview";
  try {
    const saved = sessionStorage.getItem("patygo_admin_tab");
    if (["overview", "calendar", "products", "xml"].includes(saved)) initialAdminTab = saved;
  } catch (_) {}
  selectAdminTab(initialAdminTab, false);

  function selectProductsView(name) {
    const view = name === "xml" ? "xml" : "manual";
    const viewMeta = {
      manual: ["Manuel Ürünler", "Katalogdaki manuel ürünleri ekleyin ve düzenleyin."],
      xml: ["XML Ürünleri", "Tedarikçi XML havuzundaki ürünleri yönetin."],
    };
    document.querySelectorAll(".admin-nav-children [data-products-view]").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.productsView === view);
    });
    const manualView = document.getElementById("manualProductsView");
    const xmlView = document.getElementById("xmlProductsView");
    if (manualView) manualView.hidden = view !== "manual";
    if (xmlView) xmlView.hidden = view !== "xml";
    const meta = viewMeta[view];
    document.getElementById("adminPageTitle").textContent = meta[0];
    document.getElementById("adminPageSubtitle").textContent = meta[1];
    const newProductBtn = document.getElementById("newProductBtn");
    if (newProductBtn) newProductBtn.hidden = view !== "manual";
    if (view === "xml") {
      renderSupplierProducts();
      if (token) loadSupplierData().catch(() => {});
    }
    try {
      sessionStorage.setItem("patygo_products_view", view);
    } catch (_) {}
  }

  document.querySelectorAll(".admin-nav-children [data-products-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      selectAdminTab("products", false);
      selectProductsView(tab.dataset.productsView);
    });
  });

  let initialProductsView = "manual";
  try {
    if (sessionStorage.getItem("patygo_products_view") === "xml") {
      initialProductsView = "xml";
    }
  } catch (_) {}
  selectProductsView(initialProductsView);

  function renderImagePreviews() {
    imagePreview.textContent = "";
    imagePreview.hidden = currentImages.length === 0;
    if (imageCountHint) {
      const count = currentImages.length;
      imageCountHint.textContent =
        count +
        " / " +
        MIN_PRODUCT_IMAGES +
        " görsel" +
        (count < MIN_PRODUCT_IMAGES
          ? " — en az " + (MIN_PRODUCT_IMAGES - count) + " görsel daha ekleyin"
          : count > MAX_PRODUCT_IMAGES
            ? " — en fazla " + MAX_PRODUCT_IMAGES + " görsel"
            : " — hazır");
      imageCountHint.classList.toggle("err", count < MIN_PRODUCT_IMAGES);
    }
    syncSaveButtonState();
    currentImages.forEach((url, index) => {
      const item = document.createElement("div");
      item.className = "admin-preview-item";
      item.draggable = true;
      item.dataset.index = String(index);

      const img = document.createElement("img");
      img.src = url;
      img.alt = "Ürün görseli " + (index + 1);

      const badge = document.createElement("span");
      badge.textContent = index === 0 ? "Kapak" : String(index + 1);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", "Görseli kaldır");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        currentImages.splice(index, 1);
        renderImagePreviews();
      });

      item.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", String(index));
      });
      item.addEventListener("dragover", (ev) => ev.preventDefault());
      item.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const from = Number(ev.dataTransfer.getData("text/plain"));
        if (!Number.isInteger(from) || from === index || !currentImages[from]) return;
        const moved = currentImages.splice(from, 1)[0];
        currentImages.splice(index, 0, moved);
        renderImagePreviews();
      });

      item.appendChild(img);
      item.appendChild(badge);
      item.appendChild(remove);
      imagePreview.appendChild(item);
    });
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
    fields.manufacturerCode.value = "";
    fields.barcode.value = "";
    fields.gtip.value = "";
    fields.specialCode.value = "";
    fields.stock.value = "0";
    fields.vat.value = "";
    fields.currency.value = "TRY";
    fields.unit.value = "ADET";
    applyCategoryDefaults(true);
    currentImages = [];
    fields.imageFile.value = "";
    fields.featured.checked = true;
    fields.active.checked = true;
    imagePreview.hidden = true;
    renderImagePreviews();
    formTitle.textContent = "Yeni ürün";
    note(formNote, "", "");
    syncSaveButtonState();
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
    fields.manufacturerCode.value = p.manufacturerCode || "";
    fields.barcode.value = p.barcode || "";
    fields.gtip.value = p.gtipCode || "";
    fields.specialCode.value = p.specialCode || "";
    fields.stock.value = Number.isFinite(Number(p.stockQty)) ? Number(p.stockQty) : 0;
    fields.vat.value = [1, 8, 10, 20].includes(Number(p.vatPercent))
      ? String(Number(p.vatPercent))
      : "";
    fields.currency.value = p.currency || "TRY";
    fields.unit.value = p.unit || "ADET";
    fields.mainCategory.value = p.mainCategory || "";
    fields.midCategory.value = p.midCategory || "";
    fields.subCategory.value = p.subCategory || "";
    applyCategoryDefaults(false);
    currentImages = Array.isArray(p.images)
      ? p.images.filter(Boolean).slice(0, MAX_PRODUCT_IMAGES)
      : p.image
        ? [p.image]
        : [];
    fields.featured.checked = !!p.featured;
    fields.active.checked = p.active !== false;
    formTitle.textContent = "Ürünü düzenle";
    renderImagePreviews();
    note(formNote, "", "");
    syncSaveButtonState();
  }

  function renderList() {
    productList.textContent = "";
    const query = String(productSearch && productSearch.value ? productSearch.value : "")
      .trim()
      .toLocaleLowerCase("tr-TR");
    const category = productCategoryFilter ? productCategoryFilter.value : "";
    const status = productStatusFilter ? productStatusFilter.value : "";
    const entries = products
      .map((product, index) => ({
        product: Object.assign({}, product, { source: "manual" }),
        index,
      }));
    const visible = entries.filter(({ product }) => {
        const haystack = [product.id, product.name, product.brand]
          .join(" ")
          .toLocaleLowerCase("tr-TR");
        if (query && !haystack.includes(query)) return false;
        if (category && product.category !== category) return false;
        if (status === "active" && product.active === false) return false;
        if (status === "inactive" && product.active !== false) return false;
        return true;
      });
    productCount.textContent = visible.length + " / " + entries.length + " ürün";
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "admin-table-empty";
      empty.textContent = entries.length
        ? "Filtrelere uygun ürün bulunamadı."
        : "Henüz ürün yok. Yeni ürün ekleyebilir veya XML’den aktarabilirsiniz.";
      productList.appendChild(empty);
      updateDashboard();
      return;
    }
    visible.forEach(({ product: p, index }) => {
      const row = document.createElement("div");
      row.className =
        "admin-item" +
        (p.source === "manual" && index === selectedIndex ? " active" : "");
      const primaryImage =
        (Array.isArray(p.images) && p.images.find(Boolean)) || p.image || "";
      const media = primaryImage
        ? Object.assign(document.createElement("img"), { src: primaryImage, alt: p.name || "" })
        : Object.assign(document.createElement("div"), { className: "ph", textContent: "Görsel yok" });
      const meta = document.createElement("button");
      meta.type = "button";
      meta.className = "admin-item-meta";
      const strong = document.createElement("strong");
      strong.textContent = p.name;
      const small = document.createElement("small");
      small.textContent =
        (p.source === "supplier" ? "XML · " : "Manuel · ") +
        p.brand +
        " · " +
        money(p.price) +
        " (hariç) · %" +
        (Number.isFinite(Number(p.vatPercent)) ? Number(p.vatPercent) : 20) +
        " KDV · " +
        p.category;
      meta.appendChild(strong);
      meta.appendChild(small);

      const quick = document.createElement("div");
      quick.className = "admin-item-quick";
      const statusText = document.createElement("span");
      statusText.className = "admin-badge " + (p.active !== false ? "on" : "off");
      statusText.textContent = p.active !== false ? "Aktif" : "Pasif";
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "admin-switch";
      toggleLabel.setAttribute("aria-label", p.name + " yayın durumunu değiştir");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = p.active !== false;
      const track = document.createElement("span");
      toggle.addEventListener("change", async () => {
        toggle.disabled = true;
        try {
          if (p.source === "supplier") {
            await updateSupplierProducts([
              {
                supplierSku: p.supplierSku,
                supplierSlot: p.supplierSlot,
                active: toggle.checked,
              },
            ]);
            notifySite();
            note(
              catalogNote || formNote,
              "ok",
              p.name + (toggle.checked ? " yayına alındı." : " pasife alındı.")
            );
          } else {
            const next = products.slice();
            next[index] = Object.assign({}, next[index], { active: toggle.checked });
            await persist(
              next,
              p.name + (toggle.checked ? " yayına alındı." : " pasife alındı.")
            );
          }
        } catch (err) {
          toggle.checked = !toggle.checked;
          note(catalogNote || formNote, "err", err.message || "Durum güncellenemedi.");
        } finally {
          toggle.disabled = false;
        }
      });
      toggleLabel.appendChild(toggle);
      toggleLabel.appendChild(track);
      quick.appendChild(statusText);
      quick.appendChild(toggleLabel);

      row.appendChild(media);
      row.appendChild(meta);
      row.appendChild(quick);
      meta.addEventListener("click", () => {
        if (p.source === "supplier") {
          supplierSearch.value = p.supplierSku || p.name;
          selectAdminTab("products", false);
          selectProductsView("xml", false);
          renderSupplierProducts();
        } else {
          fillForm(p, index);
          openProductModal();
          renderList();
        }
      });
      productList.appendChild(row);
    });
    updateDashboard();
  }

  function formatDate(value) {
    if (!value) return "Henüz yok";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Henüz yok"
      : date.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
  }

  function formatMoney(amount) {
    return (
      "₺" +
      Math.round(Number(amount) || 0).toLocaleString("tr-TR", {
        maximumFractionDigits: 0,
      })
    );
  }

  function formatDelta(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return "önceki döneme göre —";
    const sign = value > 0 ? "+" : "";
    return "önceki döneme göre " + sign + value + "%";
  }

  function formatUptime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return d + "g " + h + "s";
    if (h) return h + "s " + m + "dk";
    return m + " dk";
  }

  function renderDigitalDashboard(payload) {
    const analytics = (payload && payload.analytics) || {};
    const commerce = (payload && payload.commerce) || {};
    const server = (payload && payload.server) || {};
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const live =
      (payload && payload.ok === true) ||
      server.status === "online" ||
      Boolean(server.checkedAt);

    setText("dashVisitors", String(analytics.visitors || 0));
    setText("dashPageViews", String(analytics.pageViews || 0));
    setText("dashVisitorsDelta", formatDelta(analytics.comparison && analytics.comparison.visitorsPercent));
    setText("dashPageViewsDelta", formatDelta(analytics.comparison && analytics.comparison.pageViewsPercent));
    setText("dashLeads", String(analytics.leads || 0));
    setText("dashOrdersPaid", String(commerce.ordersPaid || 0));
    setText(
      "dashOrdersMeta",
      "başarısız " +
        (commerce.ordersFailed || 0) +
        " · bekleyen " +
        (commerce.ordersPending || 0)
    );
    setText("dashRevenue", formatMoney(commerce.revenue || 0));
    setText("dashAov", formatMoney(commerce.aov || 0));
    setText("dashAddToCart", String(analytics.addToCart || 0));
    setText("dashCheckoutStarted", String(analytics.checkoutStarted || 0));
    setText("dashOrdersFailed", String(commerce.ordersFailed || 0));
    setText("dashOrdersPending", String(commerce.ordersPending || 0));
    setText("dashConversionRate", "%" + (analytics.conversionRate || 0));

    const noteEl = document.getElementById("dashLeadsNote");
    if (noteEl) {
      noteEl.textContent =
        payload.leadsNote ||
        "Talep sayısı, formun başarıyla gönderildiği anları sayar.";
    }

    const status = document.getElementById("dashServerStatus");
    if (status) {
      status.className = "admin-status " + (live ? "on" : payload && payload.loadError ? "err" : "pending");
      status.textContent = live ? "Online" : payload && payload.loadError ? "Veri alınamadı" : "Yükleniyor";
    }
    const serverNote = document.getElementById("dashServerNote");
    if (serverNote) {
      if (payload && payload.loadError) {
        serverNote.hidden = false;
        serverNote.textContent =
          "Site ayakta olabilir; panel özeti şu an çekilemedi: " + payload.loadError;
      } else {
        serverNote.hidden = true;
        serverNote.textContent = "";
      }
    }
    setText("dashUptime", live ? formatUptime(server.uptimeSec) : "—");
    setText("dashMemory", live && server.memoryMB != null ? server.memoryMB + " MB" : "—");
    setText("dashNode", live ? server.node || "—" : "—");
    const pos = server.pos || {};
    setText(
      "dashPos",
      live
        ? pos.enabled
          ? "Akbank " + (pos.testMode ? "TEST" : "CANLI")
          : "Yapılandırılmadı"
        : "—"
    );
    setText("dashCheckedAt", live ? formatDate(server.checkedAt) : "—");

    const spark = document.getElementById("dashSpark");
    if (spark) {
      spark.innerHTML = "";
      const daily = Array.isArray(analytics.daily) ? analytics.daily : [];
      const values = daily.map((d) => Number(d.pageViews) || 0);
      const max = Math.max(1, values.length ? Math.max.apply(null, values) : 1);
      daily.slice(-21).forEach((day) => {
        const bar = document.createElement("span");
        const h = Math.max(4, Math.round(((Number(day.pageViews) || 0) / max) * 80));
        bar.style.height = h + "px";
        bar.title = day.date + ": " + (day.pageViews || 0) + " görüntüleme";
        spark.appendChild(bar);
      });
    }

    const top = document.getElementById("dashTopPages");
    if (top) {
      top.innerHTML = "";
      const pages = Array.isArray(analytics.topPages) ? analytics.topPages : [];
      if (!pages.length) {
        const empty = document.createElement("li");
        empty.innerHTML = "<span>Henüz sayfa verisi yok</span><strong>0</strong>";
        top.appendChild(empty);
      } else {
        pages.forEach((row) => {
          const li = document.createElement("li");
          const path = document.createElement("span");
          path.textContent = String(row.path || "/");
          const views = document.createElement("strong");
          views.textContent = String(row.views || 0);
          li.appendChild(path);
          li.appendChild(views);
          top.appendChild(li);
        });
      }
    }

    function fillRankList(elementId, rows, valueKey, formatValue) {
      const list = document.getElementById(elementId);
      if (!list) return;
      list.textContent = "";
      if (!rows.length) {
        const empty = document.createElement("li");
        empty.innerHTML =
          '<div class="rank-meta"><strong>Henüz veri yok</strong><span>Seçili dönemde kayıt bulunamadı</span></div><span class="rank-value">—</span>';
        list.appendChild(empty);
        return;
      }
      rows.forEach((row) => {
        const li = document.createElement("li");
        const meta = document.createElement("div");
        meta.className = "rank-meta";
        const title = document.createElement("strong");
        title.textContent = row.name || row.productId || "Ürün";
        const sub = document.createElement("span");
        sub.textContent = [row.brand, row.productId].filter(Boolean).join(" · ");
        meta.appendChild(title);
        meta.appendChild(sub);
        const value = document.createElement("span");
        value.className = "rank-value";
        value.textContent = formatValue(row[valueKey], row);
        li.appendChild(meta);
        li.appendChild(value);
        list.appendChild(li);
      });
    }

    fillRankList(
      "dashTopViewed",
      Array.isArray(analytics.topViewedProducts) ? analytics.topViewedProducts : [],
      "views",
      (views) => String(views || 0) + " görüntüleme"
    );
    fillRankList(
      "dashTopPurchased",
      Array.isArray(commerce.topPurchasedProducts) ? commerce.topPurchasedProducts : [],
      "qty",
      (qty, row) => String(qty || 0) + " adet · " + formatMoney(row.revenue || 0)
    );
  }

  const PERIOD_KEY = "patygo_admin_period";

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function defaultPeriodRange(days) {
    const to = new Date();
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - (Math.max(1, Number(days) || 30) - 1));
    return { from: isoDate(from), to: isoDate(to) };
  }

  function readSavedPeriod() {
    try {
      const raw = localStorage.getItem(PERIOD_KEY);
      if (!raw) return defaultPeriodRange(30);
      const parsed = JSON.parse(raw);
      if (parsed && parsed.from && parsed.to) return parsed;
    } catch (_) {}
    return defaultPeriodRange(30);
  }

  function savePeriod(from, to) {
    try {
      localStorage.setItem(PERIOD_KEY, JSON.stringify({ from, to }));
    } catch (_) {}
  }

  function syncPeriodInputs(from, to) {
    const fromEl = document.getElementById("dashFrom");
    const toEl = document.getElementById("dashTo");
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
  }

  function currentPeriodQuery() {
    const fromEl = document.getElementById("dashFrom");
    const toEl = document.getElementById("dashTo");
    let from = fromEl && fromEl.value;
    let to = toEl && toEl.value;
    if (!from || !to) {
      const saved = readSavedPeriod();
      from = saved.from;
      to = saved.to;
      syncPeriodInputs(from, to);
    }
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
      syncPeriodInputs(from, to);
    }
    savePeriod(from, to);
    return "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
  }

  async function loadDigitalDashboard() {
    const status = document.getElementById("dashServerStatus");
    if (status) {
      status.className = "admin-status pending";
      status.textContent = "Yükleniyor";
    }
    try {
      const data = await api("/api/admin/dashboard?" + currentPeriodQuery());
      if (data.analytics && data.analytics.from && data.analytics.to) {
        syncPeriodInputs(data.analytics.from, data.analytics.to);
        savePeriod(data.analytics.from, data.analytics.to);
      }
      const hint = document.getElementById("dashPeriodHint");
      if (hint && data.analytics) {
        hint.textContent =
          (data.analytics.from || "") +
          " → " +
          (data.analytics.to || "") +
          " (" +
          (data.analytics.periodDays || 0) +
          " gün). Trafik en fazla 90 gün saklanır.";
      }
      renderDigitalDashboard(data);
    } catch (err) {
      renderDigitalDashboard({
        ok: false,
        loadError: (err && err.message) || "Dashboard yüklenemedi.",
        analytics: {},
        commerce: {},
        server: { status: "unknown" },
        leadsNote: (err && err.message) || "Dashboard yüklenemedi.",
      });
    }
  }

  function resolveFeedUrl() {
    return (
      (feedStatus && feedStatus.publicUrl) ||
      location.origin + "/api/feeds/akakce.xml"
    );
  }

  async function copyFeedUrl(noteEl) {
    const url = resolveFeedUrl();
    const input =
      document.getElementById("feedUrl") ||
      document.getElementById("dashboardFeedUrl");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else if (input) {
        input.focus();
        input.select();
        document.execCommand("copy");
      } else {
        throw new Error("clipboard unavailable");
      }
      note(noteEl, "ok", "Akakçe XML bağlantısı kopyalandı.");
    } catch (_) {
      if (input) {
        input.focus();
        input.select();
      }
      note(noteEl, "err", "Bağlantı kopyalanamadı: " + url);
    }
  }

  function syncFeedUrlUi() {
    const absoluteFeedUrl = resolveFeedUrl();
    const feedUrlInput = document.getElementById("feedUrl");
    if (feedUrlInput) {
      feedUrlInput.value = absoluteFeedUrl;
    }
    const feedOpenBtn = document.getElementById("feedOpenBtn");
    if (feedOpenBtn) feedOpenBtn.href = absoluteFeedUrl;

    const dashUrl = document.getElementById("dashboardFeedUrl");
    if (dashUrl) dashUrl.value = absoluteFeedUrl;
    const dashOpen = document.getElementById("dashboardFeedOpenBtn");
    if (dashOpen) dashOpen.href = absoluteFeedUrl;

    const count = feedStatus ? feedStatus.activeCount || 0 : 0;
    const dashCount = document.getElementById("dashboardFeedUrlCount");
    if (dashCount) dashCount.textContent = String(count);
    const dashStatus = document.getElementById("dashboardFeedUrlStatus");
    const dashBadge = document.getElementById("dashboardFeedBadge");
    if (dashStatus) {
      dashStatus.textContent =
        count > 0
          ? count + " ürün yayında"
          : "Feed hazır · henüz uygun ürün yok";
    }
    if (dashBadge) {
      dashBadge.className = "admin-status " + (count > 0 ? "on" : "pending");
      dashBadge.textContent = count > 0 ? "Yayında" : "Hazır";
    }
  }

  function updateDashboard() {
    const activeManual = products.filter((item) => item.active !== false).length;
    const activeSupplier = supplierProducts.filter((item) => item.active).length;
    const configuredSlots = supplierSlots.filter((slot) => slot.configured);
    const failedSlots = supplierSlots.filter((slot) => slot.lastFetchStatus === "error");
    const latestFetch = supplierSlots
      .map((slot) => slot.lastFetchAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    document.getElementById("dashboardProductCount").textContent = String(products.length);
    document.getElementById("dashboardActiveCount").textContent = String(
      activeManual + activeSupplier
    );
    document.getElementById("dashboardSupplierCount").textContent = String(
      supplierProducts.length
    );
    document.getElementById("dashboardFeedCount").textContent = String(
      feedStatus ? feedStatus.activeCount : activeManual + activeSupplier
    );
    const badge = document.getElementById("dashboardXmlStatus");
    badge.className =
      "admin-status " +
      (failedSlots.length ? "err" : configuredSlots.length ? "on" : "pending");
    badge.textContent = failedSlots.length
      ? failedSlots.length + " bağlantıda hata"
      : configuredSlots.length
        ? configuredSlots.length + " / 3 bağlı"
        : "Yapılandırılmadı";
    document.getElementById("dashboardLastSync").textContent = formatDate(latestFetch);
    document.getElementById("dashboardXmlHost").textContent =
      configuredSlots.length ? configuredSlots.length + " XML kaynağı" : "Tanımlanmadı";
    document.getElementById("dashboardMargin").textContent =
      configuredSlots.length
        ? configuredSlots.map((slot) => "%" + slot.globalMarginPercent).join(" · ")
        : "%15";
    syncFeedUrlUi();
  }

  function renderSupplierStatus() {
    supplierSlots.forEach((slot) => {
      const card = document.querySelector('[data-supplier-card="' + slot.id + '"]');
      if (!card) return;
      const failed = slot.lastFetchStatus === "error";
      const field = (name) => card.querySelector('[data-slot-field="' + name + '"]');
      const input = (name) => card.querySelector('[data-slot-input="' + name + '"]');
      const badge = field("badge");
      badge.className =
        "admin-status " + (failed ? "err" : slot.configured ? "on" : "pending");
      badge.textContent = failed
        ? "Senkron hatası"
        : slot.configured
          ? "Bağlantı kayıtlı"
          : "Yapılandırılmadı";
      field("title").textContent = slot.name;
      field("maskedUrl").textContent = slot.maskedUrl || "Tanımlanmadı";
      field("lastSync").textContent = formatDate(slot.lastFetchAt);
      field("itemCount").textContent = String(slot.itemCount || 0);
      input("name").value = slot.name;
      input("margin").value = String(slot.globalMarginPercent);
      note(field("note"), failed ? "err" : "", failed ? slot.lastError : "");
      const option = supplierSlotFilter.querySelector('option[value="' + slot.id + '"]');
      if (option) option.textContent = slot.name;
    });
    if (feedStatus) {
      document.getElementById("feedActiveCount").textContent = String(feedStatus.activeCount || 0);
      const catalogActive = document.getElementById("feedCatalogActiveCount");
      if (catalogActive) {
        catalogActive.textContent = String(
          feedStatus.catalogActiveCount != null
            ? feedStatus.catalogActiveCount
            : (feedStatus.activeCount || 0) + (feedStatus.excludedCount || 0)
        );
      }
      document.getElementById("feedSourceCounts").textContent =
        String(feedStatus.supplierActiveCount || 0) +
        " / " +
        String(feedStatus.manualActiveCount || 0);
      const feedBadge = document.getElementById("feedStatusBadge");
      const eligible = feedStatus.activeCount || 0;
      const excluded = feedStatus.excludedCount || 0;
      feedBadge.className =
        "admin-status " + (eligible > 0 ? "on" : excluded > 0 ? "err" : "pending");
      feedBadge.textContent =
        eligible > 0
          ? "Feed hazır"
          : excluded > 0
            ? excluded + " ürün feed dışı"
            : "Uygun ürün yok";
      const warnings = document.getElementById("feedWarnings");
      warnings.textContent = "";
      const reasonCounts = feedStatus.reasonCounts || {};
      const reasonEntries = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
      const showDiagnostics = eligible === 0 || excluded > 0;
      warnings.hidden = !showDiagnostics;
      if (showDiagnostics) {
        const summary = document.createElement("strong");
        if (excluded > 0) {
          summary.textContent =
            excluded +
            " aktif ürün feed’e alınmadı" +
            (reasonEntries.length
              ? " (" +
                reasonEntries
                  .map(([reason, count]) => reason + ": " + count)
                  .join("; ") +
                ")."
              : ".");
        } else {
          summary.textContent =
            "Katalogda feed’e uygun aktif ürün yok. Ürünleri aktif edin veya XML’den çekip yayınlayın.";
        }
        warnings.appendChild(summary);
        if ((feedStatus.issues || []).length) {
          const list = document.createElement("ul");
          feedStatus.issues.slice(0, 5).forEach((issue) => {
            const item = document.createElement("li");
            item.textContent = issue.name + ": " + issue.reasons.join(", ");
            list.appendChild(item);
          });
          warnings.appendChild(list);
        }
      }
    }
    syncFeedUrlUi();
    updateDashboard();
  }

  function filteredSupplierProducts() {
    const query = String(supplierSearch && supplierSearch.value ? supplierSearch.value : "")
      .trim()
      .toLocaleLowerCase("tr-TR");
    const status = supplierStatusFilter ? supplierStatusFilter.value : "";
    const slotId = supplierSlotFilter ? supplierSlotFilter.value : "";
    return supplierProducts.filter((item) => {
      const haystack = [item.supplierSku, item.name, item.brand, item.supplierName]
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      if (query && !haystack.includes(query)) return false;
      if (slotId && item.supplierSlot !== slotId) return false;
      if (status === "active" && !item.active) return false;
      if (status === "inactive" && item.active) return false;
      if (status === "stock" && !(item.stockQty === null || Number(item.stockQty) > 0)) {
        return false;
      }
      return true;
    });
  }

  function renderSupplierProducts() {
    supplierRows.textContent = "";
    const visible = filteredSupplierProducts();
    document.getElementById("supplierVisibleCount").textContent =
      visible.length + " / " + supplierProducts.length + " ürün";
    if (!visible.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 9;
      cell.className = "admin-table-empty";
      cell.textContent = supplierProducts.length
        ? "Filtrelere uygun XML ürünü bulunamadı."
        : "XML bağlantısını kaydedip ürünleri güncelleyin.";
      row.appendChild(cell);
      supplierRows.appendChild(row);
      updateDashboard();
      return;
    }

    visible.forEach((item) => {
      const row = document.createElement("tr");
      const selectionKey = item.supplierSlot + "|" + item.supplierSku;
      const checkCell = document.createElement("td");
      checkCell.className = "admin-check-col";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selectedSupplierSkus.has(selectionKey);
      check.setAttribute("aria-label", item.name + " ürününü seç");
      check.addEventListener("change", () => {
        if (check.checked) selectedSupplierSkus.add(selectionKey);
        else selectedSupplierSkus.delete(selectionKey);
      });
      checkCell.appendChild(check);

      const productCell = document.createElement("td");
      const product = document.createElement("div");
      product.className = "admin-table-product";
      const media = item.image
        ? Object.assign(document.createElement("img"), {
            src: item.image,
            alt: item.name || "",
            loading: "lazy",
          })
        : Object.assign(document.createElement("div"), {
            className: "ph",
            textContent: (item.brand || "?").slice(0, 3),
          });
      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.name;
      const brand = document.createElement("span");
      brand.textContent = item.brand + " · " + item.category;
      text.appendChild(title);
      text.appendChild(brand);
      product.appendChild(media);
      product.appendChild(text);
      productCell.appendChild(product);

      const skuCell = document.createElement("td");
      skuCell.textContent = item.supplierSku;
      const sourceCell = document.createElement("td");
      sourceCell.textContent = item.supplierName || item.supplierSlot;
      const costCell = document.createElement("td");
      costCell.textContent = money(item.costPrice);
      const marginCell = document.createElement("td");
      const marginInput = document.createElement("input");
      marginInput.className = "admin-margin-input";
      marginInput.type = "number";
      marginInput.min = "0";
      marginInput.max = "500";
      marginInput.step = "0.1";
      marginInput.value =
        item.marginOverride === null ? "" : String(item.marginOverride);
      marginInput.placeholder = String(item.marginPercent);
      marginInput.title = "Boş bırakırsanız genel kâr oranı kullanılır";
      marginInput.addEventListener("change", async () => {
        marginInput.disabled = true;
        try {
          await updateSupplierProducts([
            {
              supplierSku: item.supplierSku,
              supplierSlot: item.supplierSlot,
              marginPercent: marginInput.value || null,
            },
          ]);
          note(
            document.getElementById("supplierProductsNote"),
            "ok",
            "Ürüne özel kâr oranı güncellendi."
          );
        } catch (err) {
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        } finally {
          marginInput.disabled = false;
        }
      });
      marginCell.appendChild(marginInput);
      const saleCell = document.createElement("td");
      const saleInput = document.createElement("input");
      saleInput.className = "admin-price-input";
      saleInput.type = "number";
      saleInput.min = "0";
      saleInput.step = "0.01";
      saleInput.value = String(item.salePrice);
      saleInput.title = "Boş bırakırsanız genel kâr oranı kullanılır";
      saleInput.addEventListener("change", async () => {
        saleInput.disabled = true;
        try {
          await updateSupplierProducts([
            {
              supplierSku: item.supplierSku,
              supplierSlot: item.supplierSlot,
              salePrice: saleInput.value || null,
            },
          ]);
          note(document.getElementById("supplierProductsNote"), "ok", "Özel satış fiyatı güncellendi.");
        } catch (err) {
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        } finally {
          saleInput.disabled = false;
        }
      });
      saleCell.appendChild(saleInput);

      const stockCell = document.createElement("td");
      stockCell.textContent = item.stockQty === null ? "—" : String(item.stockQty);
      const activeCell = document.createElement("td");
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "admin-switch";
      toggleLabel.setAttribute("aria-label", item.name + " yayın durumunu değiştir");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = !!item.active;
      const track = document.createElement("span");
      toggle.addEventListener("change", async () => {
        toggle.disabled = true;
        try {
          await updateSupplierProducts([
            {
              supplierSku: item.supplierSku,
              supplierSlot: item.supplierSlot,
              active: toggle.checked,
            },
          ]);
          notifySite();
          note(
            document.getElementById("supplierProductsNote"),
            "ok",
            toggle.checked
              ? "Ürün site ve Akakçe XML’i için aktif edildi."
              : "Ürün site ve Akakçe XML’inden kaldırıldı."
          );
        } catch (err) {
          toggle.checked = !toggle.checked;
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        } finally {
          toggle.disabled = false;
        }
      });
      toggleLabel.appendChild(toggle);
      toggleLabel.appendChild(track);
      activeCell.appendChild(toggleLabel);

      [
        checkCell,
        productCell,
        skuCell,
        sourceCell,
        costCell,
        marginCell,
        saleCell,
        stockCell,
        activeCell,
      ].forEach((cell) => row.appendChild(cell));
      supplierRows.appendChild(row);
    });
    updateDashboard();
  }

  async function loadSupplierData() {
    const results = await Promise.all([
      api("/api/admin/supplier/status"),
      api("/api/admin/supplier/products"),
    ]);
    supplierSlots = Array.isArray(results[0].slots)
      ? results[0].slots
      : Array.isArray(results[1].slots)
        ? results[1].slots
        : [];
    feedStatus = results[0].feed || null;
    supplierProducts = Array.isArray(results[1].products) ? results[1].products : [];
    renderSupplierStatus();
    renderSupplierProducts();
    renderList();
  }

  async function updateSupplierProducts(updates) {
    const data = await api("/api/admin/supplier/products", {
      method: "PATCH",
      body: JSON.stringify({ updates }),
    });
    supplierProducts = Array.isArray(data.products) ? data.products : supplierProducts;
    await loadSupplierData();
  }

  async function refresh() {
    const data = await api("/api/admin/products");
    products = Array.isArray(data.products) ? data.products : [];
    renderList();
  }

  function notifySite() {
    const stamp = String(Date.now());
    try {
      localStorage.setItem("patygo_catalog_version", stamp);
    } catch (_) {}
    try {
      const bc = new BroadcastChannel("patygo-catalog");
      bc.postMessage({ type: "updated", at: stamp });
      bc.close();
    } catch (_) {}
  }

  async function persist(list, msg) {
    assertManualProductsHaveGallery(list);
    const data = await api("/api/admin/products", {
      method: "PUT",
      body: JSON.stringify({ products: list }),
    });
    products = data.products || list;
    renderList();
    notifySite();
    const target = isProductModalOpen() ? formNote : catalogNote;
    note(
      target || formNote,
      "ok",
      (msg || "Kaydedildi.") + " Site ile senkron: ürünler / ana sayfa anında güncellenir."
    );
  }

  [productSearch, productCategoryFilter, productStatusFilter].forEach(
    (control) => {
    if (!control) return;
    control.addEventListener(control.tagName === "INPUT" ? "input" : "change", renderList);
    }
  );
  [supplierSearch, supplierStatusFilter, supplierSlotFilter].forEach((control) => {
    if (!control) return;
    control.addEventListener(
      control.tagName === "INPUT" ? "input" : "change",
      renderSupplierProducts
    );
  });

  document.querySelectorAll(".supplier-config-form").forEach((form) => {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const slotId = form.dataset.slotId;
      const card = form.closest("[data-supplier-card]");
      const urlInput = form.querySelector('[data-slot-input="url"]');
      const nameInput = form.querySelector('[data-slot-input="name"]');
      const statusNote = card.querySelector('[data-slot-field="note"]');
      const button = form.querySelector('button[type="submit"]');
      if (!urlInput.value.trim()) {
        note(statusNote, "err", "XML bağlantısını girin.");
        return;
      }
      button.disabled = true;
      note(statusNote, "", "Bağlantı güvenli şekilde kaydediliyor…");
      try {
        await api("/api/admin/supplier/config", {
          method: "PUT",
          body: JSON.stringify({
            slotId,
            url: urlInput.value.trim(),
            name: nameInput.value.trim(),
          }),
        });
        urlInput.value = "";
        await loadSupplierData();
        note(statusNote, "ok", "Bağlantı kaydedildi. XML’i Güncelle ile ürünleri alın.");
      } catch (err) {
        note(statusNote, "err", err.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".supplier-refresh-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const slotId = button.dataset.slotId;
      const card = button.closest("[data-supplier-card]");
      const statusNote = card.querySelector('[data-slot-field="note"]');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "XML alınıyor…";
      note(statusNote, "", "Tedarikçi kataloğu güncelleniyor…");
      try {
        await api("/api/admin/supplier/refresh", {
          method: "POST",
          body: JSON.stringify({ slotId }),
          timeout: 60000,
        });
        selectedSupplierSkus.clear();
        await loadSupplierData();
        notifySite();
        const count = supplierProducts.filter((item) => item.supplierSlot === slotId).length;
        note(statusNote, "ok", count + " ürün bu XML kaynağından güncellendi.");
      } catch (err) {
        await loadSupplierData().catch(() => {});
        const slot = supplierSlots.find((item) => item.id === slotId);
        const serverError = slot && slot.lastError ? String(slot.lastError) : "";
        note(statusNote, "err", serverError || err.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  });

  document.querySelectorAll(".supplier-settings-form").forEach((form) => {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const slotId = form.dataset.slotId;
      const card = form.closest("[data-supplier-card]");
      const statusNote = card.querySelector('[data-slot-field="note"]');
      const margin = Number(form.querySelector('[data-slot-input="margin"]').value);
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api("/api/admin/supplier/settings", {
          method: "PUT",
          body: JSON.stringify({ slotId, globalMarginPercent: margin }),
        });
        await loadSupplierData();
        notifySite();
        note(statusNote, "ok", "Bu XML kaynağının genel kâr oranı güncellendi.");
      } catch (err) {
        note(statusNote, "err", err.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.getElementById("feedCopyBtn").addEventListener("click", () => {
    copyFeedUrl(document.getElementById("feedNote"));
  });
  const dashboardFeedCopyBtn = document.getElementById("dashboardFeedCopyBtn");
  if (dashboardFeedCopyBtn) {
    dashboardFeedCopyBtn.addEventListener("click", () => {
      copyFeedUrl(document.getElementById("dashboardFeedNote"));
    });
  }
  ["feedUrl", "dashboardFeedUrl"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener("focus", () => input.select());
    input.addEventListener("click", () => input.select());
  });

  document.getElementById("supplierSelectAll").addEventListener("change", (ev) => {
    const checked = ev.currentTarget.checked;
    filteredSupplierProducts().forEach((item) => {
      const key = item.supplierSlot + "|" + item.supplierSku;
      if (checked) selectedSupplierSkus.add(key);
      else selectedSupplierSkus.delete(key);
    });
    renderSupplierProducts();
  });

  async function bulkSupplierStatus(active) {
    if (!selectedSupplierSkus.size) {
      note(document.getElementById("supplierProductsNote"), "err", "Önce ürün seçin.");
      return;
    }
    try {
      await updateSupplierProducts(
        Array.from(selectedSupplierSkus).map((key) => {
          const separator = key.indexOf("|");
          return {
            supplierSlot: key.slice(0, separator),
            supplierSku: key.slice(separator + 1),
            active,
          };
        })
      );
      selectedSupplierSkus.clear();
      document.getElementById("supplierSelectAll").checked = false;
      notifySite();
      note(
        document.getElementById("supplierProductsNote"),
        "ok",
        active
          ? "Seçilen ürünler site ve Akakçe XML’i için aktif edildi."
          : "Seçilen ürünler pasife alındı."
      );
    } catch (err) {
      note(document.getElementById("supplierProductsNote"), "err", err.message);
    }
  }

  document
    .getElementById("supplierBulkEnable")
    .addEventListener("click", () => bulkSupplierStatus(true));
  document
    .getElementById("supplierBulkDisable")
    .addEventListener("click", () => bulkSupplierStatus(false));

  loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    note(loginNote, "", "Giriş yapılıyor…");
    try {
      const emailEl = document.getElementById("loginEmail");
      const email = emailEl ? String(emailEl.value || "").trim() : "";
      const payload = { password: document.getElementById("password").value };
      if (email) payload.email = email;
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      showPanel(true);
      await Promise.all([refresh(), loadSupplierData(), loadDigitalDashboard(), loadCalendarMonth()]);
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
    endSession("");
  });

  ["pointerdown", "keydown", "mousemove", "touchstart", "scroll", "click"].forEach((eventName) => {
    document.addEventListener(eventName, touchActivity, { passive: true });
  });

  document.getElementById("newProductBtn").addEventListener("click", () => {
    selectAdminTab("products", false);
    selectProductsView("manual", false);
    emptyForm();
    openProductModal();
    renderList();
    if (fields.name) fields.name.focus();
  });

  function wireProductModalClose() {
    const closers = [
      document.getElementById("closeProductModalBtn"),
      document.getElementById("cancelProductModalBtn"),
      ...document.querySelectorAll("[data-close-product-modal]"),
    ];
    closers.forEach((el) => {
      if (!el) return;
      el.addEventListener("click", () => closeProductModal());
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && isProductModalOpen()) {
        closeProductModal();
      }
    });
  }
  wireProductModalClose();

  fields.category.addEventListener("change", () => {
    applyCategoryDefaults(true);
    syncSaveButtonState();
  });
  Object.values(fields).forEach((el) => {
    if (!el || el === fields.imageFile || el === fields.editIndex) return;
    el.addEventListener("input", syncSaveButtonState);
    el.addEventListener("change", syncSaveButtonState);
  });

  fields.imageFile.addEventListener("change", async () => {
    const files = Array.from(fields.imageFile.files || []).slice(
      0,
      Math.max(0, MAX_PRODUCT_IMAGES - currentImages.length)
    );
    if (!files.length) return;
    note(formNote, "", files.length + " görsel yükleniyor…");
    try {
      for (const file of files) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const uploaded = await api("/api/admin/upload", {
          method: "POST",
          body: JSON.stringify({
            dataUrl,
            name: fields.id.value || file.name,
          }),
        });
        const url = String(uploaded.url || "");
        currentImages.push(url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "/" + url);
      }
      fields.imageFile.value = "";
      renderImagePreviews();
      note(formNote, "ok", files.length + " görsel yüklendi.");
    } catch (err) {
      note(formNote, "err", err.message || "Görsel yüklenemedi");
    }
  });

  productForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (currentImages.filter(Boolean).length < MIN_PRODUCT_IMAGES) {
      note(
        formNote,
        "err",
        "Panelden manuel ürün kaydı için en az " + MIN_PRODUCT_IMAGES + " görsel ekleyin."
      );
      syncSaveButtonState();
      return;
    }
    const vatPercent = Number(fields.vat.value);
    if (![1, 8, 10, 20].includes(vatPercent)) {
      note(formNote, "err", "KDV oranı zorunludur. 1, 8, 10 veya 20 seçin.");
      if (fields.vat) fields.vat.focus();
      syncSaveButtonState();
      return;
    }
    const item = {
      id: fields.id.value.trim(),
      brand: fields.brand.value.trim(),
      name: fields.name.value.trim(),
      price: Number(fields.price.value),
      category: fields.category.value,
      description: fields.description.value.trim(),
      details: fields.details.value.trim(),
      image: currentImages[0] || "",
      images: currentImages.slice(0, MAX_PRODUCT_IMAGES),
      featured: fields.featured.checked,
      active: fields.active.checked,
      manufacturerCode: fields.manufacturerCode.value.trim(),
      barcode: fields.barcode.value.trim(),
      gtipCode: fields.gtip.value.trim(),
      specialCode: fields.specialCode.value.trim(),
      stockQty: Number(fields.stock.value),
      vatPercent,
      currency: fields.currency.value,
      unit: fields.unit.value.trim() || "ADET",
      mainCategory: fields.mainCategory.value.trim(),
      midCategory: fields.midCategory.value.trim(),
      subCategory: fields.subCategory.value.trim(),
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
      closeProductModal();
      renderList();
    } catch (err) {
      note(formNote, "err", err.message || "Silinemedi");
    }
  });

  const calendarGrid = document.getElementById("calendarGrid");
  const calendarMonthLabel = document.getElementById("calendarMonthLabel");
  const calendarSelectedLabel = document.getElementById("calendarSelectedLabel");
  const calendarEntryList = document.getElementById("calendarEntryList");
  const calendarEntryForm = document.getElementById("calendarEntryForm");
  const calendarNote = document.getElementById("calendarNote");
  const calendarEditId = document.getElementById("calendarEditId");
  const calendarEntryType = document.getElementById("calendarEntryType");
  const calendarEntryTime = document.getElementById("calendarEntryTime");
  const calendarEntryTitle = document.getElementById("calendarEntryTitle");
  const calendarEntryBody = document.getElementById("calendarEntryBody");
  const calendarNotifyEmail = document.getElementById("calendarNotifyEmail");
  const calendarNotifyEmailField = document.getElementById("calendarNotifyEmailField");
  const calendarDeleteBtn = document.getElementById("calendarDeleteBtn");

  let calendarCursor = new Date();
  calendarCursor.setDate(1);
  calendarCursor.setHours(12, 0, 0, 0);
  let calendarSelectedDate = toIsoDate(new Date());
  let calendarEntries = [];

  function toIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseIsoDate(value) {
    const parts = String(value || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return new Date();
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }

  function monthBounds(cursor) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const from = toIsoDate(new Date(year, month, 1, 12));
    const to = toIsoDate(new Date(year, month + 1, 0, 12));
    return { from, to };
  }

  function syncCalendarNotifyEmailVisibility() {
    const isReminder = !calendarEntryType || calendarEntryType.value === "reminder";
    if (calendarNotifyEmailField) calendarNotifyEmailField.hidden = !isReminder;
    if (calendarNotifyEmail) calendarNotifyEmail.required = isReminder;
  }

  function resetCalendarForm() {
    if (!calendarEntryForm) return;
    calendarEditId.value = "";
    calendarEntryType.value = "reminder";
    calendarEntryTime.value = "";
    calendarEntryTitle.value = "";
    calendarEntryBody.value = "";
    if (calendarNotifyEmail) calendarNotifyEmail.value = "";
    if (calendarDeleteBtn) calendarDeleteBtn.hidden = true;
    syncCalendarNotifyEmailVisibility();
    note(calendarNote, "", "");
  }

  function fillCalendarForm(entry) {
    calendarEditId.value = entry.id || "";
    calendarEntryType.value = entry.type === "note" ? "note" : "reminder";
    calendarEntryTime.value = entry.time || "";
    calendarEntryTitle.value = entry.title || "";
    calendarEntryBody.value = entry.body || "";
    if (calendarNotifyEmail) calendarNotifyEmail.value = entry.notifyEmail || "";
    if (calendarDeleteBtn) calendarDeleteBtn.hidden = !entry.id;
    syncCalendarNotifyEmailVisibility();
  }

  function entriesForDate(dateKey) {
    return calendarEntries.filter((entry) => entry.date === dateKey);
  }

  function renderCalendarEntries() {
    if (!calendarEntryList || !calendarSelectedLabel) return;
    const day = parseIsoDate(calendarSelectedDate);
    calendarSelectedLabel.textContent = day.toLocaleDateString("tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    calendarEntryList.textContent = "";
    const dayEntries = entriesForDate(calendarSelectedDate);
    if (!dayEntries.length) {
      const empty = document.createElement("li");
      empty.className = "admin-table-empty";
      empty.textContent = "Bu gün için kayıt yok. Aşağıdan ekleyin.";
      calendarEntryList.appendChild(empty);
      return;
    }
    dayEntries.forEach((entry) => {
      const item = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "admin-calendar-entry" +
        (calendarEditId && calendarEditId.value === entry.id ? " is-active" : "") +
        (entry.done ? " is-done" : "");
      const badge = document.createElement("span");
      badge.className = "admin-calendar-badge " + (entry.type === "note" ? "note" : "reminder");
      badge.textContent = entry.type === "note" ? "Not" : "Hatırlatıcı";
      const strong = document.createElement("strong");
      strong.textContent = entry.title;
      const small = document.createElement("small");
      small.textContent =
        (entry.time ? entry.time + " · " : "") +
        (entry.notifyEmail ? entry.notifyEmail + " · " : "") +
        (entry.body ? entry.body.slice(0, 80) : "Detay yok");
      btn.appendChild(badge);
      btn.appendChild(strong);
      btn.appendChild(small);
      btn.addEventListener("click", () => {
        fillCalendarForm(entry);
        renderCalendarEntries();
      });
      item.appendChild(btn);
      calendarEntryList.appendChild(item);
    });
  }

  function renderCalendarGrid() {
    if (!calendarGrid || !calendarMonthLabel) return;
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    calendarMonthLabel.textContent = calendarCursor.toLocaleDateString("tr-TR", {
      month: "long",
      year: "numeric",
    });
    const first = new Date(year, month, 1, 12);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(year, month, 1 - startOffset, 12);
    const todayKey = toIsoDate(new Date());
    calendarGrid.textContent = "";
    for (let i = 0; i < 42; i += 1) {
      const cellDate = new Date(start);
      cellDate.setDate(start.getDate() + i);
      const key = toIsoDate(cellDate);
      const inMonth = cellDate.getMonth() === month;
      const dayEntries = entriesForDate(key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "admin-calendar-day" +
        (inMonth ? "" : " is-muted") +
        (key === todayKey ? " is-today" : "") +
        (key === calendarSelectedDate ? " is-selected" : "");
      btn.setAttribute("role", "gridcell");
      btn.setAttribute("aria-label", key);
      const num = document.createElement("span");
      num.className = "admin-calendar-day-num";
      num.textContent = String(cellDate.getDate());
      btn.appendChild(num);
      if (dayEntries.length) {
        const dots = document.createElement("span");
        dots.className = "admin-calendar-dots";
        const shown = dayEntries.slice(0, 4);
        shown.forEach((entry) => {
          const dot = document.createElement("span");
          dot.className = "admin-calendar-dot " + (entry.type === "note" ? "note" : "reminder");
          dots.appendChild(dot);
        });
        btn.appendChild(dots);
        if (dayEntries.length > 1) {
          const count = document.createElement("span");
          count.className = "admin-calendar-day-count";
          count.textContent = dayEntries.length + " kayıt";
          btn.appendChild(count);
        }
      }
      btn.addEventListener("click", () => {
        calendarSelectedDate = key;
        resetCalendarForm();
        renderCalendarGrid();
        renderCalendarEntries();
      });
      calendarGrid.appendChild(btn);
    }
  }

  async function loadCalendarMonth() {
    if (!calendarGrid) return;
    const { from, to } = monthBounds(calendarCursor);
    const data = await api(
      "/api/admin/calendar?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)
    );
    calendarEntries = Array.isArray(data.entries) ? data.entries : [];
    const selectedMonth = calendarSelectedDate.slice(0, 7);
    const cursorMonth =
      calendarCursor.getFullYear() +
      "-" +
      String(calendarCursor.getMonth() + 1).padStart(2, "0");
    if (selectedMonth !== cursorMonth) {
      calendarSelectedDate = from;
    }
    renderCalendarGrid();
    renderCalendarEntries();
  }

  if (calendarEntryForm) {
    document.getElementById("calendarPrevMonth").addEventListener("click", () => {
      calendarCursor.setMonth(calendarCursor.getMonth() - 1);
      loadCalendarMonth().catch((err) => note(calendarNote, "err", err.message || "Yüklenemedi"));
    });
    document.getElementById("calendarNextMonth").addEventListener("click", () => {
      calendarCursor.setMonth(calendarCursor.getMonth() + 1);
      loadCalendarMonth().catch((err) => note(calendarNote, "err", err.message || "Yüklenemedi"));
    });
    document.getElementById("calendarTodayBtn").addEventListener("click", () => {
      const now = new Date();
      calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1, 12);
      calendarSelectedDate = toIsoDate(now);
      resetCalendarForm();
      loadCalendarMonth().catch((err) => note(calendarNote, "err", err.message || "Yüklenemedi"));
    });
    document.getElementById("calendarResetBtn").addEventListener("click", () => {
      resetCalendarForm();
      renderCalendarEntries();
    });
    calendarDeleteBtn.addEventListener("click", async () => {
      const id = calendarEditId.value;
      if (!id) return;
      if (!confirm("Bu kaydı silmek istediğinize emin misiniz?")) return;
      try {
        await api("/api/admin/calendar/" + id, { method: "DELETE" });
        resetCalendarForm();
        await loadCalendarMonth();
        note(calendarNote, "ok", "Kayıt silindi.");
      } catch (err) {
        note(calendarNote, "err", err.message || "Silinemedi");
      }
    });
    calendarEntryForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const payload = {
        date: calendarSelectedDate,
        type: calendarEntryType.value,
        title: calendarEntryTitle.value.trim(),
        body: calendarEntryBody.value.trim(),
        time: calendarEntryTime.value || null,
      };
      if (payload.type === "reminder") {
        payload.notifyEmail = calendarNotifyEmail ? calendarNotifyEmail.value.trim() : "";
      }
      try {
        const editId = calendarEditId.value;
        if (editId) {
          await api("/api/admin/calendar/" + editId, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          note(calendarNote, "ok", "Kayıt güncellendi.");
        } else {
          const created = await api("/api/admin/calendar", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          let msg = "Kayıt eklendi.";
          if (payload.type === "reminder") {
            if (created && created.mailSent) msg = "Kayıt eklendi; hatırlatma e-postası gönderildi.";
            else if (created && created.mailError) {
              msg = "Kayıt eklendi ancak e-posta gönderilemedi: " + created.mailError;
            }
          }
          note(calendarNote, created && created.mailError ? "err" : "ok", msg);
        }
        resetCalendarForm();
        await loadCalendarMonth();
        checkBrowserCalendarReminders();
      } catch (err) {
        note(calendarNote, "err", err.message || "Kaydedilemedi");
      }
    });

    if (calendarEntryType) {
      calendarEntryType.addEventListener("change", syncCalendarNotifyEmailVisibility);
      syncCalendarNotifyEmailVisibility();
    }

    const notifyBtn = document.getElementById("calendarNotifyPermissionBtn");
    if (notifyBtn) {
      notifyBtn.addEventListener("click", async () => {
        const ok = await ensureCalendarNotificationPermission(true);
        note(
          calendarNote,
          ok ? "ok" : "err",
          ok
            ? "Tarayıcı bildirimleri açık. Panel açıkken saat gelince uyarı çıkar."
            : "Bildirim izni verilmedi. Tarayıcı ayarlarından izin vermeniz gerekir."
        );
      });
    }
  }

  function browserNotifyStorageKey(id) {
    return "patygo_calendar_browser_notified_" + id;
  }

  async function ensureCalendarNotificationPermission(forceAsk) {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    if (!forceAsk && Notification.permission === "default") return false;
    try {
      const result = await Notification.requestPermission();
      return result === "granted";
    } catch (_) {
      return false;
    }
  }

  function istanbulClock(nowDate) {
    const date = nowDate || new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
    const hour = Number(parts.hour === "24" ? "0" : parts.hour);
    const minute = Number(parts.minute);
    return {
      date: parts.year + "-" + parts.month + "-" + parts.day,
      minutes: hour * 60 + minute,
    };
  }

  function checkBrowserCalendarReminders() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!Array.isArray(calendarEntries) || !calendarEntries.length) return;
    const clock = istanbulClock(new Date());
    calendarEntries.forEach((entry) => {
      if (!entry || entry.type !== "reminder" || entry.done) return;
      if (entry.date !== clock.date) return;
      let key;
      try {
        key = browserNotifyStorageKey(entry.id);
        if (localStorage.getItem(key)) return;
      } catch (_) {
        return;
      }
      const time = entry.time || "09:00";
      const bits = String(time).split(":").map(Number);
      if (bits.length < 2 || !Number.isFinite(bits[0]) || !Number.isFinite(bits[1])) return;
      const scheduled = bits[0] * 60 + bits[1];
      if (clock.minutes < scheduled || clock.minutes >= scheduled + 2) return;
      try {
        const n = new Notification("Takvim hatırlatıcı: " + entry.title, {
          body: (entry.time ? entry.time + " · " : "") + (entry.body || "Patygo panel hatırlatıcısı"),
          tag: "patygo-calendar-" + entry.id,
        });
        n.onclick = () => {
          window.focus();
          selectAdminTab("calendar", false);
          calendarSelectedDate = entry.date;
          fillCalendarForm(entry);
          renderCalendarGrid();
          renderCalendarEntries();
        };
        localStorage.setItem(key, new Date().toISOString());
      } catch (_) {}
    });
  }

  setInterval(() => {
    if (!token || loginView && !loginView.hidden) return;
    checkBrowserCalendarReminders();
  }, 30 * 1000);

  const savedPeriod = readSavedPeriod();
  syncPeriodInputs(savedPeriod.from, savedPeriod.to);

  document.querySelectorAll("[data-dash-days]").forEach((button) => {
    button.addEventListener("click", () => {
      const range = defaultPeriodRange(button.getAttribute("data-dash-days"));
      syncPeriodInputs(range.from, range.to);
      savePeriod(range.from, range.to);
      loadDigitalDashboard().catch(() => {});
    });
  });

  document.getElementById("dashApplyPeriod") &&
    document.getElementById("dashApplyPeriod").addEventListener("click", () => {
      loadDigitalDashboard().catch(() => {});
    });

  document.getElementById("dashRefreshBtn") &&
    document.getElementById("dashRefreshBtn").addEventListener("click", () => {
      loadDigitalDashboard().catch(() => {});
    });

  const adminUserList = document.getElementById("adminUserList");
  const adminUserForm = document.getElementById("adminUserForm");
  const adminUsersNote = document.getElementById("adminUsersNote");
  const adminUserEditId = document.getElementById("adminUserEditId");
  const adminUserFirstName = document.getElementById("adminUserFirstName");
  const adminUserLastName = document.getElementById("adminUserLastName");
  const adminUserEmail = document.getElementById("adminUserEmail");
  const adminUserPassword = document.getElementById("adminUserPassword");

  const adminOrderList = document.getElementById("adminOrderList");
  const adminOrdersNote = document.getElementById("adminOrdersNote");
  const adminOrderDetail = document.getElementById("adminOrderDetail");
  const adminOrderDetailTitle = document.getElementById("adminOrderDetailTitle");
  const orderStatusFilter = document.getElementById("orderStatusFilter");
  let selectedOrderId = "";

  function moneyTr(n) {
    return "₺" + Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function orderStatusLabel(status) {
    const map = {
      payment_pending: "Ödeme bekliyor",
      paid: "Ödendi",
      payment_failed: "Ödeme başarısız",
      preparing: "Hazırlanıyor",
      shipped: "Kargoda",
      cancelled: "İptal",
      refunded: "İade",
    };
    return map[status] || status || "—";
  }

  async function loadAdminOrders() {
    if (!adminOrderList || !token) return;
    const status = orderStatusFilter ? orderStatusFilter.value : "";
    const q = status ? "?status=" + encodeURIComponent(status) : "";
    const data = await api("/api/admin/orders" + q);
    const orders = (data && data.orders) || [];
    adminOrderList.textContent = "";
    if (!orders.length) {
      const empty = document.createElement("div");
      empty.className = "admin-table-empty";
      empty.textContent = "Sipariş yok.";
      adminOrderList.appendChild(empty);
      return;
    }
    orders.forEach((order) => {
      const row = document.createElement("div");
      row.className = "admin-list-item" + (selectedOrderId === order.id ? " is-active" : "");
      const main = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = order.id;
      const meta = document.createElement("span");
      const who = (order.customer && order.customer.name) || "—";
      meta.textContent =
        who + " · " + orderStatusLabel(order.status) + " · " + moneyTr(order.total);
      main.appendChild(title);
      main.appendChild(meta);
      row.appendChild(main);
      row.addEventListener("click", () => showAdminOrderDetail(order.id));
      adminOrderList.appendChild(row);
    });
  }

  async function showAdminOrderDetail(orderId) {
    selectedOrderId = orderId;
    const data = await api("/api/admin/orders/" + encodeURIComponent(orderId));
    const order = data.order;
    if (!order) return;
    if (adminOrderDetailTitle) adminOrderDetailTitle.textContent = order.id;
    const c = order.customer || {};
    const items = (order.items || [])
      .map(
        (it) =>
          "<li>" +
          (it.qty || 1) +
          "× " +
          (it.name || it.productId) +
          " — " +
          moneyTr(it.line) +
          "</li>"
      )
      .join("");
    adminOrderDetail.innerHTML =
      "<dl class='admin-xml-meta'>" +
      "<div><dt>Durum</dt><dd>" +
      orderStatusLabel(order.status) +
      "</dd></div>" +
      "<div><dt>Ödeme</dt><dd>" +
      (order.paymentStatus || "—") +
      "</dd></div>" +
      "<div><dt>Müşteri</dt><dd>" +
      (c.name || "—") +
      "</dd></div>" +
      "<div><dt>E-posta</dt><dd>" +
      (c.email || "—") +
      "</dd></div>" +
      "<div><dt>Telefon</dt><dd>" +
      (c.phone || "—") +
      "</dd></div>" +
      "<div><dt>Fatura adresi</dt><dd>" +
      (c.billingAddress || "—") +
      "</dd></div>" +
      "<div><dt>Teslimat</dt><dd>" +
      (c.shippingAddress || "—") +
      "</dd></div>" +
      "<div><dt>Toplam</dt><dd>" +
      moneyTr(order.total) +
      "</dd></div>" +
      "</dl>" +
      "<h3 style='font-size:0.95rem;margin:14px 0 8px'>Kalemler</h3><ul>" +
      (items || "<li>—</li>") +
      "</ul>" +
      "<div class='field' style='margin-top:14px'><label for='adminOrderStatus'>Durum güncelle</label>" +
      "<select id='adminOrderStatus'>" +
      ["payment_pending", "paid", "payment_failed", "preparing", "shipped", "cancelled", "refunded"]
        .map(
          (s) =>
            "<option value='" +
            s +
            "'" +
            (order.status === s ? " selected" : "") +
            ">" +
            orderStatusLabel(s) +
            "</option>"
        )
        .join("") +
      "</select></div>" +
      "<div class='admin-form-actions'><button type='button' class='btn btn-primary' id='adminOrderSaveStatus'>Kaydet</button></div>";
    const saveBtn = document.getElementById("adminOrderSaveStatus");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const status = document.getElementById("adminOrderStatus").value;
        try {
          await api("/api/admin/orders/" + encodeURIComponent(orderId), {
            method: "PATCH",
            body: JSON.stringify({ status }),
          });
          note(adminOrdersNote, "ok", "Durum güncellendi.");
          await loadAdminOrders();
          await showAdminOrderDetail(orderId);
        } catch (err) {
          note(adminOrdersNote, "err", err.message || "Güncellenemedi");
        }
      });
    }
    await loadAdminOrders();
  }

  if (orderStatusFilter) {
    orderStatusFilter.addEventListener("change", () => {
      loadAdminOrders().catch(() => {});
    });
  }

  function resetAdminUserForm() {
    if (!adminUserForm) return;
    adminUserEditId.value = "";
    adminUserFirstName.value = "";
    adminUserLastName.value = "";
    adminUserEmail.value = "";
    adminUserPassword.value = "";
    adminUserPassword.required = true;
    note(adminUsersNote, "", "");
  }

  function fillAdminUserForm(user) {
    adminUserEditId.value = user.id || "";
    adminUserFirstName.value = user.firstName || "";
    adminUserLastName.value = user.lastName || "";
    adminUserEmail.value = user.email || "";
    adminUserPassword.value = "";
    adminUserPassword.required = false;
  }

  async function loadAdminUsers() {
    if (!adminUserList || !token) return;
    const data = await api("/api/admin/users");
    const users = (data && data.users) || [];
    adminUserList.textContent = "";
    if (!users.length) {
      const empty = document.createElement("div");
      empty.className = "admin-table-empty";
      empty.textContent = "Henüz kullanıcı yok. Sağdan ilk paneli kullanıcısını ekleyin.";
      adminUserList.appendChild(empty);
      return;
    }
    users.forEach((user) => {
      const row = document.createElement("div");
      row.className = "admin-list-item";
      const main = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = user.firstName + " " + user.lastName;
      const meta = document.createElement("span");
      meta.textContent = user.email + (user.role === "owner" ? " · sahip" : "");
      main.appendChild(title);
      main.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "admin-list-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-outline btn-sm";
      editBtn.textContent = "Düzenle";
      editBtn.addEventListener("click", () => fillAdminUserForm(user));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-ghost btn-sm";
      delBtn.textContent = "Sil";
      delBtn.addEventListener("click", async () => {
        if (!confirm(user.email + " kullanıcısını silmek istiyor musunuz?")) return;
        try {
          await api("/api/admin/users/" + user.id, { method: "DELETE" });
          resetAdminUserForm();
          await loadAdminUsers();
          note(adminUsersNote, "ok", "Kullanıcı silindi.");
        } catch (err) {
          note(adminUsersNote, "err", err.message || "Silinemedi");
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(main);
      row.appendChild(actions);
      adminUserList.appendChild(row);
    });
  }

  if (adminUserForm) {
    adminUserForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const editId = adminUserEditId.value;
      const payload = {
        firstName: adminUserFirstName.value.trim(),
        lastName: adminUserLastName.value.trim(),
        email: adminUserEmail.value.trim(),
      };
      const password = adminUserPassword.value;
      if (password) payload.password = password;
      if (!editId && !password) {
        note(adminUsersNote, "err", "Yeni kullanıcı için şifre gerekli.");
        return;
      }
      try {
        if (editId) {
          await api("/api/admin/users/" + editId, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          note(adminUsersNote, "ok", "Kullanıcı güncellendi.");
        } else {
          await api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          note(adminUsersNote, "ok", "Kullanıcı eklendi.");
        }
        resetAdminUserForm();
        await loadAdminUsers();
      } catch (err) {
        note(adminUsersNote, "err", err.message || "Kaydedilemedi");
      }
    });
    const resetBtn = document.getElementById("adminUserResetBtn");
    if (resetBtn) resetBtn.addEventListener("click", resetAdminUserForm);
  }

  if (token) {
    showPanel(true);
    Promise.all([refresh(), loadSupplierData(), loadDigitalDashboard(), loadCalendarMonth()]).catch(() => {
      endSession("Oturum geçersiz. Tekrar giriş yapın.");
    });
  }
})();
