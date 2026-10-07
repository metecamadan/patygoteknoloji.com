(function () {
  "use strict";

  const TOKEN_KEY = "patygo_admin_token";
  const THEME_KEY = "patygo_admin_theme";
  const IDLE_MS = 30 * 60 * 1000;
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let products = [];
  let selectedIndex = -1;
  let currentImages = [];
  let supplierFeedImages = [];
  let supplierProducts = [];
  let supplierPoolMeta = { total: 0, page: 1, totalPages: 1, catalogCount: 0, activeCount: 0 };
  let supplierSlots = [];
  let feedStatus = null;
  let idleTimer = null;
  let siteCategories = [];
  let supplierPoolPage = 1;
  const POOL_PAGE_SIZE = 50;
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
      if (label) label.textContent = dark ? "Açık" : "Koyu";
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

  /** /admin is served no-store; a different admin-login.js token there means this tab runs an older panel build. */
  const PANEL_BUILD = (function () {
    const el = document.querySelector('script[src*="/assets/js/admin-login.js"]');
    const match = el && /[?&]v=([\w-]+)/.exec(el.getAttribute("src") || "");
    return match ? match[1] : "";
  })();
  let panelOutdated = false;

  function showPanelOutdatedBanner() {
    if (document.getElementById("adminUpdateBanner")) return;
    const banner = document.createElement("div");
    banner.id = "adminUpdateBanner";
    banner.className = "admin-update-banner";
    banner.setAttribute("role", "alert");
    const text = document.createElement("span");
    text.innerHTML =
      "<strong>Panel güncellendi.</strong> Bu sekme eski sürümde çalışıyor; banka işlemleri kapalı. Devam etmek için yenileyin.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Yenile";
    btn.addEventListener("click", () => window.location.reload());
    banner.appendChild(text);
    banner.appendChild(btn);
    document.body.insertBefore(banner, document.body.firstChild);
  }

  async function checkPanelBuild() {
    if (panelOutdated || !PANEL_BUILD) return panelOutdated;
    try {
      const res = await fetch("/admin", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return false;
      const match = /admin-login\.js\?v=([\w-]+)/.exec(await res.text());
      if (match && match[1] !== PANEL_BUILD) {
        panelOutdated = true;
        showPanelOutdatedBanner();
      }
    } catch (_) {}
    return panelOutdated;
  }

  checkPanelBuild();
  setInterval(checkPanelBuild, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkPanelBuild();
  });

  const SORT_STORAGE_PREFIX = "patygo_sort_";
  const sortCollator = new Intl.Collator("tr", { numeric: true, sensitivity: "base" });

  // Header click cycles A→Z, Z→A, then back to the list's default order.
  function setupSortableHeader(head, name, onChange) {
    const cells = head ? Array.from(head.querySelectorAll("[data-sort-key]")) : [];
    const keys = cells.map((cell) => cell.getAttribute("data-sort-key"));
    const storageKey = SORT_STORAGE_PREFIX + name;
    let state = null;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && keys.includes(saved.key)) state = { key: saved.key, dir: saved.dir === "desc" ? "desc" : "asc" };
    } catch (_) {}

    function paint() {
      cells.forEach((cell) => {
        const key = cell.getAttribute("data-sort-key");
        const dir = state && state.key === key ? state.dir : "";
        const btn = cell.querySelector(".admin-sort-btn");
        if (cell.tagName === "TH") {
          if (dir) cell.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
          else cell.removeAttribute("aria-sort");
        }
        btn.setAttribute("data-dir", dir);
        btn.querySelector(".admin-sort-state").textContent =
          dir === "asc" ? " (artan sıralı)" : dir === "desc" ? " (azalan sıralı)" : "";
        btn.title = dir === "asc" ? "Azalan sırala" : dir === "desc" ? "Varsayılan sıraya dön" : "Artan sırala";
      });
    }

    cells.forEach((cell) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-sort-btn";
      while (cell.firstChild) btn.appendChild(cell.firstChild);
      const icon = document.createElement("span");
      icon.className = "admin-sort-icon";
      icon.setAttribute("aria-hidden", "true");
      const srState = document.createElement("span");
      srState.className = "sr-only admin-sort-state";
      btn.append(icon, srState);
      cell.appendChild(btn);
      btn.addEventListener("click", () => {
        const key = cell.getAttribute("data-sort-key");
        if (!state || state.key !== key) state = { key, dir: "asc" };
        else if (state.dir === "asc") state = { key, dir: "desc" };
        else state = null;
        try {
          if (state) localStorage.setItem(storageKey, JSON.stringify(state));
          else localStorage.removeItem(storageKey);
        } catch (_) {}
        paint();
        onChange(state);
      });
    });
    paint();

    return {
      apply(params) {
        if (state) {
          params.set("sort", state.key);
          params.set("dir", state.dir);
        }
        return params;
      },
      // Client-side variant for short, unpaged lists; blanks stay last in both directions.
      sortList(list, valueOf) {
        if (!state || !valueOf[state.key]) return list.slice();
        const read = valueOf[state.key];
        const sign = state.dir === "desc" ? -1 : 1;
        const blank = (v) => v === null || v === undefined || v === "";
        return list
          .map((row, index) => ({ row, index, value: read(row) }))
          .sort((x, y) => {
            if (blank(x.value) || blank(y.value)) {
              return blank(x.value) === blank(y.value) ? x.index - y.index : blank(x.value) ? 1 : -1;
            }
            const diff =
              typeof x.value === "number" && typeof y.value === "number"
                ? x.value - y.value
                : sortCollator.compare(String(x.value), String(y.value));
            return sign * diff || x.index - y.index;
          })
          .map((entry) => entry.row);
      },
    };
  }

  const supplierSort = setupSortableHeader(document.getElementById("supplierProductHead"), "supplier", () => {
    supplierPoolPage = 1;
    loadSupplierData().catch((err) => note(document.getElementById("supplierProductsNote"), "err", err.message));
  });
  const unlistedSort = setupSortableHeader(document.getElementById("adminUnlistedHead"), "unlisted", () => {
    unlistedPage = 1;
    loadUnlistedProducts().catch(() => {});
  });
  const productPoolSort = setupSortableHeader(document.getElementById("productPoolHead"), "pool", () => {
    productPoolPage = 1;
    loadProductPool().catch((err) => note(document.getElementById("productPoolNote"), "err", err.message));
  });
  const orderSort = setupSortableHeader(document.getElementById("adminOrderListHead"), "orders", () => {
    loadAdminOrders().catch(() => {});
  });
  const couponSort = setupSortableHeader(document.getElementById("couponTableHead"), "coupons", () => {
    renderCouponTable(adminCoupons);
  });

  const adminOpsHealth = document.getElementById("adminOpsHealth");
  if (adminOpsHealth) {
    adminOpsHealth.addEventListener("click", () => {
      const action = adminOpsHealth.getAttribute("data-action");
      if (action === "xml") selectAdminTab("xml");
      else if (action === "overview") selectAdminTab("overview");
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
  const passwordChangeGate = document.getElementById("passwordChangeGate");
  const passwordChangeForm = document.getElementById("passwordChangeForm");
  const passwordChangeReason = document.getElementById("passwordChangeReason");
  const passwordChangeNote = document.getElementById("passwordChangeNote");
  const xmlYesterdayAlert = document.getElementById("xmlYesterdayAlert");
  const xmlYesterdayAlertTitle = document.getElementById("xmlYesterdayAlertTitle");
  const xmlYesterdayAlertBody = document.getElementById("xmlYesterdayAlertBody");
  const xmlYesterdayAlertDismiss = document.getElementById("xmlYesterdayAlertDismiss");
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
  const supplierFeedModal = document.getElementById("supplierFeedModal");
  const supplierFeedForm = document.getElementById("supplierFeedForm");
  const supplierFeedFields = {
    supplierSku: document.getElementById("sFeedSupplierSku"),
    supplierSlot: document.getElementById("sFeedSupplierSlot"),
    name: document.getElementById("sFeedName"),
    brand: document.getElementById("sFeedBrand"),
    manufacturerCode: document.getElementById("sFeedManufacturerCode"),
    barcode: document.getElementById("sFeedBarcode"),
    gtip: document.getElementById("sFeedGtip"),
    specialCode: document.getElementById("sFeedSpecialCode"),
    vat: document.getElementById("sFeedVat"),
    currency: document.getElementById("sFeedCurrency"),
    unit: document.getElementById("sFeedUnit"),
    category: document.getElementById("sFeedCategory"),
    mainCategory: document.getElementById("sFeedMainCategory"),
    midCategory: document.getElementById("sFeedMidCategory"),
    subCategory: document.getElementById("sFeedSubCategory"),
    description: document.getElementById("sFeedDescription"),
    details: document.getElementById("sFeedDetails"),
    imageFile: document.getElementById("sFeedImageFile"),
    imageUrl: document.getElementById("sFeedImageUrl"),
  };
  const supplierFeedIssues = document.getElementById("supplierFeedIssues");
  const supplierFeedSubtitle = document.getElementById("supplierFeedSubtitle");
  const supplierFeedFormNote = document.getElementById("supplierFeedFormNote");
  let editingSupplierFeedKey = "";

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

  const FEED_CATEGORY_TREE = [
    {
      name: "KİŞİSEL BİLGİSAYARLAR",
      children: [
        { name: "Taşınabilir Bilgisayarlar", children: ["Notebooklar", "Tablet"] },
        { name: "Masaüstü Bilgisayarlar", children: ["Masaüstü Bilgisayarlar"] },
        { name: "Monitörler", children: ["Monitör"] },
        { name: "Çevre Birimleri", children: ["Klavye", "Mouse", "Klavye Mouse Set"] },
        { name: "Bilgisayar Bileşenleri", children: ["Ram", "Ekran Kartı", "İşlemciler", "Kasa"] },
      ],
    },
    {
      name: "OEM & ÇEVRE BİRİMLERİ",
      children: [
        { name: "İşlemciler", children: ["Intel İşlemciler", "AMD İşlemciler", "İşlemciler"] },
      ],
    },
    {
      name: "YAZICILAR VE ÇEVRE BİRİMLERİ",
      children: [
        { name: "Yazıcılar", children: ["Ofis Yazıcıları", "Laser Yazıcılar", "Inkjet Yazıcılar"] },
        { name: "Tarayıcılar", children: ["Tarayıcılar"] },
        { name: "Ağ Ürünleri", children: ["Modem", "Router"] },
        { name: "Depolama", children: ["USB Bellekler"] },
        { name: "Çantalar ve Kılıflar", children: ["Notebook Çantaları"] },
      ],
    },
    {
      name: "EV ALETLERİ",
      children: [{ name: "Küçük Ev Aletleri", children: ["Genel"] }],
    },
    {
      name: "BEYAZ EŞYA",
      children: [{ name: "Soğutma", children: ["Buzdolabı"] }],
    },
  ];

  function uniqueFeedLabels(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((item) => {
      const value = String(item || "").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push(value);
    });
    return out;
  }

  function feedMainNames() {
    return FEED_CATEGORY_TREE.map((row) => row.name);
  }

  function feedMidNames(mainName) {
    const main = FEED_CATEGORY_TREE.find((row) => row.name === mainName);
    return main ? main.children.map((row) => row.name) : [];
  }

  function feedSubNames(mainName, midName) {
    const main = FEED_CATEGORY_TREE.find((row) => row.name === mainName);
    const mid = main && main.children.find((row) => row.name === midName);
    return mid ? mid.children.slice() : [];
  }

  function fillSelectOptions(select, values, selected, placeholder) {
    if (!select) return;
    const current = String(selected || "").trim();
    const options = uniqueFeedLabels((values || []).concat(current ? [current] : []));
    select.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
    options.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    select.value = options.indexOf(current) >= 0 ? current : "";
  }

  function setFeedCategorySelects(mainEl, midEl, subEl, values) {
    const main = String((values && values.main) || "").trim();
    const mid = String((values && values.mid) || "").trim();
    const sub = String((values && values.sub) || "").trim();
    fillSelectOptions(mainEl, feedMainNames(), main, "Ana kategori seçin");
    fillSelectOptions(midEl, feedMidNames(mainEl.value), mid, "Ara kategori seçin");
    fillSelectOptions(subEl, feedSubNames(mainEl.value, midEl.value), sub, "Alt kategori seçin");
  }

  function bindFeedCategoryCascade(mainEl, midEl, subEl) {
    if (!mainEl || !midEl || !subEl || mainEl.dataset.feedCascade === "1") return;
    mainEl.dataset.feedCascade = "1";
    mainEl.addEventListener("change", () => {
      fillSelectOptions(midEl, feedMidNames(mainEl.value), "", "Ara kategori seçin");
      fillSelectOptions(subEl, feedSubNames(mainEl.value, midEl.value), "", "Alt kategori seçin");
    });
    midEl.addEventListener("change", () => {
      fillSelectOptions(subEl, feedSubNames(mainEl.value, midEl.value), "", "Alt kategori seçin");
    });
  }

  function applyCategoryDefaults(force) {
    const tree = CATEGORY_FEED_DEFAULTS[fields.category.value] || CATEGORY_FEED_DEFAULTS.bilgisayar;
    setFeedCategorySelects(fields.mainCategory, fields.midCategory, fields.subCategory, {
      main: force || !fields.mainCategory.value.trim() ? tree.mainCategory : fields.mainCategory.value,
      mid: force || !fields.midCategory.value.trim() ? tree.midCategory : fields.midCategory.value,
      sub: force || !fields.subCategory.value.trim() ? tree.subCategory : fields.subCategory.value,
    });
  }

  function applySupplierFeedCategoryDefaults(force) {
    if (!supplierFeedFields.category) return;
    const tree =
      CATEGORY_FEED_DEFAULTS[supplierFeedFields.category.value] || CATEGORY_FEED_DEFAULTS.bilgisayar;
    setFeedCategorySelects(
      supplierFeedFields.mainCategory,
      supplierFeedFields.midCategory,
      supplierFeedFields.subCategory,
      {
        main:
          force || !supplierFeedFields.mainCategory.value.trim()
            ? tree.mainCategory
            : supplierFeedFields.mainCategory.value,
        mid:
          force || !supplierFeedFields.midCategory.value.trim()
            ? tree.midCategory
            : supplierFeedFields.midCategory.value,
        sub:
          force || !supplierFeedFields.subCategory.value.trim()
            ? tree.subCategory
            : supplierFeedFields.subCategory.value,
      }
    );
  }

  bindFeedCategoryCascade(fields.mainCategory, fields.midCategory, fields.subCategory);
  bindFeedCategoryCascade(
    supplierFeedFields.mainCategory,
    supplierFeedFields.midCategory,
    supplierFeedFields.subCategory
  );

  function renderSupplierFeedIssues(issues) {
    if (!supplierFeedIssues) return;
    supplierFeedIssues.textContent = "";
    const list = Array.isArray(issues) ? issues : [];
    if (!list.length) {
      supplierFeedIssues.hidden = true;
      return;
    }
    supplierFeedIssues.hidden = false;
    list.forEach((reason) => {
      const item = document.createElement("li");
      item.textContent = reason;
      supplierFeedIssues.appendChild(item);
    });
  }

  function renderSupplierFeedImagePreviews() {
    const root = document.getElementById("sFeedImagePreview");
    if (!root) return;
    root.textContent = "";
    root.hidden = supplierFeedImages.length === 0;
    supplierFeedImages.forEach((url, index) => {
      const item = document.createElement("div");
      item.className = "admin-preview-item";
      item.draggable = true;
      item.dataset.index = String(index);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "XML görseli " + (index + 1);
      img.referrerPolicy = "no-referrer";
      const badge = document.createElement("span");
      badge.textContent = index === 0 ? "Kapak" : String(index + 1);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", "Görseli kaldır");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        supplierFeedImages.splice(index, 1);
        renderSupplierFeedImagePreviews();
      });
      item.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", String(index));
      });
      item.addEventListener("dragover", (ev) => ev.preventDefault());
      item.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const from = Number(ev.dataTransfer.getData("text/plain"));
        if (!Number.isInteger(from) || from === index || !supplierFeedImages[from]) return;
        const moved = supplierFeedImages.splice(from, 1)[0];
        supplierFeedImages.splice(index, 0, moved);
        renderSupplierFeedImagePreviews();
      });
      item.appendChild(img);
      item.appendChild(badge);
      item.appendChild(remove);
      root.appendChild(item);
    });
  }

  function openSupplierFeedModal(item) {
    if (!supplierFeedModal || !item) return;
    editingSupplierFeedKey = item.supplierSlot + "|" + item.supplierSku;
    if (supplierFeedSubtitle) {
      supplierFeedSubtitle.textContent =
        (item.supplierSku || "") + " · " + (item.name || "XML ürünü");
    }
    supplierFeedFields.supplierSku.value = item.supplierSku || "";
    supplierFeedFields.supplierSlot.value = item.supplierSlot || "supplier-1";
    supplierFeedFields.name.value = item.name || "";
    supplierFeedFields.brand.value = item.brand || "";
    supplierFeedFields.manufacturerCode.value = item.manufacturerCode || item.supplierSku || "";
    supplierFeedFields.barcode.value = item.barcode || "";
    supplierFeedFields.gtip.value = item.gtipCode || "";
    supplierFeedFields.specialCode.value = item.specialCode || "";
    supplierFeedFields.vat.value = String(item.vatPercent || 20);
    supplierFeedFields.currency.value = item.currency || "TRY";
    supplierFeedFields.unit.value = item.unit || "ADET";
    supplierFeedFields.category.value = item.category || "bilgisayar";
    setFeedCategorySelects(
      supplierFeedFields.mainCategory,
      supplierFeedFields.midCategory,
      supplierFeedFields.subCategory,
      {
        main: item.xmlMainCategory || item.mainCategory || "",
        mid: item.xmlMidCategory || item.midCategory || "",
        sub: item.xmlSubCategory || item.subCategory || "",
      }
    );
    const hasFeedCats = Boolean(
      (item.xmlMainCategory || item.mainCategory || "").trim()
    );
    if (!hasFeedCats) applySupplierFeedCategoryDefaults(false);
    supplierFeedFields.description.value =
      item.description && item.description !== item.name ? item.description : "";
    if (supplierFeedFields.details) {
      supplierFeedFields.details.value =
        item.details && item.details !== item.name && item.details !== item.description
          ? item.details
          : item.description && item.description !== item.name
            ? item.description
            : "";
    }
    supplierFeedImages = (
      Array.isArray(item.images) && item.images.length
        ? item.images
        : item.image
          ? [item.image]
          : []
    )
      .filter(Boolean)
      .slice(0, MAX_PRODUCT_IMAGES);
    renderSupplierFeedImagePreviews();
    renderSupplierFeedIssues(item.feedIssues || []);
    note(supplierFeedFormNote, "", "");
    supplierFeedModal.hidden = false;
    document.body.classList.add("admin-modal-open");
    if (supplierFeedFields.name) supplierFeedFields.name.focus();
  }

  function closeSupplierFeedModal() {
    if (!supplierFeedModal) return;
    supplierFeedModal.hidden = true;
    editingSupplierFeedKey = "";
    if (!isProductModalOpen()) document.body.classList.remove("admin-modal-open");
  }

  function isSupplierFeedModalOpen() {
    return supplierFeedModal && !supplierFeedModal.hidden;
  }

  function note(el, type, text) {
    if (!el) return;
    el.classList.remove("ok", "err", "warn");
    if (type) el.classList.add(type);
    el.textContent = text || "";
  }

  function money(n) {
    return "₺" + Math.round(Number(n) || 0).toLocaleString("tr-TR");
  }

  function isAuthSessionError(err) {
    const msg = String((err && err.message) || "");
    return /Oturum|oturum|401|giriş yapın|Yetkisiz/i.test(msg);
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
    const isSupplierPublish = path.includes("/supplier/publish");
    const isSupplierProducts = path.includes("/supplier/products");
    const isOrderPatch = /\/api\/admin\/orders\/[^/?]+$/.test(path) && String(opts.method || "GET").toUpperCase() === "PATCH";
    const isAdminLogin = path.includes("/api/admin/login");
    const isAdminMe = path.includes("/api/admin/me");
    const timer = setTimeout(
      () => ctrl.abort(),
      Number(opts.timeout) ||
        (isSupplierRefresh || isSupplierPublish
          ? 100000
          : isSupplierProducts
            ? 30000
            : isOrderPatch
              ? 30000
              : isAdminLogin
                ? 60000
                : isAdminMe
                  ? 30000
                  : 12000)
    );
    try {
      const res = await fetch(path, Object.assign({}, opts, { headers, signal: ctrl.signal }));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && token && !path.includes("/api/admin/login")) {
        endSession("Oturum süresi doldu. Tekrar giriş yapın.");
        throw new Error("Oturum süresi doldu. Tekrar giriş yapın.");
      }
      if (res.status === 403 && data.mustChangePassword && token && !path.includes("/api/admin/change-password")) {
        showPasswordChangeGate(true, data.error || data.passwordChangeReason || "");
        throw new Error(data.error || "Panel şifresi güncellenmeli.");
      }
      if (!res.ok) throw new Error(data.error || "İstek başarısız (" + res.status + ")");
      touchActivity();
      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error(
          isSupplierRefresh
            ? "XML çekimi zaman aşımına uğradı. Tedarikçi IP whitelist / firewall ayarını kontrol edin."
            : isSupplierPublish
              ? "Yayın işlemi zaman aşımına uğradı. Lütfen tekrar deneyin."
              : isAdminLogin
                ? "Sunucu girişe yanıt vermedi. Bu şifre hatası değil — birkaç saniye sonra tekrar deneyin."
                : "İstek zaman aşımına uğradı. Lütfen tekrar deneyin."
        );
      }
      if (err && err.message && /Failed to fetch|NetworkError|Load failed|fetch/i.test(err.message)) {
        throw new Error(
          isSupplierRefresh
            ? "XML bağlantısı kesildi. Sunucu tedarikçiye bağlanamıyor olabilir (IP whitelist)."
            : isAdminLogin
              ? "Panele ulaşılamadı. Bu şifre hatası değil — bağlantıyı kontrol edip tekrar deneyin."
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

  function currentAdminTab() {
    try {
      const saved = sessionStorage.getItem("patygo_admin_tab");
      if (
        ["overview", "calendar", "orders", "reviews", "leads", "users", "shipping", "products", "xml", "categories", "unlisted"].includes(
          saved
        )
      ) {
        return saved;
      }
    } catch (_) {}
    return "overview";
  }

  function showPasswordChangeGate(on, reason) {
    if (!passwordChangeGate) return;
    passwordChangeGate.hidden = !on;
    if (passwordChangeReason && reason) {
      passwordChangeReason.textContent = reason;
    }
    if (on && passwordChangeNote) passwordChangeNote.textContent = "";
  }

  function renderXmlYesterdayAlert(alert) {
    if (!xmlYesterdayAlert) return;
    if (!alert || !alert.headline) {
      xmlYesterdayAlert.hidden = true;
      return;
    }
    xmlYesterdayAlert.hidden = false;
    if (xmlYesterdayAlertTitle) {
      xmlYesterdayAlertTitle.textContent = alert.headline;
    }
    if (xmlYesterdayAlertBody) {
      const lines = [];
      lines.push(
        (alert.date || "Dün") +
          ": " +
          alert.failureCount +
          " başarısız / " +
          alert.totalAttempts +
          " deneme."
      );
      if (alert.quotaCount) {
        lines.push("Kota: " + alert.quotaCount + " kez.");
      }
      if (Array.isArray(alert.failures) && alert.failures.length) {
        alert.failures.slice(0, 3).forEach((row) => {
          lines.push((row.dueKey || row.slotId || "XML") + " — " + (row.error || "Hata"));
        });
      }
      xmlYesterdayAlertBody.textContent = lines.join(" ");
    }
    if (xmlYesterdayAlertDismiss) {
      xmlYesterdayAlertDismiss.dataset.alertDate = alert.date || "";
    }
  }

  function renderOpsHealth(health) {
    if (!adminOpsHealth) return;
    const label = adminOpsHealth.querySelector(".admin-health-label");
    if (!health || !health.label) {
      adminOpsHealth.hidden = true;
      adminOpsHealth.className = "admin-health";
      adminOpsHealth.removeAttribute("title");
      adminOpsHealth.removeAttribute("data-action");
      if (label) label.textContent = "";
      return;
    }
    const tone = health.tone === "err" ? "err" : "warn";
    adminOpsHealth.hidden = false;
    adminOpsHealth.className = "admin-health is-" + tone;
    adminOpsHealth.title = health.title || health.label;
    adminOpsHealth.setAttribute("data-action", health.action || "");
    adminOpsHealth.setAttribute("aria-label", health.label);
    if (label) label.textContent = health.label;
  }

  async function bootAuthedWorkspace() {
    try {
      const me = await api("/api/admin/me", { timeout: 30000 });
      if (me.mustChangePassword) {
        showPasswordChangeGate(true, me.passwordChangeReason || "");
        showPanel(true);
        return;
      }
      showPasswordChangeGate(false);
      applySmtpMailHelp(me.smtpConfigured === true);
    } catch (err) {
      if (err && /şifre|password/i.test(String(err.message || ""))) {
        showPanel(true);
        return;
      }
      if (isAuthSessionError(err)) {
        endSession(err.message || "Oturum açılamadı.");
        return;
      }
      showPanel(true);
      note(
        loginNote,
        "err",
        err.message || "Panel doğrulanamadı. Bağlantınızı kontrol edip tekrar deneyin."
      );
      return;
    }
    showPanel(true);
    api("/api/admin/supplier/status")
      .then((data) => {
        renderXmlYesterdayAlert(data.yesterdayXmlAlert);
        renderOpsHealth(data.opsHealth);
        if (Array.isArray(data.slots)) supplierSlots = data.slots;
        if (data.feed && data.feed.publicUrl && !feedStatus) feedStatus = data.feed;
        updateDashboard();
        renderSupplierStatus();
      })
      .catch(() => {});
    const tab = currentAdminTab();
    const xmlView =
      tab === "xml" ||
      (tab === "products" &&
        (function () {
          try {
            return sessionStorage.getItem("patygo_products_view") === "xml";
          } catch (_) {
            return false;
          }
        })());
    if (tab === "products" && !xmlView) ensureManualProducts().catch(() => {});
    if (tab === "overview") loadDigitalDashboard().catch(() => {});
    if (tab === "orders") loadAdminOrders().catch(() => {});
    loadAdminReviews(tab === "reviews").catch(() => {});
    if (tab === "leads") loadAdminLeads().catch(() => {});
    else refreshLeadsNavAlert().catch(() => {});
    if (tab === "shipping") {
      loadAdminShippingSettings().catch(() => {});
      loadAdminInstallmentSettings().catch(() => {});
      loadAdminCoupons().catch(() => {});
    }
    if (tab === "calendar") loadCalendarMonth().catch(() => {});
    if (tab === "categories") loadCategoryTree().catch(() => {});
    if (tab === "users") loadAdminUsers().catch(() => {});
    if (tab === "unlisted") loadUnlistedProducts().catch(() => {});
    if (xmlView) {
      loadSupplierData().catch((err) => {
        note(
          document.getElementById("supplierProductsNote"),
          "err",
          err.message || "Havuz yüklenemedi"
        );
      });
    }
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
      reviews: ["Yorumlar", "Teslim alınmış siparişlerden gelen ürün yorumlarını onaylayın veya reddedin."],
      leads: ["Talepler", "İletişim formundan gelen teklif / talep kayıtları."],
      users: ["Kullanıcılar", "Panel girişi için ad, soyad, e-posta ve şifre yönetin."],
      shipping: ["Kargo ve taksit", "Kargo bedeli, ücretsiz kargo eşiği ve taksit oranlarını yönetin."],
      products: ["Ürünler", "Sol menüden Manuel veya XML ürünlerine geçin."],
      xml: ["XML Yönetimi", "Tedarikçi ürünlerini ve Akakçe yayınını yönetin."],
      categories: ["Kategoriler", "Web sitesi kategori ağacını oluşturun ve yayına alın."],
      unlisted: ["Listelenmeyen Ürünler", "Sitede ve Akakçe XML'inde gösterilmeyen XML ürünleri."],
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
    if (name === "products" && token) {
      let view = "manual";
      try {
        const saved = sessionStorage.getItem("patygo_products_view");
        if (saved === "manual" || saved === "xml") view = saved;
      } catch (_) {}
      if (view === "manual") ensureManualProducts().catch(() => {});
    }
    if (name === "overview" && token) loadDigitalDashboard().catch(() => {});
    if (name === "calendar" && token) {
      loadCalendarMonth().catch(() => {});
      ensureCalendarNotificationPermission().catch(() => {});
    }
    if (name === "users" && token) loadAdminUsers().catch(() => {});
    if (name === "leads" && token) loadAdminLeads().catch(() => {});
    if (name === "shipping" && token) {
      loadAdminShippingSettings().catch(() => {});
      loadAdminInstallmentSettings().catch(() => {});
      loadAdminCoupons().catch(() => {});
    }
    if (name === "orders" && token) loadAdminOrders().catch(() => {});
    if (name === "reviews" && token) loadAdminReviews(true).catch(() => {});
    if (name === "categories" && token) loadCategoryTree().catch(() => {});
    if (name === "unlisted" && token) loadUnlistedProducts().catch(() => {});
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
    const productsTab = document.getElementById("productsTab");
    if (productsTab && productsTab.classList.contains("active")) {
      document.getElementById("adminPageTitle").textContent = meta[0];
      document.getElementById("adminPageSubtitle").textContent = meta[1];
    }
    const newProductBtn = document.getElementById("newProductBtn");
    if (newProductBtn) newProductBtn.hidden = view !== "manual";
    if (view === "manual" && token) ensureManualProducts().catch(() => {});
    if (view === "xml") {
      renderSupplierProducts();
      if (token) {
        loadSupplierData().catch((err) => {
          note(document.getElementById("supplierProductsNote"), "err", err.message || "Havuz yüklenemedi");
        });
      }
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
    setFeedCategorySelects(fields.mainCategory, fields.midCategory, fields.subCategory, {
      main: p.mainCategory || "",
      mid: p.midCategory || "",
      sub: p.subCategory || "",
    });
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

  function minuteToTimeValue(minuteValue) {
    const n = Number(minuteValue);
    if (!Number.isFinite(n)) return "08:00";
    const hour = Math.max(0, Math.min(23, Math.floor(n / 60)));
    const minute = Math.max(0, Math.min(59, n % 60));
    return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  }

  function formatSchedulePreview(startValue, intervalValue, knownTimes) {
    if (Array.isArray(knownTimes) && knownTimes.length) {
      return knownTimes.join(", ") + " (günde " + knownTimes.length + " kez, İstanbul)";
    }
    return "08:00, 11:00, 16:00, 21:00, 23:30 (günde 5 kez, İstanbul)";
  }

  function emptyPoolQuotaMessage() {
    const next = supplierSlots.find((slot) => slot && slot.nextScheduled && slot.nextScheduled.label);
    const when = next && next.nextScheduled.label ? " (" + next.nextScheduled.label + ")" : "";
    return (
      "Tedarikçi günlük XML kotası doldu. Havuz ilk başarılı okumada dolacak" +
      when +
      ". Bugün kalan otomatik denemeler durduruldu."
    );
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

  function formatCount(value) {
    return (Number(value) || 0).toLocaleString("tr-TR");
  }

  function renderCatalogSummary(summary) {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    if (!summary) return;
    const xml = summary.xml || {};
    setText("dashCatalogTotal", formatCount(summary.totalCount));
    setText(
      "dashCatalogTotalMeta",
      "XML " + formatCount(summary.supplierCount) + " · manuel " + formatCount(summary.manualCount)
    );
    setText("dashCatalogSiteActive", formatCount(summary.siteActiveCount));
    setText(
      "dashCatalogSiteActiveMeta",
      "Yayına alınan XML: " + formatCount(summary.supplierPublishedCount)
    );
    const thresholds = Array.isArray(summary.criticalStockThresholds)
      ? summary.criticalStockThresholds
      : [];
    setText("dashCatalogCritical", formatCount(summary.criticalStockCount));
    setText(
      "dashCatalogCriticalMeta",
      thresholds.length
        ? "Stok ≤ " + thresholds.join(" / ") + " adet · sitede gizli"
        : "Kritik eşik tanımlı değil"
    );
    setText("dashCatalogOutOfStock", formatCount(summary.outOfStockCount));
    setText(
      "dashCatalogOutOfStockMeta",
      Number(summary.staleStockCount) > 0
        ? "+" + formatCount(summary.staleStockCount) + " ürün 7 gündür okunamadı"
        : "Yayında · stok 0"
    );
    setText("dashCatalogUnlisted", formatCount(summary.unlistedCount));
    setText("dashCatalogXml", formatCount(xml.connected) + " / " + formatCount(xml.total));
    setText(
      "dashCatalogXmlMeta",
      Number(xml.failing) > 0
        ? xml.failing + " bağlantıda hata ›"
        : xml.lastSuccessfulFetchAt
          ? "Son okuma " + formatDate(xml.lastSuccessfulFetchAt) + " ›"
          : "XML Yönetimi ›"
    );
    const xmlCard = document.getElementById("dashCatalogXmlCard");
    if (xmlCard) xmlCard.classList.toggle("is-alert", Number(xml.failing) > 0 || Number(xml.stale) > 0);
  }

  function applySmtpMailHelp(smtpOn) {
    const configured = smtpOn === true;
    document.querySelectorAll("[data-smtp-mail-help]").forEach((el) => {
      el.textContent = configured
        ? "Hatırlatıcı kaydedilince ve saat gelince bu adrese e-posta gider. Panel açıksa tarayıcı bildirimi de çıkar (Europe/Istanbul)."
        : "Canlı SMTP yok; e-posta gönderilmez. Saat gelince yalnızca panel açıksa tarayıcı bildirimi çıkar.";
    });
  }

  function renderDigitalDashboard(payload) {
    const analytics = (payload && payload.analytics) || {};
    const commerce = (payload && payload.commerce) || {};
    const proc = (payload && (payload.process || payload.server)) || {};
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

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
        (commerce.ordersPending || 0) +
        (commerce.ordersRefunded ? " · iade/iptal " + commerce.ordersRefunded : "")
    );
    setText("dashRevenue", formatMoney(commerce.revenue || 0));
    setText(
      "dashRevenueMeta",
      commerce.refundedAmount > 0
        ? "Ödenen siparişler · " + formatMoney(commerce.refundedAmount) + " iade/iptal düşüldü"
        : "Ödenen siparişler, iadeler düşülmüş"
    );
    setText("dashAov", formatMoney(commerce.aov || 0));
    setText("dashAddToCart", String(analytics.addToCart || 0));
    setText("dashCheckoutStarted", String(analytics.checkoutStarted || 0));
    setText("dashOrdersFailed", String(commerce.ordersFailed || 0));
    setText("dashOrdersPending", String(commerce.ordersPending || 0));
    setText("dashConversionRate", "%" + (analytics.conversionRate || 0));
    renderCatalogSummary(payload.catalogSummary);

    const leadsCard = document.getElementById("dashLeadsCard");
    if (leadsCard) {
      leadsCard.title =
        payload.leadsNote ||
        "Talep sayısı, iletişim formunun sunucuya kaydedildiği anları sayar.";
    }

    const serverNote = document.getElementById("dashServerNote");
    if (serverNote) {
      if (payload && payload.loadError) {
        serverNote.hidden = false;
        serverNote.textContent =
          "Panel özeti çekilemedi (bu, sitenin kapalı olduğu anlamına gelmez): " + payload.loadError;
      } else {
        serverNote.hidden = true;
        serverNote.textContent = "";
      }
    }
    setText("dashSiteBaseUrl", proc.siteBaseUrl || "—");
    const pos = proc.pos || {};
    setText(
      "dashPos",
      pos.enabled
        ? "Akbank " + (pos.testMode ? "TEST" : "CANLI")
        : payload && payload.loadError
          ? "—"
          : "Yapılandırılmadı"
    );
    setText(
      "dashSmtp",
      payload && payload.loadError
        ? "—"
        : proc.smtpConfigured === true
          ? "Kurulu"
          : "Yok (sipariş/takvim maili gitmez)"
    );
    if (proc.smtpConfigured === true || proc.smtpConfigured === false) {
      applySmtpMailHelp(proc.smtpConfigured);
    }

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

  /**
   * A saved range that ended on the day it was saved rolls forward with the calendar (same length),
   * so tomorrow's panel still shows today's orders; a range ending in the past stays as picked.
   * Entries saved before savedOn existed are treated as rolling.
   */
  function rollSavedRange(parsed, fallbackDays) {
    if (!parsed || !parsed.from || !parsed.to) return defaultPeriodRange(fallbackDays);
    const today = isoDate(new Date());
    const rolling = parsed.savedOn ? parsed.to === parsed.savedOn : true;
    if (!rolling || parsed.to >= today) return { from: parsed.from, to: parsed.to };
    const span = Math.round((Date.parse(parsed.to) - Date.parse(parsed.from)) / 86400000) + 1;
    return defaultPeriodRange(span);
  }

  function storedRange(from, to) {
    return JSON.stringify({ from, to, savedOn: isoDate(new Date()) });
  }

  function readSavedPeriod() {
    try {
      const raw = localStorage.getItem(PERIOD_KEY);
      if (raw) return rollSavedRange(JSON.parse(raw), 30);
    } catch (_) {}
    return defaultPeriodRange(30);
  }

  function savePeriod(from, to) {
    try {
      localStorage.setItem(PERIOD_KEY, storedRange(from, to));
    } catch (_) {}
  }

  function syncPeriodInputs(from, to) {
    const fromEl = document.getElementById("dashFrom");
    const toEl = document.getElementById("dashTo");
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
  }

  function displayIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? match[3] + "." + match[2] + "." + match[1] : String(value || "");
  }

  function syncPeriodPresets() {
    const fromEl = document.getElementById("dashFrom");
    const toEl = document.getElementById("dashTo");
    const from = fromEl && fromEl.value;
    const to = toEl && toEl.value;
    document.querySelectorAll("[data-dash-days]").forEach((button) => {
      const range = defaultPeriodRange(button.getAttribute("data-dash-days"));
      button.setAttribute("aria-pressed", String(range.from === from && range.to === to));
    });
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
    try {
      const data = await api("/api/admin/dashboard?" + currentPeriodQuery());
      if (data.analytics && data.analytics.from && data.analytics.to) {
        syncPeriodInputs(data.analytics.from, data.analytics.to);
        savePeriod(data.analytics.from, data.analytics.to);
      }
      const hint = document.getElementById("dashPeriodHint");
      if (hint && data.analytics) {
        hint.textContent =
          displayIsoDate(data.analytics.from) +
          " – " +
          displayIsoDate(data.analytics.to) +
          " · " +
          (data.analytics.periodDays || 0) +
          " gün · trafik verisi en fazla 90 gün saklanır";
      }
      syncPeriodPresets();
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
    const configuredSlots = supplierSlots.filter((slot) => slot.configured);
    const failedSlots = supplierSlots.filter((slot) => slot.lastFetchStatus === "error");
    const latestFetch = supplierSlots
      .map((slot) => slot.lastFetchAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    const staleSlots = supplierSlots.filter((slot) => slot.catalogStale);
    const badge = document.getElementById("dashboardXmlStatus");
    if (badge) {
      badge.className =
        "admin-status " +
        (staleSlots.length ? "pending" : failedSlots.length ? "err" : configuredSlots.length ? "on" : "pending");
      badge.textContent = staleSlots.length
        ? "Katalog donduruldu"
        : failedSlots.length
          ? failedSlots.length + " bağlantıda hata"
          : configuredSlots.length
            ? configuredSlots.length + " / 3 bağlı"
            : "Yapılandırılmadı";
    }
    const lastSync = document.getElementById("dashboardLastSync");
    if (lastSync) lastSync.textContent = formatDate(latestFetch);
    const host = document.getElementById("dashboardXmlHost");
    if (host) {
      host.textContent = configuredSlots.length
        ? configuredSlots.map((slot) => slot.host || slot.name).join(" · ")
        : "Tanımlanmadı";
    }
    const margin = document.getElementById("dashboardMargin");
    if (margin) {
      margin.textContent = configuredSlots.length
        ? configuredSlots.map((slot) => "%" + slot.globalMarginPercent).join(" · ")
        : "%15";
    }
    const failed = failedSlots[0];
    const dashErr = document.getElementById("dashboardXmlError");
    if (dashErr) dashErr.textContent = failed && failed.lastError ? failed.lastError : "—";
    const dashNote = document.getElementById("dashboardXmlNote");
    if (dashNote) {
      note(
        dashNote,
        failed ? "err" : "",
        failed
          ? (staleSlots.length
              ? failed.lastError + " Son katalog donduruldu; sitede stoksuz işaretlenmez."
              : failed.lastError)
          : ""
      );
    }
    syncFeedUrlUi();
  }

  function renderSupplierStatus() {
    supplierSlots.forEach((slot) => {
      const card = document.querySelector('[data-supplier-card="' + slot.id + '"]');
      if (!card) return;
      const failed = slot.lastFetchStatus === "error";
      const stale = slot.catalogStale === true;
      const field = (name) => card.querySelector('[data-slot-field="' + name + '"]');
      const input = (name) => card.querySelector('[data-slot-input="' + name + '"]');
      const badge = field("badge");
      if (badge) {
        badge.className =
          "admin-status " +
          (failed && stale ? "pending" : failed ? "err" : slot.configured ? "on" : "pending");
        badge.textContent = failed && stale
          ? "Katalog donduruldu"
          : failed
            ? "Senkron hatası"
            : slot.configured
              ? "Bağlantı kayıtlı"
              : "Yapılandırılmadı";
      }
      if (field("title")) field("title").textContent = slot.name;
      if (field("maskedUrl")) field("maskedUrl").textContent = slot.maskedUrl || "Tanımlanmadı";
      if (field("lastSync")) field("lastSync").textContent = formatDate(slot.lastFetchAt);
      if (field("lastSuccess")) field("lastSuccess").textContent = formatDate(slot.lastSuccessfulFetchAt);
      if (field("itemCount")) field("itemCount").textContent = String(slot.itemCount || 0);
      if (field("lastAutoSync")) {
        field("lastAutoSync").textContent = slot.lastScheduledFetchKey || "Henüz yok";
      }
      if (input("name")) input("name").value = slot.name;
      if (input("margin")) input("margin").value = String(slot.globalMarginPercent);
      const urlInput = input("url");
      if (urlInput) {
        urlInput.placeholder = slot.configured
          ? "Kayıtlı bağlantı gizli. Değiştirmek için yeni URL yazın."
          : "https://tedarikci.com/xml?...";
      }
      if (input("criticalStock")) {
        input("criticalStock").value = String(slot.criticalStockQty || 0);
      }
      if (field("scheduleHelp")) {
        field("scheduleHelp").textContent = formatSchedulePreview(
          "",
          "",
          slot.schedule && slot.schedule.times
        );
      }
      const noteText = stale
        ? (slot.lastError || "XML okunamadı") +
          " Havuzdaki " +
          (slot.itemCount || 0) +
          " ürün son başarılı katalogdan; stok donduruldu."
        : failed
          ? slot.lastError
          : "";
      note(field("note"), failed ? "err" : "", noteText);
      const option = supplierSlotFilter.querySelector('option[value="' + slot.id + '"]');
      if (option) option.textContent = slot.name;
    });
    const banner = document.getElementById("supplierStatusBanner");
    if (banner) {
      const lines = supplierSlots.map((slot) => {
        const state = slot.catalogStale
          ? "katalog donduruldu"
          : slot.lastFetchStatus === "error"
            ? "hata"
            : slot.configured
              ? "kayıtlı"
              : "yapılandırılmadı";
        const extra = slot.lastFetchStatus === "error"
          ? " — " + (slot.lastError || "senkron başarısız") +
            (slot.itemCount ? " · havuz: " + slot.itemCount + " ürün" : "")
          : slot.configured
            ? " · " + (slot.itemCount || 0) + " ürün · son: " + formatDate(slot.lastFetchAt)
            : "";
        return (slot.name || slot.id) + ": " + state + extra;
      });
      banner.textContent = lines.join(" | ");
      banner.className =
        "admin-xml-status-banner" +
        (supplierSlots.some((slot) => slot.lastFetchStatus === "error") ? " is-error" : "");
    }
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

  function supplierQueryString() {
    const qs = new URLSearchParams();
    qs.set("page", String(supplierPoolPage || 1));
    qs.set("limit", String(POOL_PAGE_SIZE));
    const query = String(supplierSearch && supplierSearch.value ? supplierSearch.value : "").trim();
    const status = supplierStatusFilter ? supplierStatusFilter.value : "";
    const slotId = supplierSlotFilter ? supplierSlotFilter.value : "";
    if (query) qs.set("q", query);
    if (status) qs.set("status", status);
    if (slotId) qs.set("slot", slotId);
    supplierSort.apply(qs);
    return qs.toString();
  }

  function pagedSupplierProducts() {
    const total = Number(supplierPoolMeta.total) || 0;
    const totalPages = Math.max(1, Number(supplierPoolMeta.totalPages) || 1);
    const page = Math.min(totalPages, Math.max(1, Number(supplierPoolMeta.page) || supplierPoolPage || 1));
    const start = total ? (page - 1) * (Number(supplierPoolMeta.limit) || POOL_PAGE_SIZE) : 0;
    return {
      listTotal: total,
      totalPages,
      start,
      shown: supplierProducts,
    };
  }

  async function loadSiteCategories() {
    try {
      if (token) {
        const data = await api("/api/admin/categories");
        siteCategories = Array.isArray(data.categories) ? data.categories : [];
        return;
      }
      const publicSources = ["/listing/categories.json", "/assets/data/categories.json"];
      let data = null;
      for (const source of publicSources) {
        const res = await fetch(source, { cache: "no-store" });
        if (!res.ok) continue;
        data = await res.json();
        break;
      }
      if (!data) return;
      siteCategories = Array.isArray(data.categories) ? data.categories : [];
    } catch (_) {
      siteCategories = [];
    }
  }

  function fillSiteParentSelect(select, selected) {
    select.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Ana kategori";
    select.appendChild(empty);
    siteCategories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.slug;
      opt.textContent = cat.name;
      if (cat.slug === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function fillSiteMidSelect(select, parentSlug, selected) {
    select.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = parentSlug ? "Ara kategori" : "Önce ana kategori";
    select.appendChild(empty);
    const parent = siteCategories.find((cat) => cat.slug === parentSlug);
    const children = parent && Array.isArray(parent.children) ? parent.children : [];
    children.forEach((child) => {
      const opt = document.createElement("option");
      opt.value = child.slug;
      opt.textContent = child.name;
      if (child.slug === selected) opt.selected = true;
      select.appendChild(opt);
    });
    select.disabled = !parent;
  }

  function fillSiteChildSelect(select, parentSlug, midSlug, selected) {
    select.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = midSlug ? "Alt kategori" : "Önce ara kategori";
    select.appendChild(empty);
    const parent = siteCategories.find((cat) => cat.slug === parentSlug);
    const mid =
      parent && Array.isArray(parent.children)
        ? parent.children.find((row) => row.slug === midSlug)
        : null;
    const leaves = mid && Array.isArray(mid.children) && mid.children.length
      ? mid.children
      : mid
        ? [mid]
        : [];
    leaves.forEach((child) => {
      const opt = document.createElement("option");
      opt.value = child.slug;
      opt.textContent = child.name;
      if (child.slug === selected) opt.selected = true;
      select.appendChild(opt);
    });
    select.disabled = !mid;
  }

  async function saveSupplierSiteCategory(item, parentSlug, midSlug, childSlug) {
    const updates = {
      supplierSku: item.supplierSku,
      supplierSlot: item.supplierSlot,
      siteParent: parentSlug || "",
      siteMid: midSlug || "",
      siteChild: childSlug || "",
    };
    if (item.active && !(parentSlug && childSlug)) updates.active = false;
    await updateSupplierProducts([updates]);
  }

  function poolPageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, total, current - 1, current, current + 1]);
    if (current <= 3) {
      set.add(2);
      set.add(3);
      set.add(4);
    }
    if (current >= total - 2) {
      set.add(total - 3);
      set.add(total - 2);
      set.add(total - 1);
    }
    return Array.from(set)
      .filter((n) => n >= 1 && n <= total)
      .sort((a, b) => a - b);
  }

  function renderSupplierPager(totalPages) {
    const pager = document.getElementById("supplierPoolPager");
    if (!pager) return;
    pager.textContent = "";
    if (totalPages <= 1) {
      pager.hidden = true;
      return;
    }
    pager.hidden = false;
    const addBtn = (label, page, options) => {
      const opts = options || {};
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (opts.current) btn.className = "is-current";
      btn.disabled = !!opts.disabled;
      if (opts.current) btn.setAttribute("aria-current", "page");
      btn.addEventListener("click", () => {
        supplierPoolPage = page;
        loadSupplierData().catch((err) => {
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        });
      });
      pager.appendChild(btn);
    };
    addBtn("‹", supplierPoolPage - 1, { disabled: supplierPoolPage <= 1 });
    let prev = 0;
    poolPageNumbers(supplierPoolPage, totalPages).forEach((page) => {
      if (prev && page - prev > 1) {
        const dots = document.createElement("span");
        dots.className = "admin-pager-ellipsis";
        dots.textContent = "…";
        pager.appendChild(dots);
      }
      addBtn(String(page), page, { current: page === supplierPoolPage });
      prev = page;
    });
    addBtn("›", supplierPoolPage + 1, { disabled: supplierPoolPage >= totalPages });
  }

  function renderSupplierProducts() {
    supplierRows.textContent = "";
    const page = pagedSupplierProducts();
    const shown = page.shown;
    const visibleTotal = page.listTotal;
    const end = visibleTotal ? page.start + shown.length : 0;
    const catalogCount = Number(supplierPoolMeta.catalogCount) || 0;
    document.getElementById("supplierVisibleCount").textContent = visibleTotal
      ? page.start +
        1 +
        "–" +
        end +
        " / " +
        visibleTotal +
        " ürün" +
        (visibleTotal !== catalogCount && catalogCount
          ? " (filtre: " + catalogCount + ")"
          : "") +
        (page.totalPages > 1 ? " · sayfa " + (supplierPoolMeta.page || 1) + "/" + page.totalPages : "")
      : "0 / " + catalogCount + " ürün";
    const selectAll = document.getElementById("supplierSelectAll");
    if (selectAll) {
      selectAll.checked =
        shown.length > 0 &&
        shown.every((item) =>
          selectedSupplierSkus.has(item.supplierSlot + "|" + item.supplierSku)
        );
    }
    if (!visibleTotal) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 11;
      cell.className = "admin-table-empty";
      cell.textContent = catalogCount
        ? "Filtrelere uygun XML ürünü bulunamadı."
        : supplierSlots.some((slot) => /g[uü]nl[uü]k|s[iı]n[iı]r/i.test(String(slot.lastError || "")))
          ? emptyPoolQuotaMessage()
          : supplierSlots.some((slot) => slot.configured)
          ? "Havuz boş: son XML okuması ürün getirmedi. Sonraki başarılı okumada katalog dolacak; mevcut yayındaki stok dondurulur, stoksuz işaretlenmez."
          : "XML bağlantısını kaydedip ürünleri güncelleyin.";
      row.appendChild(cell);
      supplierRows.appendChild(row);
      renderSupplierPager(1);
      updateDashboard();
      return;
    }

    shown.forEach((item) => {
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
      const media = (Array.isArray(item.images) && item.images[0]) || item.image
        ? Object.assign(document.createElement("img"), {
            src: (Array.isArray(item.images) && item.images[0]) || item.image,
            alt: item.name || "",
            loading: "lazy",
            referrerPolicy: "no-referrer",
          })
        : Object.assign(document.createElement("div"), {
            className: "ph",
            textContent: (item.brand || "?").slice(0, 3),
          });
      if (media.tagName === "IMG") {
        media.addEventListener("error", () => {
          const fallback = (item.images || []).find((url) => url && url !== media.src);
          if (fallback && media.dataset.fallback !== "1") {
            media.dataset.fallback = "1";
            media.src = fallback;
            return;
          }
          const ph = document.createElement("div");
          ph.className = "ph";
          ph.textContent = (item.brand || "?").slice(0, 3);
          media.replaceWith(ph);
        });
        media.style.cursor = "pointer";
        media.title = "Görselleri ve açıklamayı düzenle";
        media.addEventListener("click", () => openSupplierFeedModal(item));
      }
      const text = document.createElement("div");
      const nameInput = document.createElement("input");
      nameInput.className = "admin-name-input";
      nameInput.type = "text";
      nameInput.maxLength = 180;
      nameInput.value = item.name || "";
      nameInput.title = item.nameOverride
        ? "Panelde özelleştirilmiş ürün adı"
        : "Ürün adını düzenleyebilirsiniz";
      nameInput.addEventListener("change", async () => {
        const nextName = String(nameInput.value || "").trim();
        if (!nextName) {
          nameInput.value = item.name || "";
          note(document.getElementById("supplierProductsNote"), "err", "Ürün adı boş olamaz.");
          return;
        }
        nameInput.disabled = true;
        try {
          await updateSupplierProducts([
            {
              supplierSku: item.supplierSku,
              supplierSlot: item.supplierSlot,
              name: nextName,
            },
          ]);
          note(document.getElementById("supplierProductsNote"), "ok", "Ürün adı güncellendi.");
        } catch (err) {
          nameInput.value = item.name || "";
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        } finally {
          nameInput.disabled = false;
        }
      });
      const brand = document.createElement("span");
      brand.textContent = item.brand + " · " + item.category;
      text.appendChild(nameInput);
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
      const stockValue = item.stockQty;
      stockCell.textContent = stockValue === null ? "—" : String(stockValue);
      const critical = Number(item.criticalStockQty);
      const fetchedAt = item.lastSuccessfulFetchAt
        ? new Date(item.lastSuccessfulFetchAt).toLocaleString("tr-TR")
        : "";
      if (
        item.catalogStale !== true &&
        Number.isFinite(critical) &&
        Number.isFinite(Number(stockValue)) &&
        Number(stockValue) <= critical
      ) {
        stockCell.title =
          "Kritik stok eşiği (" +
          critical +
          ") altında; site ve Akakçe feed’de stoksuz sayılır." +
          (fetchedAt ? " Son XML okuma: " + fetchedAt : "");
        stockCell.classList.add("is-critical-stock");
      } else if (item.catalogStale) {
        stockCell.title =
          "XML okunamadı; stok son başarılı katalogdan donduruldu." +
          (fetchedAt ? " Son başarılı okuma: " + fetchedAt : "");
      } else {
        stockCell.title = fetchedAt
          ? "Son XML okumasındaki stok adedi (" + fetchedAt + ")."
          : "Son XML okumasındaki stok adedi.";
      }

      const categoryCell = document.createElement("td");
      const catWrap = document.createElement("div");
      catWrap.className = "admin-cat-selects";
      const parentSelect = document.createElement("select");
      parentSelect.setAttribute("aria-label", item.name + " ana kategorisi");
      const midSelect = document.createElement("select");
      midSelect.setAttribute("aria-label", item.name + " ara kategorisi");
      const childSelect = document.createElement("select");
      childSelect.setAttribute("aria-label", item.name + " alt kategorisi");
      fillSiteParentSelect(parentSelect, item.siteParent || "");
      fillSiteMidSelect(midSelect, item.siteParent || "", item.siteMid || "");
      fillSiteChildSelect(childSelect, item.siteParent || "", item.siteMid || "", item.siteChild || "");
      parentSelect.addEventListener("change", async () => {
        const parentSlug = parentSelect.value;
        fillSiteMidSelect(midSelect, parentSlug, "");
        fillSiteChildSelect(childSelect, parentSlug, "", "");
        parentSelect.disabled = true;
        midSelect.disabled = true;
        childSelect.disabled = true;
        try {
          await saveSupplierSiteCategory(item, parentSlug, "", "");
          note(
            document.getElementById("supplierProductsNote"),
            parentSlug ? "" : "ok",
            parentSlug
              ? "Ara ve alt kategori seçin; seçilmeden ürün yayına alınamaz."
              : "Site kategorisi temizlendi; ürün yayından çıkarıldı."
          );
        } catch (err) {
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        }
      });
      midSelect.addEventListener("change", async () => {
        const parentSlug = parentSelect.value;
        const midSlug = midSelect.value;
        fillSiteChildSelect(childSelect, parentSlug, midSlug, "");
        parentSelect.disabled = true;
        midSelect.disabled = true;
        childSelect.disabled = true;
        try {
          await saveSupplierSiteCategory(item, parentSlug, midSlug, "");
          note(
            document.getElementById("supplierProductsNote"),
            "",
            midSlug ? "Alt kategori seçin; seçilmeden ürün yayına alınamaz." : "Ara kategori temizlendi."
          );
        } catch (err) {
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        }
      });
      childSelect.addEventListener("change", async () => {
        const parentSlug = parentSelect.value;
        const midSlug = midSelect.value;
        const childSlug = childSelect.value;
        parentSelect.disabled = true;
        midSelect.disabled = true;
        childSelect.disabled = true;
        try {
          await saveSupplierSiteCategory(item, parentSlug, midSlug, childSlug);
          note(
            document.getElementById("supplierProductsNote"),
            childSlug ? "ok" : "",
            childSlug
              ? "Site kategorisi kaydedildi."
              : "Alt kategori seçilmeden ürün yayına alınamaz."
          );
        } catch (err) {
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        }
      });
      catWrap.appendChild(parentSelect);
      catWrap.appendChild(midSelect);
      catWrap.appendChild(childSelect);
      if (!item.siteCategoryAssigned) {
        const missing = document.createElement("span");
        missing.className = "admin-cat-missing";
        missing.textContent = "Kategori yok — yayına alınamaz";
        catWrap.appendChild(missing);
      }
      categoryCell.appendChild(catWrap);

      const feedCell = document.createElement("td");
      const feedWrap = document.createElement("div");
      feedWrap.className = "admin-feed-cell";
      const feedBadge = document.createElement("span");
      feedBadge.className =
        "admin-badge " + (item.feedReady ? "on" : item.active ? "err" : "pending");
      feedBadge.textContent = item.feedReady ? "Hazır" : item.active ? "Eksik" : "—";
      if (Array.isArray(item.feedIssues) && item.feedIssues.length) {
        feedBadge.title = item.feedIssues.join(", ");
      }
      const feedEditBtn = document.createElement("button");
      feedEditBtn.type = "button";
      feedEditBtn.className = "btn btn-ghost btn-xs";
      feedEditBtn.textContent = "Düzenle";
      feedEditBtn.addEventListener("click", () => openSupplierFeedModal(item));
      feedWrap.appendChild(feedBadge);
      feedWrap.appendChild(feedEditBtn);
      feedCell.appendChild(feedWrap);

      const activeCell = document.createElement("td");
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "admin-switch";
      toggleLabel.setAttribute("aria-label", item.name + " yayın durumunu değiştir");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = !!item.active;
      toggle.disabled = !item.siteCategoryAssigned;
      toggle.title = item.siteCategoryAssigned
        ? "Yayın durumunu değiştir"
        : "Önce site kategorisi seçin";
      const track = document.createElement("span");
      toggle.addEventListener("change", async () => {
        if (toggle.checked && !item.siteCategoryAssigned) {
          toggle.checked = false;
          note(
            document.getElementById("supplierProductsNote"),
            "err",
            "Site kategorisi seçilmeden ürün yayına alınamaz."
          );
          return;
        }
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
              ? item.feedReady
                ? "Ürün yayına alındı; site ve export XML’inde listelenir."
                : "Ürün yayına alındı; export için eksik alanları tamamlayın (Export → Düzenle)."
              : "Ürün yayından kaldırıldı; site ve export XML’inden çıkarıldı."
          );
        } catch (err) {
          toggle.checked = !toggle.checked;
          note(document.getElementById("supplierProductsNote"), "err", err.message);
        } finally {
          toggle.disabled = !item.siteCategoryAssigned;
        }
      });
      toggleLabel.appendChild(toggle);
      toggleLabel.appendChild(track);
      activeCell.appendChild(toggleLabel);
      if (item.unlisted) {
        toggle.disabled = true;
        toggle.title = "Listelenmeyen Ürünler sekmesinden tekrar listeleyin";
        const unlistedBadge = document.createElement("span");
        unlistedBadge.className = "admin-badge err";
        unlistedBadge.textContent = "Listelenmiyor";
        activeCell.appendChild(unlistedBadge);
      } else {
        const unlistBtn = document.createElement("button");
        unlistBtn.type = "button";
        unlistBtn.className = "btn btn-ghost btn-xs";
        unlistBtn.textContent = "Listeden çıkar";
        unlistBtn.addEventListener("click", () => {
          unlistSupplierProduct(item).catch((err) =>
            note(document.getElementById("supplierProductsNote"), "err", err.message)
          );
        });
        activeCell.appendChild(unlistBtn);
      }

      [
        checkCell,
        productCell,
        skuCell,
        sourceCell,
        costCell,
        marginCell,
        saleCell,
        stockCell,
        categoryCell,
        feedCell,
        activeCell,
      ].forEach((cell) => row.appendChild(cell));
      supplierRows.appendChild(row);
    });
    renderSupplierPager(page.totalPages);
    updateDashboard();
  }

  async function loadSupplierData() {
    if (!siteCategories.length) await loadSiteCategories();
    const results = await Promise.all([
      // feed=1 runs full Akakçe analysis on the whole catalog and blocks the event loop.
      api("/api/admin/supplier/status"),
      api("/api/admin/supplier/products?" + supplierQueryString()),
    ]);
    supplierSlots = Array.isArray(results[0].slots)
      ? results[0].slots
      : Array.isArray(results[1].slots)
        ? results[1].slots
        : [];
    feedStatus = results[0].feed || feedStatus || null;
    supplierProducts = Array.isArray(results[1].products) ? results[1].products : [];
    supplierPoolMeta = {
      total: Number(results[1].total) || 0,
      page: Number(results[1].page) || 1,
      totalPages: Number(results[1].totalPages) || 1,
      catalogCount: Number(results[1].catalogCount) || 0,
      activeCount: Number(results[1].activeCount) || 0,
      limit: Number(results[1].limit) || POOL_PAGE_SIZE,
    };
    renderUnlistedNavCount(unlistedTotal(results[1]));
    supplierPoolPage = supplierPoolMeta.page;
    renderXmlYesterdayAlert(results[0].yesterdayXmlAlert);
    renderOpsHealth(results[0].opsHealth);
    const scheduleHint = document.getElementById("supplierScheduleHint");
    if (scheduleHint && results[0].schedule && results[0].nextScheduled) {
      scheduleHint.textContent =
        "Otomatik XML okuma: " +
        results[0].schedule.summary +
        ". Sonraki okuma: " +
        results[0].nextScheduled.label +
        " (" +
        results[0].nextScheduled.timezone +
        ").";
    }
    renderSupplierStatus();
    renderSupplierProducts();
    renderList();
    // Feed diagnostics load in the background so panel actions stay responsive.
    api("/api/admin/supplier/status?feed=1", { timeout: 90000 })
      .then((feedData) => {
        if (feedData && feedData.feed) {
          feedStatus = feedData.feed;
          if (Array.isArray(feedData.slots)) supplierSlots = feedData.slots;
          renderSupplierStatus();
          updateDashboard();
        }
      })
      .catch(() => {});
  }

  async function updateSupplierProducts(updates) {
    await api("/api/admin/supplier/products", {
      method: "PATCH",
      body: JSON.stringify({ updates }),
    });
    await loadSupplierData();
  }

  function renderUnlistedNavCount(count) {
    const badge = document.getElementById("unlistedNavCount");
    if (!badge) return;
    const value = Number(count) || 0;
    badge.hidden = value <= 0;
    badge.textContent = value > 0 ? String(value) : "";
  }

  async function unlistSupplierProduct(item) {
    const reason = window.prompt(
      "“" + item.name + "” sitede ve Akakçe XML'inde listelenmeyecek.\nGerekçe (isteğe bağlı, ör. “Tedarikçi yanlış kategoride”):",
      ""
    );
    if (reason === null) return;
    await updateSupplierProducts([
      {
        supplierSku: item.supplierSku,
        supplierSlot: item.supplierSlot,
        unlisted: true,
        unlistedReason: reason.trim(),
      },
    ]);
    notifySite();
    note(
      document.getElementById("supplierProductsNote"),
      "ok",
      "Ürün listeden çıkarıldı; “Listelenmeyen Ürünler” sekmesinde görünür."
    );
  }

  let unlistedPage = 1;
  let unlistedQuery = "";
  let unlistedReason = "";

  function unlistedTotal(data) {
    return (Number(data && data.unlistedCount) || 0) + (Number(data && data.menuMissingCount) || 0);
  }

  function renderUnlistedPager(totalPages) {
    const pager = document.getElementById("adminUnlistedPager");
    if (!pager) return;
    pager.textContent = "";
    pager.hidden = totalPages <= 1;
    if (totalPages <= 1) return;
    const addBtn = (label, page, opts) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (opts && opts.current) btn.className = "is-current";
      btn.disabled = !!(opts && opts.disabled);
      btn.addEventListener("click", () => {
        unlistedPage = page;
        loadUnlistedProducts().catch(() => {});
      });
      pager.appendChild(btn);
    };
    addBtn("‹", unlistedPage - 1, { disabled: unlistedPage <= 1 });
    addBtn(unlistedPage + " / " + totalPages, unlistedPage, { current: true, disabled: true });
    addBtn("›", unlistedPage + 1, { disabled: unlistedPage >= totalPages });
  }

  function unlistedMoveControls(item, noteEl) {
    const wrap = document.createElement("div");
    wrap.className = "admin-cat-selects";
    const parentSelect = document.createElement("select");
    const midSelect = document.createElement("select");
    const childSelect = document.createElement("select");
    [parentSelect, midSelect, childSelect].forEach((select, i) => {
      select.setAttribute("aria-label", ["Ana kategori", "Ara kategori", "Alt kategori"][i]);
    });
    fillSiteParentSelect(parentSelect, "");
    fillSiteMidSelect(midSelect, "", "");
    fillSiteChildSelect(childSelect, "", "", "");
    parentSelect.addEventListener("change", () => {
      fillSiteMidSelect(midSelect, parentSelect.value, "");
      fillSiteChildSelect(childSelect, parentSelect.value, "", "");
    });
    midSelect.addEventListener("change", () => {
      fillSiteChildSelect(childSelect, parentSelect.value, midSelect.value, "");
    });
    const move = document.createElement("button");
    move.type = "button";
    move.className = "btn btn-primary btn-xs";
    move.textContent = "Kategoriye taşı";
    move.addEventListener("click", async () => {
      if (!parentSelect.value || !midSelect.value || !childSelect.value) {
        note(noteEl, "err", "ANA, ARA ve ALT kategori seçin.");
        return;
      }
      move.disabled = true;
      try {
        await api("/api/admin/supplier/products", {
          method: "PATCH",
          body: JSON.stringify({
            updates: [
              {
                supplierSku: item.supplierSku,
                supplierSlot: item.supplierSlot,
                siteParent: parentSelect.value,
                siteMid: midSelect.value,
                siteChild: childSelect.value,
              },
            ],
          }),
        });
        notifySite();
        await loadUnlistedProducts();
        note(noteEl, "ok", (item.name || item.supplierSku) + " kategorisine taşındı; stok ve görsel uygunsa sitede görünür.");
      } catch (err) {
        move.disabled = false;
        note(noteEl, "err", err.message);
      }
    });
    [parentSelect, midSelect, childSelect, move].forEach((el) => wrap.appendChild(el));
    return wrap;
  }

  async function loadUnlistedProducts() {
    const rows = document.getElementById("adminUnlistedRows");
    const noteEl = document.getElementById("adminUnlistedNote");
    if (!rows) return;
    try {
      if (!siteCategories.length) await loadSiteCategories();
      const qs = new URLSearchParams({
        status: "unlisted",
        reason: unlistedReason,
        q: unlistedQuery,
        page: String(unlistedPage),
        limit: "50",
      });
      unlistedSort.apply(qs);
      const data = await api("/api/admin/supplier/products?" + qs.toString());
      const list = Array.isArray(data.products) ? data.products : [];
      unlistedPage = Number(data.page) || 1;
      renderUnlistedNavCount(unlistedTotal(data));
      renderUnlistedPager(Number(data.totalPages) || 1);
      rows.textContent = "";
      if (!list.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 6;
        td.className = "admin-table-empty";
        td.textContent = unlistedQuery ? "Aramaya uyan ürün yok." : "Listelenmeyen ürün yok.";
        tr.appendChild(td);
        rows.appendChild(tr);
      }
      list.forEach((item) => {
        const tr = document.createElement("tr");
        const cell = (text) => {
          const td = document.createElement("td");
          td.textContent = text || "—";
          tr.appendChild(td);
          return td;
        };
        cell(item.name);
        cell(item.supplierSku);
        cell(item.stockQty == null ? "" : String(item.stockQty));
        cell(
          [item.xmlMainCategory, item.xmlMidCategory, item.xmlSubCategory].filter(Boolean).join(" › ")
        );
        if (item.menuMissing) {
          const site = [item.siteParent, item.siteMid, item.siteChild].filter(Boolean).join(" › ");
          cell("Menüde kategorisi yok" + (site ? " (" + site + ")" : ""));
          const actionTd = document.createElement("td");
          actionTd.appendChild(unlistedMoveControls(item, noteEl));
          tr.appendChild(actionTd);
          rows.appendChild(tr);
          return;
        }
        cell(
          [item.unlistedReason, item.unlistedAt ? new Date(item.unlistedAt).toLocaleString("tr-TR") : ""]
            .filter(Boolean)
            .join(" · ") || "Listeden çıkarıldı"
        );
        const actionTd = document.createElement("td");
        const relist = document.createElement("button");
        relist.type = "button";
        relist.className = "btn btn-outline btn-xs";
        relist.textContent = "Tekrar listele";
        relist.addEventListener("click", async () => {
          relist.disabled = true;
          try {
            await api("/api/admin/supplier/products", {
              method: "PATCH",
              body: JSON.stringify({
                updates: [{ supplierSku: item.supplierSku, supplierSlot: item.supplierSlot, unlisted: false }],
              }),
            });
            notifySite();
            await loadUnlistedProducts();
            note(noteEl, "ok", "Ürün tekrar listelendi; yayın durumu XML Ürünleri'ndeki gibi kalır.");
          } catch (err) {
            relist.disabled = false;
            note(noteEl, "err", err.message);
          }
        });
        actionTd.appendChild(relist);
        tr.appendChild(actionTd);
        rows.appendChild(tr);
      });
      note(
        noteEl,
        "",
        "Toplam " + data.total + " ürün · listeden çıkarılan " + (Number(data.unlistedCount) || 0) +
          " · menüde kategorisi yok " + (Number(data.menuMissingCount) || 0)
      );
    } catch (err) {
      note(noteEl, "err", err.message || "Liste yüklenemedi");
    }
  }

  const unlistedRefreshBtn = document.getElementById("adminUnlistedRefresh");
  if (unlistedRefreshBtn) {
    unlistedRefreshBtn.addEventListener("click", () => loadUnlistedProducts().catch(() => {}));
  }
  const unlistedSearch = document.getElementById("adminUnlistedSearch");
  if (unlistedSearch) {
    let unlistedSearchTimer = null;
    unlistedSearch.addEventListener("input", () => {
      clearTimeout(unlistedSearchTimer);
      unlistedSearchTimer = setTimeout(() => {
        unlistedQuery = unlistedSearch.value.trim();
        unlistedPage = 1;
        loadUnlistedProducts().catch(() => {});
      }, 280);
    });
  }
  const unlistedReasonSelect = document.getElementById("adminUnlistedReason");
  if (unlistedReasonSelect) {
    unlistedReasonSelect.addEventListener("change", () => {
      unlistedReason = unlistedReasonSelect.value;
      unlistedPage = 1;
      loadUnlistedProducts().catch(() => {});
    });
  }

  let productsLoaded = false;

  async function refresh() {
    const data = await api("/api/admin/products");
    products = Array.isArray(data.products) ? data.products : [];
    productsLoaded = true;
    renderList();
  }

  async function ensureManualProducts() {
    if (productsLoaded) {
      renderList();
      return;
    }
    await refresh();
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
    productsLoaded = true;
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
  let supplierSearchTimer = 0;
  [supplierSearch, supplierStatusFilter, supplierSlotFilter].forEach((control) => {
    if (!control) return;
    control.addEventListener(control.tagName === "INPUT" ? "input" : "change", () => {
      supplierPoolPage = 1;
      if (control === supplierSearch) {
        clearTimeout(supplierSearchTimer);
        supplierSearchTimer = setTimeout(() => {
          loadSupplierData().catch((err) => {
            note(document.getElementById("supplierProductsNote"), "err", err.message);
          });
        }, 250);
        return;
      }
      loadSupplierData().catch((err) => {
        note(document.getElementById("supplierProductsNote"), "err", err.message);
      });
    });
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
          timeout: 100000,
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

  document.querySelectorAll(".supplier-publish-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const slotId = button.dataset.slotId;
      const card = button.closest("[data-supplier-card]");
      const statusNote = card.querySelector('[data-slot-field="note"]');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Yayınlanıyor…";
      note(statusNote, "", "Kategoriler eşleniyor, ürünler siteye alınıyor…");
      try {
        const data = await api("/api/admin/supplier/publish", {
          method: "POST",
          body: JSON.stringify({ slotId }),
          timeout: 100000,
        });
        selectedSupplierSkus.clear();
        await loadSupplierData();
        await loadCategoryTree().catch(() => {});
        notifySite();
        const assigned = data && data.result ? data.result.assigned : 0;
        note(
          statusNote,
          "ok",
          assigned +
            " ürün kategori eşlendi ve yayına alındı. Stok/fiyat kuralını geçenler vitrinde görünür."
        );
      } catch (err) {
        note(statusNote, "err", err.message);
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
      const criticalStockEl = form.querySelector('[data-slot-input="criticalStock"]');
      const criticalStockQty = criticalStockEl ? Number(criticalStockEl.value) : undefined;
      const button = ev.submitter || form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api("/api/admin/supplier/settings", {
          method: "PUT",
          body: JSON.stringify({
            slotId,
            globalMarginPercent: margin,
            criticalStockQty,
          }),
        });
        await loadSupplierData();
        notifySite();
        note(statusNote, "ok", "Bu XML kaynağının ayarları güncellendi.");
      } catch (err) {
        note(statusNote, "err", err.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  if (supplierFeedFields.category) {
    supplierFeedFields.category.addEventListener("change", () => {
      applySupplierFeedCategoryDefaults(true);
    });
  }

  if (supplierFeedForm) {
    supplierFeedForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const saveBtn = document.getElementById("saveSupplierFeedBtn");
      if (saveBtn) saveBtn.disabled = true;
      note(supplierFeedFormNote, "", "Kaydediliyor…");
      try {
        const payload = {
          supplierSku: supplierFeedFields.supplierSku.value,
          supplierSlot: supplierFeedFields.supplierSlot.value,
          name: supplierFeedFields.name.value,
          brand: supplierFeedFields.brand.value,
          manufacturerCode: supplierFeedFields.manufacturerCode.value,
          barcode: supplierFeedFields.barcode.value,
          gtipCode: supplierFeedFields.gtip.value,
          specialCode: supplierFeedFields.specialCode.value,
          vatPercent: Number(supplierFeedFields.vat.value),
          currency: supplierFeedFields.currency.value,
          unit: supplierFeedFields.unit.value,
          category: supplierFeedFields.category.value,
          mainCategory: supplierFeedFields.mainCategory.value,
          midCategory: supplierFeedFields.midCategory.value,
          subCategory: supplierFeedFields.subCategory.value,
          description: supplierFeedFields.description.value,
          details: supplierFeedFields.details ? supplierFeedFields.details.value : "",
          image: supplierFeedImages[0] || "",
          images: supplierFeedImages.slice(0, MAX_PRODUCT_IMAGES),
        };
        await updateSupplierProducts([payload]);
        notifySite();
        closeSupplierFeedModal();
        note(
          document.getElementById("supplierProductsNote"),
          "ok",
          "Export bilgileri kaydedildi."
        );
      } catch (err) {
        note(supplierFeedFormNote, "err", err.message || "Kaydedilemedi");
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  if (supplierFeedFields.imageFile) {
    supplierFeedFields.imageFile.addEventListener("change", async () => {
      const files = Array.from(supplierFeedFields.imageFile.files || []).slice(
        0,
        Math.max(0, MAX_PRODUCT_IMAGES - supplierFeedImages.length)
      );
      if (!files.length) return;
      note(supplierFeedFormNote, "", files.length + " görsel yükleniyor…");
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
              name: supplierFeedFields.supplierSku.value || file.name,
            }),
          });
          const url = String(uploaded.url || "");
          supplierFeedImages.push(
            url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "/" + url
          );
        }
        supplierFeedFields.imageFile.value = "";
        renderSupplierFeedImagePreviews();
        note(supplierFeedFormNote, "ok", files.length + " görsel yüklendi.");
      } catch (err) {
        note(supplierFeedFormNote, "err", err.message || "Görsel yüklenemedi");
      }
    });
  }

  const sFeedImageUrlBtn = document.getElementById("sFeedImageUrlBtn");
  if (sFeedImageUrlBtn && supplierFeedFields.imageUrl) {
    sFeedImageUrlBtn.addEventListener("click", () => {
      const href = String(supplierFeedFields.imageUrl.value || "").trim();
      if (!href) {
        note(supplierFeedFormNote, "err", "Eklenecek görsel adresini yazın.");
        return;
      }
      if (supplierFeedImages.length >= MAX_PRODUCT_IMAGES) {
        note(supplierFeedFormNote, "err", "En fazla " + MAX_PRODUCT_IMAGES + " görsel eklenebilir.");
        return;
      }
      if (supplierFeedImages.indexOf(href) >= 0) {
        note(supplierFeedFormNote, "err", "Bu görsel zaten galeride.");
        return;
      }
      supplierFeedImages.push(href);
      supplierFeedFields.imageUrl.value = "";
      renderSupplierFeedImagePreviews();
      note(supplierFeedFormNote, "ok", "Görsel galeriye eklendi.");
    });
  }

  [
    document.getElementById("closeSupplierFeedModalBtn"),
    document.getElementById("cancelSupplierFeedModalBtn"),
    ...document.querySelectorAll("[data-close-supplier-feed-modal]"),
  ].forEach((el) => {
    if (!el) return;
    el.addEventListener("click", () => closeSupplierFeedModal());
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isSupplierFeedModalOpen()) {
      closeSupplierFeedModal();
    }
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
    pagedSupplierProducts().shown.forEach((item) => {
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
    const selected = Array.from(selectedSupplierSkus).map((key) => {
      const separator = key.indexOf("|");
      return {
        supplierSlot: key.slice(0, separator),
        supplierSku: key.slice(separator + 1),
      };
    });
    const updates = active
      ? selected.filter((row) => {
          const product = supplierProducts.find(
            (item) =>
              item.supplierSlot === row.supplierSlot && item.supplierSku === row.supplierSku
          );
          return product && product.siteCategoryAssigned;
        })
      : selected;
    const skipped = selected.length - updates.length;
    if (active && !updates.length) {
      note(
        document.getElementById("supplierProductsNote"),
        "err",
        "Seçilen ürünlerin site kategorisi yok. Önce kategori atayın."
      );
      return;
    }
    try {
      await updateSupplierProducts(
        updates.map((row) => Object.assign({ active }, row))
      );
      selectedSupplierSkus.clear();
      document.getElementById("supplierSelectAll").checked = false;
      notifySite();
      note(
        document.getElementById("supplierProductsNote"),
        "ok",
        active
          ? "Seçilen ürünler site ve Akakçe XML’i için aktif edildi." +
            (skipped ? " " + skipped + " kategorisiz ürün atlandı." : "")
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

  if (passwordChangeForm) {
    passwordChangeForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const currentPassword = document.getElementById("currentPasswordChange").value;
      const newPassword = document.getElementById("newPasswordChange").value;
      const confirmPassword = document.getElementById("confirmPasswordChange").value;
      note(passwordChangeNote, "", "Kaydediliyor…");
      try {
        await api("/api/admin/change-password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
        });
        showPasswordChangeGate(false);
        note(passwordChangeNote, "ok", "Şifre güncellendi.");
        await bootAuthedWorkspace();
      } catch (err) {
        note(passwordChangeNote, "err", err.message || "Şifre güncellenemedi.");
      }
    });
  }

  if (xmlYesterdayAlertDismiss) {
    xmlYesterdayAlertDismiss.addEventListener("click", async () => {
      const date = xmlYesterdayAlertDismiss.dataset.alertDate || "";
      try {
        await api("/api/admin/supplier/xml-alert/dismiss", {
          method: "POST",
          body: JSON.stringify({ date }),
        });
      } catch (_) {}
      if (xmlYesterdayAlert) xmlYesterdayAlert.hidden = true;
      api("/api/admin/supplier/status")
        .then((data) => {
          renderXmlYesterdayAlert(data.yesterdayXmlAlert);
          renderOpsHealth(data.opsHealth);
        })
        .catch(() => {});
    });
  }

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
      let data;
      try {
        data = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify(payload),
          timeout: 60000,
        });
      } catch (firstErr) {
        const msg = String((firstErr && firstErr.message) || "");
        const retryable =
          /yanıt vermedi|ulaşılamadı|zaman aşımı|Failed to fetch|NetworkError|API isteği/i.test(msg) &&
          !/E-posta veya şifre|Şifre hatalı|şifre hatalı/i.test(msg);
        if (!retryable) throw firstErr;
        note(loginNote, "", "Bağlantı yenileniyor, tekrar deneniyor…");
        await new Promise((r) => setTimeout(r, 900));
        data = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify(payload),
          timeout: 60000,
        });
      }
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      showPanel(true);
      note(loginNote, "", "Panel yükleniyor…");
      await bootAuthedWorkspace();
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
    const token = sessionStorage.getItem("patygo_admin_token") || "";
    if (token) {
      fetch("/api/admin/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      }).catch(() => {});
    }
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
  syncPeriodPresets();

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
  const orderStatusFilter = document.getElementById("orderStatusFilter");
  const orderSearch = document.getElementById("orderSearch");
  const orderFrom = document.getElementById("orderFrom");
  const orderTo = document.getElementById("orderTo");
  const orderPeriodApply = document.getElementById("orderPeriodApply");
  const ORDER_PERIOD_KEY = "patygo_admin_orders_period";
  let selectedOrderId = "";
  let ordersCache = [];
  let orderSearchTimer = 0;

  function moneyTr(n) {
    return "₺" + Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatOrderDate(iso) {
    const text = String(iso || "").trim();
    if (!text) return "—";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function orderStatusLabel(status) {
    const map = {
      payment_pending: "Ödeme bekliyor",
      paid: "Ödendi",
      payment_failed: "Ödeme başarısız",
      new: "Yeni",
      preparing: "Hazırlanıyor",
      shipped: "Kargoda",
      delivered: "Teslim edildi",
      cancelled: "İptal",
      refunded: "İade",
      voided: "Sipariş iptali",
      partially_refunded: "Kısmi iade",
    };
    return map[status] || status || "—";
  }

  function orderStatusClass(status) {
    const map = {
      payment_pending: "order-status--pending",
      paid: "order-status--success",
      payment_failed: "order-status--failed",
      new: "order-status--new",
      preparing: "order-status--preparing",
      shipped: "order-status--shipped",
      delivered: "order-status--delivered",
      cancelled: "order-status--cancelled",
      refunded: "order-status--refunded",
      voided: "order-status--cancelled",
      partially_refunded: "order-status--refunded",
    };
    return map[status] || "order-status--neutral";
  }

  function orderStatusBadge(status) {
    return (
      "<span class='admin-status order-status " +
      orderStatusClass(status) +
      "'>" +
      orderStatusLabel(status) +
      "</span>"
    );
  }

  /** Aynı gün iptal (void) karttan çekim yapmaz; iade (refund) çekilen parayı geri gönderir. */
  function orderReversalKinds(order) {
    const kinds = new Set();
    (Array.isArray(order && order.paymentEvents) ? order.paymentEvents : []).forEach((ev) => {
      if (ev && ev.kind === "bank_reversal" && ev.success === true && !ev.dryRun) {
        kinds.add(ev.type === "void" ? "void" : "refund");
      }
    });
    return kinds;
  }

  function orderVoidedOnly(order) {
    const kinds = orderReversalKinds(order);
    return kinds.size === 1 && kinds.has("void");
  }

  function paymentStatusKey(order) {
    const paymentStatus = order && order.paymentStatus;
    if (paymentStatus === "refunded") return orderVoidedOnly(order) ? "voided" : "refunded";
    if (paymentStatus === "paid") return orderReversalKinds(order).size ? "partially_refunded" : "paid";
    if (paymentStatus === "failed") return "payment_failed";
    return "payment_pending";
  }

  function paymentStatusBadge(order) {
    return orderStatusBadge(paymentStatusKey(order));
  }

  function fulfillmentStatusKey(order) {
    const status = String((order && order.status) || "");
    if (status === "preparing" || status === "shipped" || status === "delivered" || status === "cancelled") {
      return status;
    }
    if (status === "paid" && order.paymentStatus === "paid") return "new";
    return "";
  }

  function fulfillmentStatusBadge(order) {
    const key = fulfillmentStatusKey(order);
    if (!key) {
      return "<span class='admin-status order-status order-status--empty'>—</span>";
    }
    return orderStatusBadge(key);
  }

  function orderInvoiceSummary(order) {
    if (order._bizimhesap === undefined) return order.invoiceSummary || null;
    const bh = order._bizimhesap;
    if (!(bh && bh.guid)) return null;
    const payload = bh.payload || {};
    return {
      invoiceNo: payload.invoiceNo || null,
      checkedAt: payload.invoiceCheckedAt || null,
      cancelled: Boolean(payload.cancel && payload.cancel.ok),
    };
  }

  function orderProgressStep(state, label, detail) {
    const mark = state === "done" ? "✓" : state === "todo" ? "○" : "–";
    return (
      "<span class='admin-order-step admin-order-step--" +
      state +
      "' title='" +
      escapeAttr(detail) +
      "'><span aria-hidden='true'>" +
      mark +
      "</span> " +
      label +
      "<span class='sr-only'>: " +
      escapeHtml(detail) +
      "</span></span>"
    );
  }

  /** Invoice → shipping checkpoints shown in the order list. */
  function orderProgressHtml(order) {
    const invoice = orderInvoiceSummary(order);
    const status = String(order.status || "");
    const shipped = Boolean(order.trackingCode) || status === "shipped" || status === "delivered";
    const open = order.paymentStatus === "paid" && status !== "cancelled";
    if (!open && !invoice && !shipped) {
      return "<span class='admin-order-step admin-order-step--none'>—</span>";
    }
    let invoiceStep;
    if (invoice && invoice.invoiceNo) {
      invoiceStep = orderProgressStep("done", "Fatura", "Fatura kesildi, Belge No " + invoice.invoiceNo);
    } else if (invoice && invoice.cancelled) {
      invoiceStep = orderProgressStep("na", "Fatura", "BizimHesap kaydı iptal edildi");
    } else if (!invoice && order.invoiceUntracked) {
      invoiceStep = orderProgressStep("na", "Fatura", "BizimHesap entegrasyonundan önceki sipariş; panelde fatura kaydı yok");
    } else if (open) {
      invoiceStep = orderProgressStep(
        "todo",
        "Fatura",
        !invoice ? "BizimHesap'a aktarılmadı" : invoice.checkedAt ? "Fatura kesilmedi" : "Fatura durumu henüz kontrol edilmedi"
      );
    } else {
      invoiceStep = orderProgressStep("na", "Fatura", "Fatura yok");
    }
    const shippingStep = shipped
      ? orderProgressStep("done", "Kargo", "Kargoya verildi" + (order.shippingCarrier ? ", " + order.shippingCarrier : ""))
      : open
        ? orderProgressStep("todo", "Kargo", "Kargoya verilmedi")
        : orderProgressStep("na", "Kargo", "Kargo yok");
    return invoiceStep + shippingStep;
  }

  function escapeAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let shippingCarriers = [
    "Yurtiçi Kargo",
    "Aras Kargo",
    "MNG Kargo",
    "PTT Kargo",
    "Sürat Kargo",
    "UPS",
    "DHL",
    "Diğer",
  ];

  function defaultOrderPeriod(days) {
    const to = new Date();
    const from = new Date();
    const span = Math.max(1, Number(days) || 30);
    from.setUTCDate(from.getUTCDate() - (span - 1));
    return { from: isoDate(from), to: isoDate(to) };
  }

  function readSavedOrderPeriod() {
    try {
      const raw = localStorage.getItem(ORDER_PERIOD_KEY);
      if (raw) return rollSavedRange(JSON.parse(raw), 30);
    } catch (_) {}
    return defaultOrderPeriod(30);
  }

  function saveOrderPeriod(from, to) {
    try {
      localStorage.setItem(ORDER_PERIOD_KEY, storedRange(from, to));
    } catch (_) {}
  }

  function syncOrderPeriodInputs(from, to) {
    if (orderFrom) orderFrom.value = from;
    if (orderTo) orderTo.value = to;
  }

  function currentOrderPeriod() {
    let from = orderFrom && orderFrom.value;
    let to = orderTo && orderTo.value;
    if (!from || !to) {
      const saved = readSavedOrderPeriod();
      from = saved.from;
      to = saved.to;
      syncOrderPeriodInputs(from, to);
    }
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
      syncOrderPeriodInputs(from, to);
    }
    saveOrderPeriod(from, to);
    return { from, to };
  }

  function setOrderPeriodDays(days) {
    const range = defaultOrderPeriod(days);
    syncOrderPeriodInputs(range.from, range.to);
    saveOrderPeriod(range.from, range.to);
  }

  function currentOrderSearch() {
    return String(orderSearch && orderSearch.value ? orderSearch.value : "").trim();
  }

  function orderListQueryString() {
    const period = currentOrderPeriod();
    const params = new URLSearchParams();
    params.set("from", period.from);
    params.set("to", period.to);
    const status = orderStatusFilter ? orderStatusFilter.value : "";
    if (status) params.set("status", status);
    const q = currentOrderSearch();
    if (q) params.set("q", q);
    orderSort.apply(params);
    return params.toString();
  }

  function orderStatusMailLabels() {
    return {
      paid: "Ödeme alındı",
      preparing: "Hazırlanıyor",
      shipped: "Kargoda",
      delivered: "Teslim edildi",
      cancelled: "İptal",
      refunded: "İade",
    };
  }

  function formatOrderMailFeedback(result) {
    if (!result) return "Kaydedildi.";
    if (result.mailSent) {
      const to = result.mailTo ? " (" + result.mailTo + ")" : "";
      return "Müşteriye bilgilendirme maili gönderildi" + to + ".";
    }
    const reason = String(result.mailReason || "");
    if (reason === "already_notified") {
      return "Bu durum için mail daha önce gönderilmiş. Tekrar göndermek için kutucuğu işaretleyin.";
    }
    if (reason === "smtp_not_configured") {
      return "Canlı SMTP yok; mail gönderilmedi.";
    }
    if (reason === "no_email") return "Müşteri e-postası yok; mail gönderilmedi.";
    return "Kayıt yapıldı; mail gönderilmedi.";
  }

  function renderOrderMailLog(order, mails) {
    const customerEmail = String((order.customer && order.customer.email) || "").trim();
    const rows = Array.isArray(mails) ? mails : [];
    if (!rows.length) {
      return "<li class='admin-order-mail-log-item admin-order-mail-log-item--empty'>Henüz müşteriye bilgilendirme maili gitmedi.</li>";
    }
    return rows
      .map(function (row) {
        const label =
          orderStatusMailLabels()[row.status] ||
          (String(row.status).indexOf("partial_refund") === 0 ? "Kısmi iade" : row.status);
        return (
          "<li class='admin-order-mail-log-item admin-order-mail-log-item--sent'>" +
          "<span class='admin-order-mail-badge admin-order-mail-badge--sent'>Gönderildi</span> " +
          "<span class='admin-order-mail-label'>" +
          escapeHtml(label) +
          " bildirimi</span> · " +
          "<time datetime='" +
          escapeAttr(row.sentAt || "") +
          "'>" +
          escapeHtml(formatOrderDate(row.sentAt)) +
          "</time>" +
          (customerEmail ? " · <span class='admin-order-mail-to'>" + escapeHtml(customerEmail) + "</span>" : "") +
          "</li>"
        );
      })
      .join("");
  }

  function renderOrderMailStatusBanner(order, mails) {
    const customerEmail = String((order.customer && order.customer.email) || "").trim();
    const rows = Array.isArray(mails) ? mails : [];
    const shippedMail = rows.find(function (row) {
      return row && row.status === "shipped";
    });
    const notice = order && order._mailNotice;
    let html = "";
    if (notice && notice.text) {
      html +=
        "<p class='admin-order-mail-banner admin-order-mail-banner--" +
        escapeAttr(notice.type || "ok") +
        "' role='status'>" +
        escapeHtml(notice.text) +
        "</p>";
    }
    if (order.status === "shipped" && order.shippingCarrier && order.trackingCode) {
      if (shippedMail) {
        html +=
          "<p class='admin-order-mail-banner admin-order-mail-banner--ok'>" +
          "<strong>Kargo maili müşteriye gitti.</strong> " +
          escapeHtml(formatOrderDate(shippedMail.sentAt)) +
          (customerEmail ? " · " + escapeHtml(customerEmail) : "") +
          "</p>";
      } else {
        html +=
          "<p class='admin-order-mail-banner admin-order-mail-banner--warn'>" +
          "<strong>Kargo kayıtlı ama mail gitmemiş görünüyor.</strong> " +
          "Alttaki “Kargoyu kaydet ve müşteriye bildir” ile gönderin." +
          "</p>";
      }
    }
    return html;
  }

  function bankEventLabel(ev) {
    if (ev && ev.kind === "bank_reversal") {
      const base = ev.type === "void" ? "Sipariş iptali" : "İade";
      if (ev.dryRun) return base + " (deneme)";
      if (ev.unknown) return base + " — sonuç bilinmiyor";
      return ev.success ? base : base + " — reddedildi";
    }
    if (ev && ev.outcome === "paid") return "Ödeme onayı";
    return "Banka cevabı" + (ev && ev.outcome ? " (" + ev.outcome + ")" : "");
  }

  function bankPaymentBlock(order) {
    const br = order.bankResponse || null;
    const events = Array.isArray(order.paymentEvents) ? order.paymentEvents : [];
    let rows = "";
    if (br) {
      const fields = [
        ["Sipariş no (bankada)", order.id],
        ["Sonuç kodu", br.responseCode],
        ["Mesaj", br.responseMessage],
        ["Auth / onay", br.authCode],
        ["Host ref", br.hostRefNum || br.hostRefNumber],
        ["Host log", br.hostLogKey],
        ["RRN", br.rrn],
        ["Tutar (banka)", br.amount],
        ["Hash OK", br.hashOk === true ? "evet" : br.hashOk === false ? "hayır" : "—"],
        ["Tutar eşleşti", br.amountOk === true ? "evet" : br.amountOk === false ? "hayır" : "—"],
        ["Outcome", br.outcome],
        ["Zaman", br.at ? formatOrderDate(br.at) : null],
      ];
      rows = fields
        .filter((pair) => pair[1] != null && String(pair[1]).trim() !== "")
        .map(
          (pair) =>
            "<div><dt>" +
            escapeHtml(pair[0]) +
            "</dt><dd>" +
            escapeHtml(String(pair[1])) +
            "</dd></div>"
        )
        .join("");
    }
    const hist =
      events.length > 0
        ? "<p class='admin-field-help'>Banka işlem geçmişi: " +
          String(events.length) +
          " kayıt (yeniden eskiye, en fazla 8). İptal, bankada satışın onay kodu ve RRN'i ile görünür.</p>" +
          "<ul class='admin-order-items'>" +
          events
            .slice()
            .reverse()
            .slice(0, 8)
            .map(function (ev) {
              const amount = Number(ev.amount);
              return (
                "<li>" +
                escapeHtml(formatOrderDate(ev.at || "")) +
                " · <strong>" +
                escapeHtml(bankEventLabel(ev)) +
                "</strong>" +
                (Number.isFinite(amount) && amount > 0 ? " · " + escapeHtml(moneyTr(amount)) : "") +
                " · " +
                escapeHtml(String(ev.responseCode || "—")) +
                (ev.authCode ? " · auth " + escapeHtml(String(ev.authCode)) : "") +
                (ev.rrn ? " · RRN " + escapeHtml(String(ev.rrn)) : "") +
                (ev.hostRefNum || ev.hostRefNumber
                  ? " · ref " + escapeHtml(String(ev.hostRefNum || ev.hostRefNumber))
                  : "") +
                "</li>"
              );
            })
            .join("") +
          "</ul>"
        : br
          ? "<p class='admin-field-help'>Eski kayıt: tek banka özeti var (callback geçmişi bu sürümden sonra birikir).</p>"
          : "<p class='admin-field-help'>Henüz imzalı banka callback kaydı yok.</p>";

    return (
      "<h3 class='admin-order-section-title'>Banka ödeme kanıtı</h3>" +
      (rows
        ? "<dl class='admin-xml-meta'>" + rows + "</dl>"
        : "<p class='admin-field-help'>Banka cevabı yok.</p>") +
      hist
    );
  }

  const REVERSAL_REASON_TEXT = {
    not_paid: "Ödemesi alınmamış sipariş.",
    missing_bank_success_evidence: "Bankadan başarılı ödeme kanıtı (VPS-0000) yok.",
    already_reversed: "Siparişin tutarının tamamı iade edildi.",
    reversal_pending_inquiry: "Önceki banka işleminin sonucu bilinmiyor.",
    cancel_after_partial_refund: "Kısmi iade yapılmış; kalan tutar için ürün bazlı iade kullanın.",
    customer_email_required: "Siparişte müşteri e-postası yok.",
  };

  function orderIsShipped(order) {
    return order.status === "shipped" || order.status === "delivered";
  }

  function orderPaidNotRefunded(order) {
    return (order.paymentStatus === "paid" || order.paymentTaken) && order.paymentStatus !== "refunded";
  }

  /** Sunucudaki computeItemsRefund ile aynı oranlar; kesin tutarı sunucu önizlemesi verir. */
  function estimateItemsRefund(order, selections, includeShipping) {
    const items = order.items || [];
    const merchandise =
      Number(order.merchandiseTotal) ||
      items.reduce((sum, it) => sum + (Number(it.line) || 0) + (Number(it.lineVat) || 0), 0);
    const discount = Number(order.coupon && order.coupon.discount) || 0;
    const shipping = Number(order.shippingFee) || 0;
    const base = merchandise - discount + shipping;
    const couponFactor = merchandise > 0 ? Math.max(0, (merchandise - discount) / merchandise) : 1;
    const instFactor = base > 0 ? (Number(order.total) || base) / base : 1;
    let amount = 0;
    selections.forEach((row) => {
      const it = items[row.index];
      if (!it || !(row.qty > 0)) return;
      const bought = Math.max(1, Number(it.qty) || 1);
      amount += (((Number(it.line) || 0) + (Number(it.lineVat) || 0)) / bought) * row.qty * couponFactor * instFactor;
    });
    if (includeShipping) amount += shipping * instFactor;
    return Math.round(amount * 100) / 100;
  }

  function renderBankReversalBlock(order) {
    const paid = order.paymentStatus === "paid" || order.paymentTaken || order.paymentStatus === "refunded";
    if (!paid) return "";
    const preview = order._bankReversal || {};
    const rev = preview.reversal || {};
    const shipped = orderIsShipped(order);
    const pending = preview.pending;
    const inquiryAvailable = order._bankInquiryAvailable === true;
    let body = "";
    if (Number(preview.reversedAmount) > 0) {
      const kinds = orderReversalKinds(order);
      body +=
        "<p class='admin-field-help'>" +
        (kinds.size > 1 ? "Bankada iptal/iade edilen" : kinds.has("void") ? "Bankada iptal edilen" : "Bankadan iade edilen") +
        ": <strong>" +
        moneyTr(preview.reversedAmount) +
        "</strong> · Kalan: " +
        moneyTr(preview.remainingAmount || 0) +
        "</p>";
    }
    if (pending) {
      body +=
        "<p class='admin-order-mail-banner admin-order-mail-banner--warn'><strong>Banka sonucu bilinmiyor.</strong> " +
        escapeHtml(formatOrderDate(pending.at)) +
        " tarihli " +
        moneyTr(pending.amount) +
        " işleminin cevabı alınamadı. Para iade edilmiş olabilir; tekrar denemeyin, “Bankadan sorgula” ile netleştirin.</p>";
    }
    if (!rev.canCallBank && orderPaidNotRefunded(order)) {
      body +=
        "<p class='admin-order-mail-banner admin-order-mail-banner--warn'><strong>Banka iade API kapalı.</strong> " +
        (rev.enabled
          ? "POS canlı modda; canlı iade için ayrıca <code>AKBANK_BANK_REVERSAL_LIVE=true</code> gerekir."
          : "Sunucuda <code>AKBANK_BANK_REVERSAL_ENABLED</code> açık değil.") +
        " İadeyi Akbank İnternet/Mobil’den yaptıysanız “Bankadan sorgula” ile siparişe işleyin.</p>";
    }
    let actions = "";
    const canAct = rev.canCallBank && !pending && orderPaidNotRefunded(order);
    if (!shipped && orderPaidNotRefunded(order)) {
      if (preview.ok) {
        body +=
          "<p class='admin-field-help'>Kargoya verilmemiş sipariş: iptal edilir ve tamamı (" +
          moneyTr(preview.plan && preview.plan.amount) +
          ") müşterinin kartına döner. Ödeme bugün alındıysa bankada iptal edilir (kart limiti hemen açılır); değilse karta iade edilir (2–3 iş günü).</p>";
        if (canAct) {
          actions +=
            "<button type='button' class='btn btn-danger' id='adminOrderCancelRefund'>İptal et ve parayı iade et</button>";
        }
      } else if (preview.reason && REVERSAL_REASON_TEXT[preview.reason]) {
        body +=
          "<p class='admin-order-mail-banner admin-order-mail-banner--warn'>" +
          escapeHtml(REVERSAL_REASON_TEXT[preview.reason]) +
          "</p>";
      }
    }
    const fullyReversed = Number(preview.reversedAmount) > 0 && !(Number(preview.remainingAmount) > 0);
    const partialAllowed =
      orderPaidNotRefunded(order) &&
      (shipped || Number(preview.reversedAmount) > 0) &&
      !pending &&
      !fullyReversed;
    if (partialAllowed) {
      const refundedQty = preview.refundedQty || {};
      const rows = (order.items || [])
        .map((it, index) => {
          const bought = Math.max(1, Number(it.qty) || 1);
          const left = Math.max(0, bought - (Number(refundedQty[index]) || 0));
          return (
            "<tr><td>" +
            escapeHtml(it.name || it.productId || "Ürün") +
            "</td><td>" +
            bought +
            (left < bought ? " (" + (bought - left) + " iade edildi)" : "") +
            "</td><td><input type='number' class='admin-refund-qty' data-index='" +
            index +
            "' min='0' max='" +
            left +
            "' value='0' inputmode='numeric' aria-label='" +
            escapeHtml((it.name || "Ürün") + " iade adedi") +
            "'" +
            (left ? "" : " disabled") +
            "></td></tr>"
          );
        })
        .join("");
      const shippingFee = Number(order.shippingFee) || 0;
      body +=
        "<p class='admin-field-help'>Ürün bazlı iade: iade gelen ürünlerin adedini seçin. Tutar kupon indirimi ve taksit farkı oranında hesaplanır; para ödemede kullanılan karta döner (2–3 iş günü).</p>" +
        "<table class='admin-table admin-refund-table'><thead><tr><th>Ürün</th><th>Adet</th><th>İade adedi</th></tr></thead><tbody>" +
        rows +
        "</tbody></table>" +
        (shippingFee > 0 && !preview.shippingRefunded
          ? "<label class='admin-checkbox'><input type='checkbox' id='adminRefundShipping'> Kargo ücretini de iade et (" +
            moneyTr(shippingFee) +
            ")</label>"
          : "") +
        "<p class='admin-field-help' id='adminRefundEstimate'>Tahmini iade: " +
        moneyTr(0) +
        "</p>";
      if (canAct) {
        actions +=
          "<button type='button' class='btn btn-primary' id='adminOrderItemsRefund'>Seçilenleri karta iade et</button>";
      }
    }
    if (inquiryAvailable) {
      actions +=
        "<button type='button' class='btn btn-outline' id='adminOrderBankInquiry'>Bankadan sorgula</button>";
    }
    if (!body && !actions) return "";
    return (
      "<h3 class='admin-order-section-title'>İptal / iade (Akbank)</h3>" +
      body +
      (actions
        ? "<div class='admin-form-actions' style='flex-wrap:wrap;gap:8px'>" + actions + "</div>"
        : "") +
      "<p id='adminOrderBankReversalNote' class='admin-note' hidden></p>"
    );
  }

  /** What still has to be done with an issued invoice after the bank voided or refunded the order. */
  function invoiceFollowup(order) {
    const bh = order._bizimhesap;
    if (!(bh && bh.guid)) return null;
    const payload = bh.payload || {};
    const resolvedAt = String(payload.resolvedAt || "");
    const open = (at) => !resolvedAt || String(at || "") > resolvedAt;
    if (payload.cancel && payload.cancel.ok) return { kind: "cancelled", at: payload.cancel.at };
    if (payload.cancel && open(payload.cancel.at)) {
      return { kind: "cancel_failed", error: payload.cancel.error || "" };
    }
    if (payload.issuedCancel && open(payload.issuedCancel.at)) {
      return {
        kind: "issued_cancel_required",
        invoiceNo: payload.issuedCancel.invoiceNo || "",
        error: payload.issuedCancel.error || "",
      };
    }
    const returns = (Array.isArray(payload.returns) ? payload.returns : []).filter((row) => row && open(row.eventAt));
    if (returns.length) {
      return {
        kind: "needs_return_document",
        amount: returns.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
      };
    }
    return null;
  }

  function invoiceFollowupBanner(followup) {
    if (followup.kind === "cancelled") {
      return (
        "<p class='admin-order-mail-banner admin-order-mail-banner--ok'>" +
        "<strong>Fatura iptal edildi.</strong> Sipariş bankada iptal edildiği için BizimHesap faturası otomatik iptal edildi" +
        (followup.at ? " (" + escapeHtml(formatOrderDate(followup.at)) + ")" : "") +
        ". e-Arşiv olarak gönderildiyse GİB tarafını BizimHesap'ta kontrol edin.</p>"
      );
    }
    const text =
      followup.kind === "issued_cancel_required"
        ? "<strong>Kesilmiş faturayı BizimHesap'ta iptal edin.</strong> Sipariş bankada iptal edildi. " +
          (followup.invoiceNo
            ? "Belge No " + escapeHtml(followup.invoiceNo) + " kesildiği için panel otomatik iptal etmedi. "
            : escapeHtml(followup.error) + "; panel otomatik iptal etmedi. Fatura taslaksa silin, kesildiyse iptal edin. ") +
          "e-Fatura / e-Arşiv iptal kurallarını muhasebecinizle kontrol edin."
        : followup.kind === "cancel_failed"
        ? "<strong>Fatura otomatik iptal edilemedi.</strong> " +
          (followup.error ? escapeHtml(followup.error) + ". " : "") +
          "BizimHesap panelinden faturayı iptal edin."
        : "<strong>İade belgesi gerekli.</strong> Faturası kesilmiş siparişte " +
          escapeHtml(moneyTr(followup.amount)) +
          " karta iade edildi. İade faturası / gider pusulası düzenleyin ve aşağıdaki Belgeler bölümünden yükleyin; yükleyince bu uyarı kendiliğinden kapanır.";
    return (
      "<p class='admin-order-mail-banner admin-order-mail-banner--warn'>" +
      text +
      "</p><div class='admin-form-actions'>" +
      "<button type='button' class='btn btn-outline' id='adminOrderInvoiceResolve'>Hallettim, uyarıyı kapat</button>" +
      "</div><p id='adminOrderBizimhesapNote' class='admin-note' hidden></p>"
    );
  }

  function renderBizimHesapBlock(order) {
    const bh = order._bizimhesap;
    const hasInvoice = Boolean(bh && bh.guid);
    const paid = order.paymentStatus === "paid" || order.paymentTaken;
    if (!paid && !hasInvoice) return "";
    const status = String(order.status || "");
    const reversed = orderReversalKinds(order).size > 0;
    const blocked = status === "cancelled" || status === "refunded" || order.paymentStatus === "refunded";
    const configured = order._bizimhesapConfigured === true;
    const invoiceNo = String((bh && bh.payload && bh.payload.invoiceNo) || "");
    const followup = invoiceFollowup(order);
    if (followup) {
      return (
        "<h3 class='admin-order-section-title'>BizimHesap faturası</h3>" +
        invoiceFollowupBanner(followup) +
        "<p class='admin-field-help'>" +
        (invoiceNo ? "Belge No: " + escapeHtml(invoiceNo) : "Belge No henüz okunmadı") +
        " · GUID: " +
        escapeHtml(bh.guid) +
        "</p>"
      );
    }
    let body = "";
    if (!configured) {
      body =
        "<p class='admin-field-help'>BizimHesap yapılandırılmamış (.env). Siparişler BizimHesap'a aktarılamaz.</p>";
    } else if (blocked && !hasInvoice) {
      body = "<p class='admin-field-help'>Sipariş iptal/iade edildi; BizimHesap'a aktarılmaz.</p>";
    } else if (reversed && !hasInvoice) {
      body =
        "<p class='admin-order-mail-banner admin-order-mail-banner--warn'>" +
        "<strong>Kısmi iade yapıldı.</strong> Panel tüm kalemleri aktaracağı için buradan aktarılmaz; faturayı kalan tutarla BizimHesap'ta kesin." +
        "</p>";
    } else if (hasInvoice) {
      const payload = bh.payload || {};
      let state;
      if (invoiceNo) {
        state =
          "<p class='admin-order-mail-banner admin-order-mail-banner--ok'><strong>Fatura kesildi.</strong> Belge No: " +
          escapeHtml(invoiceNo) +
          (payload.invoiceDate ? " · " + escapeHtml(payload.invoiceDate) : "") +
          "<br>Müşteriye fatura mailini BizimHesap gönderir.";
      } else if (payload.invoiceCheckError) {
        state =
          "<p class='admin-order-mail-banner admin-order-mail-banner--warn'><strong>Fatura durumu okunamadı.</strong> " +
          escapeHtml(payload.invoiceCheckError) +
          (payload.invoiceCheckedAt ? " (" + escapeHtml(formatOrderDate(payload.invoiceCheckedAt)) + ")" : "");
      } else if (payload.invoiceCheckedAt) {
        state =
          "<p class='admin-order-mail-banner admin-order-mail-banner--warn'><strong>Fatura kesilmedi.</strong> BizimHesap'ta bu siparişe kesilmiş fatura yok (son kontrol " +
          escapeHtml(formatOrderDate(payload.invoiceCheckedAt)) +
          "). Faturayı orada kesip müşteriye oradan gönderin; panel 15 dakika içinde kendiliğinden günceller.";
      } else {
        state =
          "<p class='admin-order-mail-banner admin-order-mail-banner--warn'><strong>Fatura durumu henüz kontrol edilmedi.</strong> Sipariş BizimHesap'a aktarıldı" +
          (bh.createdAt ? " (" + escapeHtml(formatOrderDate(bh.createdAt)) + ")" : "") +
          ".";
      }
      body =
        state +
        (payload.resolvedAt
          ? "<br>İade/iptal düzeltmesi yapıldı olarak işaretlendi · " + escapeHtml(formatOrderDate(payload.resolvedAt))
          : "") +
        "<br><small>BizimHesap GUID: " +
        escapeHtml(bh.guid) +
        "</small></p>";
    } else if (order.invoiceUntracked) {
      body =
        "<p class='admin-field-help'>Bu sipariş BizimHesap entegrasyonundan önce ödendi; panelde fatura kaydı yok. " +
        "Faturası başka yoldan kesildiyse işlem gerekmez. İsterseniz aşağıdan BizimHesap'a aktarabilirsiniz.</p>";
    } else {
      body =
        "<p class='admin-order-mail-banner admin-order-mail-banner--warn'>" +
        "<strong>Henüz BizimHesap'a aktarılmadı.</strong> Ödeme onaylanınca otomatik aktarılır; aktarılmadıysa aşağıdan tekrar deneyin." +
        "</p>";
    }
    const canTransfer = configured && order.id && !blocked && !reversed;
    let action = "";
    if (hasInvoice && order.id && !invoiceNo && configured) {
      action =
        "<div class='admin-form-actions' style='flex-wrap:wrap;gap:8px'>" +
        "<button type='button' class='btn btn-primary' id='adminOrderInvoiceSync'>BizimHesap'tan kontrol et</button>" +
        (canTransfer ? "<button type='button' class='btn btn-outline' id='adminOrderBizimhesapSend'>Yeniden aktar</button>" : "") +
        "</div><p id='adminOrderBizimhesapNote' class='admin-note' hidden></p>";
    } else if (!hasInvoice && canTransfer) {
      action =
        "<div class='admin-form-actions'>" +
        "<button type='button' class='btn btn-primary' id='adminOrderBizimhesapSend'>BizimHesap'a aktar</button>" +
        "</div><p id='adminOrderBizimhesapNote' class='admin-note' hidden></p>";
    }
    return (
      "<h3 class='admin-order-section-title'>BizimHesap faturası</h3>" + body + action
    );
  }

  const ORDER_DOC_LABELS = { invoice: "Fatura", return: "İade belgesi" };
  const ORDER_DOC_MAX_BYTES = 10 * 1024 * 1024;

  function orderDocs(order, kind) {
    return (Array.isArray(order._documents) ? order._documents : []).filter((doc) => !kind || doc.kind === kind);
  }

  function latestOrderDoc(order, kind) {
    const docs = orderDocs(order, kind);
    return docs.length ? docs[docs.length - 1] : null;
  }

  function renderOrderDocsBlock(order) {
    const docs = orderDocs(order);
    const paid = order.paymentStatus === "paid" || order.paymentTaken || order.paymentStatus === "refunded";
    if (!paid && !docs.length) return "";
    const canReturn =
      order.paymentStatus === "refunded" || orderReversalKinds(order).size > 0 || orderDocs(order, "return").length > 0;
    const rows = docs
      .map(
        (doc) =>
          "<li><span class='admin-order-doc-kind'>" +
          escapeHtml(ORDER_DOC_LABELS[doc.kind] || doc.kind) +
          "</span><span class='admin-order-doc-name'>" +
          escapeHtml(doc.filename) +
          "</span><span class='admin-order-doc-date'>" +
          escapeHtml(formatOrderDate(doc.at)) +
          "</span>" +
          orderDocLinkHtml(doc, "btn btn-outline btn-sm", "Aç ↗") +
          "<button type='button' class='btn btn-outline btn-sm' data-od-delete-doc='" +
          escapeAttr(doc.id) +
          "' aria-label='" +
          escapeAttr(doc.filename + " sil") +
          "'>Sil</button></li>"
      )
      .join("");
    const upload = (kind, label) =>
      "<input id='adminOrderDoc-" +
      kind +
      "' class='admin-file-input' type='file' accept='.pdf,.png,.jpg,.jpeg' data-order-doc-kind='" +
      kind +
      "' /><label for='adminOrderDoc-" +
      kind +
      "' class='btn btn-outline btn-sm'>" +
      label +
      "</label>";
    return (
      "<h3 class='admin-order-section-title'>Belgeler</h3>" +
      (rows
        ? "<ul class='admin-order-docs'>" + rows + "</ul>"
        : "<p class='admin-field-help'>Bu siparişe henüz belge yüklenmedi.</p>") +
      "<div class='admin-order-doc-upload'>" +
      upload("invoice", "📎 Fatura yükle") +
      (canReturn ? upload("return", "📎 İade belgesi yükle") : "") +
      "</div>" +
      "<p class='admin-field-help'>Faturayı BizimHesap'tan PDF olarak indirip buraya yükleyin; “Faturayı gör” onu yeni sekmede açar. " +
      "PDF, PNG veya JPG · en fazla 10 MB. Belgeler yalnızca panelden açılır.</p>" +
      "<p id='adminOrderDocNote' class='admin-note' hidden></p>"
    );
  }

  function orderDocLinkHtml(doc, className, label) {
    const href = String(doc.viewUrl || "");
    if (!href.startsWith("/api/order-documents/")) return "";
    return (
      "<a class='" +
      className +
      "' href='" +
      escapeAttr(href) +
      "' target='_blank' rel='noopener noreferrer' data-od-doc-link>" +
      escapeHtml(label) +
      "</a>"
    );
  }

  function orderDocLinkExpired(href) {
    const exp = Number((/[?&]exp=(\d+)/.exec(href) || [])[1]);
    return !exp || exp * 1000 - 30000 < Date.now();
  }

  function invoiceIdentityText(c) {
    if (c.customerType === "kurumsal") {
      return ["Kurumsal", c.company, c.taxOffice ? "VD: " + c.taxOffice : "", c.taxId ? "VKN: " + c.taxId : ""]
        .filter(Boolean)
        .join(" · ");
    }
    const parts = [c.customerType === "bireysel" ? "Bireysel" : "", c.company, c.taxId ? "T.C./VKN: " + c.taxId : ""];
    return parts.filter(Boolean).join(" · ") || "—";
  }

  const ORDER_DETAIL_TABS = [
    ["ozet", "Özet"],
    ["kargo", "Kargo ve durum"],
    ["odeme", "Ödeme ve iade"],
    ["fatura", "Fatura"],
    ["gecmis", "Geçmiş"],
    ["kvkk", "KVKK"],
  ];
  let orderDetailTab = { orderId: "", tab: "ozet" };

  function activeOrderDetailTab(orderId) {
    return orderDetailTab.orderId === orderId ? orderDetailTab.tab : "ozet";
  }

  /** One sentence + shortcut tabs for what the operator should do next with this order. */
  function orderNextStep(order) {
    const preview = order._bankReversal || {};
    const status = String(order.status || "");
    const paidOpen = orderPaidNotRefunded(order);
    const invoice = invoiceFollowup(order);
    if (invoice && invoice.kind !== "cancelled") {
      return {
        tone: "warn",
        text:
          invoice.kind === "issued_cancel_required"
            ? "Ödeme bankada iptal edildi; kesilmiş faturayı BizimHesap'ta iptal edin."
            : invoice.kind === "cancel_failed"
            ? "Ödeme bankada iptal edildi ama fatura otomatik iptal edilemedi. Faturayı BizimHesap'ta iptal edin."
            : "Karta iade yapıldı; kesilmiş fatura için iade belgesi düzenleyip buraya yükleyin.",
        actions: [["fatura", invoice.kind === "needs_return_document" ? "İade belgesini yükle" : "Fatura sekmesi"]],
      };
    }
    if (order.paymentStatus === "refunded") {
      return {
        text: orderVoidedOnly(order)
          ? "Sipariş kapandı: ödeme bankada iptal edildi, karttan çekim yapılmadı."
          : "Sipariş kapandı: ödeme müşterinin kartına iade edildi.",
        actions: [["gecmis", "Geçmişi gör"]],
      };
    }
    if (preview.pending) {
      return {
        tone: "warn",
        text: "Önceki banka işleminin sonucu bilinmiyor. Yeni işlem yapmadan bankadan sorgulayın.",
        actions: [["odeme", "Bankadan sorgula"]],
      };
    }
    if (status === "cancelled") return { text: "Sipariş iptal edildi.", actions: [] };
    if (!paidOpen) {
      return {
        text:
          order.paymentStatus === "failed"
            ? "Ödeme başarısız; işlem gerekmez."
            : "Ödeme bekleniyor; banka onayı gelmeden işlem yapılmaz.",
        actions: [],
      };
    }
    const actions = [];
    let text;
    if (status === "delivered") {
      text = "Teslim edildi. İade gelirse ürünleri seçip karta iade edin.";
      actions.push(["odeme", "Ürün iadesi"]);
    } else if (status === "shipped") {
      text = "Kargoda. Müşteriye ulaşınca durumu “Teslim edildi” yapın.";
      actions.push(["kargo", "Durumu güncelle"], ["odeme", "Ürün iadesi"]);
    } else {
      text =
        status === "preparing"
          ? "Hazırlanıyor. Kargoya verince firma ve takip kodunu girin."
          : "Yeni sipariş. Hazırlayıp kargoya verin; müşteri vazgeçtiyse iptal edip parayı iade edin.";
      actions.push(["kargo", "Kargoya ver"], ["odeme", "İptal et / iade"]);
    }
    if (
      order._bizimhesapConfigured === true &&
      !(order._bizimhesap && order._bizimhesap.guid) &&
      !order.invoiceUntracked &&
      orderReversalKinds(order).size === 0
    ) {
      actions.push(["fatura", "BizimHesap'a aktar"]);
    } else if (order._bizimhesap && order._bizimhesap.guid && (order._bizimhesap.payload || {}).invoiceCheckedAt && !(order._bizimhesap.payload || {}).invoiceNo) {
      actions.push(["fatura", "Fatura kesilmedi"]);
    }
    return { text, actions };
  }

  function orderDetailHeadHtml(order) {
    const step = orderNextStep(order);
    const invoiceDoc = latestOrderDoc(order, "invoice");
    const openInvoice = invoiceDoc ? orderDocLinkHtml(invoiceDoc, "btn btn-outline", "Faturayı gör ↗") : "";
    return (
      "<div class='admin-od-head" +
      (step.tone === "warn" ? " admin-od-head--warn" : "") +
      "'>" +
      "<div class='admin-od-head-status'>" +
      paymentStatusBadge(order) +
      fulfillmentStatusBadge(order) +
      "<span class='admin-od-head-total'>" +
      moneyTr(order.total) +
      "</span>" +
      "<span class='admin-od-head-date'>" +
      escapeHtml(formatOrderDate(order.createdAt)) +
      "</span></div>" +
      "<p class='admin-od-next'><strong>Sıradaki adım:</strong> " +
      escapeHtml(step.text) +
      "</p>" +
      (step.actions.length || openInvoice
        ? "<div class='admin-od-head-actions'>" +
          step.actions
            .map(
              (action, index) =>
                "<button type='button' class='btn " +
                (index === 0 ? "btn-primary" : "btn-outline") +
                "' data-od-goto='" +
                escapeAttr(action[0]) +
                "'>" +
                escapeHtml(action[1]) +
                "</button>"
            )
            .join("") +
          openInvoice +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function orderDetailTabsHtml(active, badges) {
    return (
      "<div class='admin-od-tabs' role='tablist' aria-label='Sipariş detayı'>" +
      ORDER_DETAIL_TABS.map(function (tab) {
        const key = tab[0];
        const on = key === active;
        return (
          "<button type='button' role='tab' class='admin-od-tab' id='adminOdTab-" +
          key +
          "' data-od-tab='" +
          key +
          "' aria-controls='adminOdPanel-" +
          key +
          "' aria-selected='" +
          on +
          "' tabindex='" +
          (on ? "0" : "-1") +
          "'>" +
          escapeHtml(tab[1]) +
          (badges[key] ? "<span class='admin-od-tab-badge'>" + escapeHtml(badges[key]) + "</span>" : "") +
          "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  function orderDetailPanelHtml(key, active, html) {
    return (
      "<section class='admin-od-panel' role='tabpanel' id='adminOdPanel-" +
      key +
      "' aria-labelledby='adminOdTab-" +
      key +
      "'" +
      (key === active ? "" : " hidden") +
      ">" +
      html +
      "</section>"
    );
  }

  function metaRows(pairs) {
    return pairs
      .filter((pair) => pair && pair[1] != null && String(pair[1]).trim() !== "")
      .map((pair) => "<div><dt>" + escapeHtml(pair[0]) + "</dt><dd>" + pair[1] + "</dd></div>")
      .join("");
  }

  function orderItemsAndTotalsHtml(order) {
    const items = (order.items || [])
      .map(function (it) {
        const qty = Math.max(1, Number(it.qty) || 1);
        const lineIncl = (Number(it.line) || 0) + (Number(it.lineVat) || 0);
        return (
          "<li><span class='admin-od-item-name'>" +
          escapeHtml(it.name || it.productId || "Ürün") +
          "</span><span class='admin-od-item-qty'>" +
          qty +
          " adet</span><span class='admin-od-item-amount'>" +
          moneyTr(lineIncl) +
          "</span></li>"
        );
      })
      .join("");
    const coupon = order.coupon && order.coupon.discount > 0 ? order.coupon : null;
    const inst = order.installment && order.installment.count > 1 ? order.installment : null;
    const shipping = Number(order.shippingFee) || 0;
    return (
      "<h3 class='admin-order-section-title'>Kalemler <small>(KDV dahil)</small></h3>" +
      "<ul class='admin-od-items'>" +
      (items || "<li>—</li>") +
      "</ul>" +
      "<dl class='admin-xml-meta admin-od-totals'>" +
      metaRows([
        ["Ara toplam (KDV hariç)", order.subtotal != null ? escapeHtml(moneyTr(order.subtotal)) : null],
        ["KDV", order.vat != null ? escapeHtml(moneyTr(order.vat)) : null],
        coupon ? ["Kupon", escapeHtml(coupon.code) + " · -" + escapeHtml(moneyTr(coupon.discount))] : null,
        ["Kargo", shipping > 0 ? escapeHtml(moneyTr(shipping)) : "Ücretsiz"],
        inst
          ? [
              "Taksit",
              inst.count +
                " taksit · vade farkı %" +
                escapeHtml(String(inst.ratePercent)) +
                " · " +
                escapeHtml(moneyTr(inst.surcharge)),
            ]
          : null,
        ["Toplam", "<strong>" + escapeHtml(moneyTr(order.total)) + "</strong>"],
      ]) +
      "</dl>"
    );
  }

  function orderCustomerHtml(order) {
    const c = order.customer || {};
    return (
      "<h3 class='admin-order-section-title'>Müşteri</h3>" +
      "<dl class='admin-xml-meta'>" +
      metaRows([
        ["Ad soyad", escapeHtml(c.name || "—")],
        ["E-posta", escapeHtml(c.email || "—")],
        ["Telefon", escapeHtml(c.phone || "—")],
        ["Fatura", escapeHtml(invoiceIdentityText(c))],
        ["Fatura adresi", escapeHtml(c.billingAddress || "—")],
        ["Teslimat adresi", escapeHtml(c.shippingAddress || c.billingAddress || "—")],
        order.shippingCarrier
          ? ["Kargo", escapeHtml(order.shippingCarrier + (order.trackingCode ? " · " + order.trackingCode : ""))]
          : null,
      ]) +
      "</dl>"
    );
  }

  function orderStatusFormHtml(order) {
    const options = (order.status === "shipped" || order.status === "delivered"
      ? ["preparing", "delivered", "cancelled"]
      : ["preparing", "cancelled"]
    ).filter((s) => s !== "cancelled" || !orderPaidNotRefunded(order) || order.status === "cancelled");
    const current = order.status === "shipped" ? "delivered" : order.status;
    const hasCurrent = options.indexOf(current) >= 0;
    return (
      "<h3 class='admin-order-section-title'>Durum</h3>" +
      "<div class='field'><label for='adminOrderStatus'>Yeni durum</label>" +
      "<select id='adminOrderStatus'>" +
      (hasCurrent ? "" : "<option value='' selected>Seçin</option>") +
      options
        .map(
          (s) =>
            "<option value='" + s + "'" + (s === current ? " selected" : "") + ">" + orderStatusLabel(s) + "</option>"
        )
        .join("") +
      "</select></div>" +
      "<p class='admin-field-help'>Kargoda durumu kargo kaydıyla gelir. Kargodaki sipariş müşteriye ulaşınca “Teslim edildi” seçin: müşteriye ürün değerlendirme bağlantısı gider. Ödenmiş sipariş yalnızca “Ödeme ve iade” sekmesinden, para iade edilerek iptal edilir.</p>" +
      "<div class='admin-form-actions'><button type='button' class='btn btn-primary' id='adminOrderSaveStatus'>Durumu kaydet</button></div>"
    );
  }

  function orderShippingFormHtml(order, shippedMailSent) {
    return (
      "<h3 class='admin-order-section-title'>Kargo bilgisi</h3>" +
      "<p class='admin-field-help' data-smtp-mail-help>Kargo firması ve gönderi kodunu kaydedince sipariş kargoya verildi olur ve müşteriye mail gider.</p>" +
      "<div class='admin-order-shipping-fields'>" +
      "<div class='field'><label for='adminOrderCarrier'>Kargo firması</label>" +
      "<select id='adminOrderCarrier'>" +
      "<option value=''>Seçin</option>" +
      shippingCarriers
        .map(function (name) {
          return (
            "<option value='" +
            escapeAttr(name) +
            "'" +
            (order.shippingCarrier === name ? " selected" : "") +
            ">" +
            escapeHtml(name) +
            "</option>"
          );
        })
        .join("") +
      "</select></div>" +
      "<div class='field'><label for='adminOrderTracking'>Gönderi / takip kodu</label>" +
      "<input type='text' id='adminOrderTracking' maxlength='80' value='" +
      escapeAttr(order.trackingCode || "") +
      "' placeholder='Örn. 1234567890'></div>" +
      "</div>" +
      (shippedMailSent
        ? "<label class='admin-check'><input type='checkbox' id='adminOrderResendShippingMail'> Kargo mailini tekrar gönder</label>"
        : "") +
      "<div class='admin-form-actions'><button type='button' class='btn btn-primary' id='adminOrderSaveShipping'>Kargoyu kaydet ve müşteriye bildir</button></div>"
    );
  }

  function orderBankTechHtml(order) {
    const br = order.bankResponse || {};
    const summary = [br.responseCode, br.authCode ? "auth " + br.authCode : ""].filter(Boolean).join(" · ");
    return (
      "<details class='admin-od-tech'><summary>Teknik banka kaydı" +
      (summary ? " <span>" + escapeHtml(summary) + "</span>" : "") +
      "</summary>" +
      bankPaymentBlock(order) +
      "</details>"
    );
  }

  function orderKvkkHtml(order) {
    return (
      "<h3 class='admin-order-section-title'>KVKK / anonimleştirme</h3>" +
      "<p class='admin-field-help'>Kişisel verileri temizler; tutar ve kalemler kalır. Yasal saklama (legal_hold) olan kayıtlar kalıcı silinmez.</p>" +
      (order.legalHold ? "<p class='admin-field-help'>Bu sipariş yasal saklamada (ödeme alınmış).</p>" : "") +
      (order.anonymizedAt
        ? "<p class='admin-order-mail-banner admin-order-mail-banner--ok'>Bu sipariş " +
          escapeHtml(formatOrderDate(order.anonymizedAt)) +
          " tarihinde anonimleştirildi.</p>"
        : "<div class='admin-form-actions'><button type='button' class='btn btn-outline' id='adminOrderAnonymize'>Anonimleştir</button></div>")
    );
  }

  function buildOrderDetailHtml(order, statusMails) {
    const mails = Array.isArray(statusMails) ? statusMails : order._statusMails || [];
    const shippedMailSent = mails.some((row) => row && row.status === "shipped");
    const active = activeOrderDetailTab(order.id);
    const paid = order.paymentStatus === "paid" || order.paymentTaken || order.paymentStatus === "refunded";
    const reversalBlock = renderBankReversalBlock(order);
    const preview = order._bankReversal || {};
    const badges = {
      odeme: preview.pending ? "!" : "",
      gecmis: mails.length ? String(mails.length) : "",
    };
    const panels = {
      ozet:
        "<div class='admin-od-columns'><div>" +
        orderCustomerHtml(order) +
        "</div><div>" +
        orderItemsAndTotalsHtml(order) +
        "</div></div>",
      kargo:
        "<div class='admin-od-columns'><div>" +
        orderShippingFormHtml(order, shippedMailSent) +
        "</div><div>" +
        orderStatusFormHtml(order) +
        "</div></div>",
      odeme:
        (reversalBlock ||
          (paid ? "" : "<p class='admin-field-help'>Ödeme alınmadığı için iptal/iade işlemi yok.</p>")) +
        orderBankTechHtml(order),
      fatura:
        renderBizimHesapBlock(order) + renderOrderDocsBlock(order) ||
        "<p class='admin-field-help'>Ödeme alınmadığı için fatura kesilmez.</p>",
      gecmis:
        "<h3 class='admin-order-section-title'>Müşteriye giden e-postalar</h3>" +
        "<ul class='admin-order-items admin-order-mail-log'>" +
        renderOrderMailLog(order, mails) +
        "</ul>",
      kvkk: orderKvkkHtml(order),
    };
    return (
      "<div class='admin-od'>" +
      orderDetailHeadHtml(order) +
      renderOrderMailStatusBanner(order, mails) +
      orderDetailTabsHtml(active, badges) +
      ORDER_DETAIL_TABS.map((tab) => orderDetailPanelHtml(tab[0], active, panels[tab[0]])).join("") +
      "</div>"
    );
  }

  function bindOrderDetailTabs(orderId) {
    const root = document.querySelector(".admin-od");
    if (!root) return;
    const tabs = Array.from(root.querySelectorAll("[data-od-tab]"));
    function select(key, focusTab) {
      orderDetailTab = { orderId: orderId, tab: key };
      tabs.forEach(function (tab) {
        const on = tab.dataset.odTab === key;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on && focusTab) tab.focus();
      });
      root.querySelectorAll(".admin-od-panel").forEach(function (panel) {
        panel.hidden = panel.id !== "adminOdPanel-" + key;
      });
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", () => select(tab.dataset.odTab, false));
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : tabs.length - 1;
        select(tabs[(index + step) % tabs.length].dataset.odTab, true);
      });
    });
    root.querySelectorAll("[data-od-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        select(btn.dataset.odGoto, false);
        const tabList = root.querySelector(".admin-od-tabs");
        if (tabList) tabList.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    });
  }

  function stashOrderMailNotice(order, result) {
    if (!order || !result) return;
    const type = result.mailSent ? "ok" : result.mailReason === "already_notified" ? "warn" : "warn";
    order._mailNotice = {
      type: type,
      text: formatOrderMailFeedback(result),
    };
    if (result.mailSent && result.mailTo) {
      order._mailNotice.text = "Müşteriye mail gönderildi: " + result.mailTo;
    }
  }

  function paintOrderRowBadges(block, order) {
    const row = block && block.querySelector(".admin-order-row");
    if (!row) return;
    const payCell = row.querySelector(".admin-order-payment-cell");
    const fulCell = row.querySelector(".admin-order-fulfillment-cell");
    if (payCell) payCell.innerHTML = paymentStatusBadge(order);
    if (fulCell) fulCell.innerHTML = fulfillmentStatusBadge(order);
    const progressCell = row.querySelector(".admin-order-progress-cell");
    if (progressCell) progressCell.innerHTML = orderProgressHtml(order);
    row.setAttribute("aria-expanded", "true");
  }

  function applyOrderPatchToUi(order, statusMails) {
    if (!order || !order.id || !adminOrderList) return;
    if (Array.isArray(statusMails)) order._statusMails = statusMails;
    const idx = ordersCache.findIndex((row) => row.id === order.id);
    const previous = idx >= 0 ? ordersCache[idx] : null;
    const merged = previous ? Object.assign({}, previous, order) : order;
    if (idx >= 0) ordersCache[idx] = merged;
    else ordersCache.push(merged);
    const statusChanged = Boolean(previous && previous._detailLoaded && previous.status !== merged.status);
    order = merged;
    const block = adminOrderList.querySelector('[data-order-id="' + CSS.escape(order.id) + '"]');
    if (!block) return;
    paintOrderRowBadges(block, order);
    if (selectedOrderId !== order.id) return;
    if (statusChanged) {
      merged._detailLoaded = false;
      expandOrderRow(order.id, { forceFetch: true });
      return;
    }
    const expand = block.querySelector(".admin-order-expand");
    if (!expand) return;
    expand.hidden = false;
    block.classList.add("is-open");
    expand.innerHTML = buildOrderDetailHtml(order, order._statusMails);
    bindOrderDetailActions(order.id);
  }

  function bindOrderDocActions(orderId) {
    const root = document.querySelector(".admin-od");
    if (!root) return;
    const docNote = (kind, text) => {
      const el = document.getElementById("adminOrderDocNote");
      if (el) {
        el.hidden = false;
        el.className = "admin-note " + kind;
        el.textContent = text;
      }
      note(adminOrdersNote, kind, text);
    };
    const refresh = (patch) => {
      const rowOrder = ordersCache.find((row) => row.id === orderId);
      if (!rowOrder) return expandOrderRow(orderId, { forceFetch: true });
      Object.assign(rowOrder, patch);
      applyOrderPatchToUi(rowOrder, rowOrder._statusMails);
    };
    root.querySelectorAll("[data-od-doc-link]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!orderDocLinkExpired(link.getAttribute("href"))) return;
        event.preventDefault();
        note(adminOrdersNote, "warn", "Belge bağlantısı yenilendi; tekrar tıklayın.");
        expandOrderRow(orderId, { forceFetch: true });
      });
    });
    root.querySelectorAll("[data-order-doc-kind]").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        if (file.size > ORDER_DOC_MAX_BYTES) return docNote("err", "Dosya en fazla 10 MB olabilir.");
        const kind = input.dataset.orderDocKind;
        root.querySelectorAll("[data-order-doc-kind]").forEach((el) => (el.disabled = true));
        docNote("", (ORDER_DOC_LABELS[kind] || "Belge") + " yükleniyor…");
        try {
          const data = await api("/api/admin/orders/" + encodeURIComponent(orderId) + "/documents", {
            method: "POST",
            body: JSON.stringify({ kind, filename: file.name, dataBase64: await readFileAsBase64(file) }),
            timeout: 60000,
          });
          const msg =
            (ORDER_DOC_LABELS[kind] || "Belge") +
            " yüklendi." +
            (data.followupResolved ? " “İade belgesi gerekli” uyarısı kapandı." : "");
          refresh({ _documents: data.documents || [], _bizimhesap: data.integration || null });
          note(adminOrdersNote, "ok", msg);
        } catch (err) {
          root.querySelectorAll("[data-order-doc-kind]").forEach((el) => (el.disabled = false));
          docNote("err", err.message || "Belge yüklenemedi");
        }
      });
    });
    root.querySelectorAll("[data-od-delete-doc]").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (btn.disabled || !window.confirm("Bu belge panelden silinsin mi? Geri alınamaz.")) return;
        btn.disabled = true;
        try {
          const data = await api(
            "/api/admin/orders/" + encodeURIComponent(orderId) + "/documents/" + encodeURIComponent(btn.dataset.odDeleteDoc),
            { method: "DELETE" }
          );
          refresh({ _documents: data.documents || [] });
          note(adminOrdersNote, "ok", "Belge silindi.");
        } catch (err) {
          btn.disabled = false;
          docNote("err", err.message || "Belge silinemedi");
        }
      });
    });
  }

  function bindOrderDetailActions(orderId) {
    bindOrderDetailTabs(orderId);
    bindOrderDocActions(orderId);
    const saveBtn = document.getElementById("adminOrderSaveStatus");
    if (saveBtn) {
      saveBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (saveBtn.disabled) return;
        const status = document.getElementById("adminOrderStatus").value;
        if (!status) {
          note(adminOrdersNote, "err", "Yeni durumu seçin.");
          return;
        }
        if (status === "shipped") {
          note(
            adminOrdersNote,
            "err",
            "Kargoda durumu için alttaki kargo firması + gönderi kodu alanlarını doldurup “Kargoyu kaydet ve müşteriye bildir” kullanın."
          );
          return;
        }
        saveBtn.disabled = true;
        try {
          const result = await api("/api/admin/orders/" + encodeURIComponent(orderId), {
            method: "PATCH",
            body: JSON.stringify({ status }),
          });
          note(
            adminOrdersNote,
            "ok",
            result.mailSent
              ? "Durum güncellendi. Müşteriye mail gönderildi."
              : formatOrderMailFeedback(result)
          );
          stashOrderMailNotice(result.order, result);
          applyOrderPatchToUi(result.order, result.statusMails);
        } catch (err) {
          note(adminOrdersNote, "err", err.message || "Güncellenemedi");
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
    const saveShippingBtn = document.getElementById("adminOrderSaveShipping");
    if (saveShippingBtn) {
      saveShippingBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (saveShippingBtn.disabled) return;
        const shippingCarrier = document.getElementById("adminOrderCarrier").value;
        const trackingCode = document.getElementById("adminOrderTracking").value.trim();
        if (!shippingCarrier || !trackingCode) {
          note(adminOrdersNote, "err", "Kargo firması ve gönderi kodu gerekli.");
          return;
        }
        saveShippingBtn.disabled = true;
        try {
          const resendEl = document.getElementById("adminOrderResendShippingMail");
          const result = await api("/api/admin/orders/" + encodeURIComponent(orderId), {
            method: "PATCH",
            body: JSON.stringify({
              shippingCarrier,
              trackingCode,
              resendMail: Boolean(resendEl && resendEl.checked),
            }),
          });
          note(adminOrdersNote, result.mailSent ? "ok" : "warn", formatOrderMailFeedback(result));
          stashOrderMailNotice(result.order, result);
          applyOrderPatchToUi(result.order, result.statusMails);
        } catch (err) {
          note(adminOrdersNote, "err", err.message || "Kargo kaydedilemedi");
        } finally {
          saveShippingBtn.disabled = false;
        }
      });
    }
    const anonymizeBtn = document.getElementById("adminOrderAnonymize");
    if (anonymizeBtn) {
      anonymizeBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (anonymizeBtn.disabled) return;
        if (
          !confirm(
            "Bu siparişteki kişisel verileri anonimleştirmek istiyor musunuz? Tutar ve kalemler kalır; işlem geri alınamaz."
          )
        ) {
          return;
        }
        anonymizeBtn.disabled = true;
        try {
          const result = await api(
            "/api/admin/orders/" + encodeURIComponent(orderId) + "/anonymize",
            { method: "POST", body: "{}" }
          );
          note(
            adminOrdersNote,
            "ok",
            result.already
              ? "Sipariş zaten anonimleştirilmişti."
              : "Sipariş anonimleştirildi (taslak politika)."
          );
          applyOrderPatchToUi(result.order, result.order && result.order._statusMails);
        } catch (err) {
          note(adminOrdersNote, "err", err.message || "Anonimleştirilemedi");
        } finally {
          anonymizeBtn.disabled = false;
        }
      });
    }
    async function postBizimHesapInvoice(body, busyLabel) {
      const bhNote = document.getElementById("adminOrderBizimhesapNote");
      const sendBtn = document.getElementById("adminOrderBizimhesapSend");
      const saveBtn = document.getElementById("adminOrderInvoiceSync");
      if (sendBtn) sendBtn.disabled = true;
      if (saveBtn) saveBtn.disabled = true;
      if (bhNote) {
        bhNote.hidden = false;
        bhNote.className = "admin-note";
        bhNote.textContent = busyLabel || "İşleniyor…";
      }
      try {
        const data = await api("/api/admin/orders/" + encodeURIComponent(orderId) + "/bizimhesap-invoice", {
          method: "POST",
          body: JSON.stringify(body || {}),
        });
        let msg = "";
        let ok = Boolean(data.result && data.result.guid);
        if (body && body.action === "sync") {
          const sync = data.result || {};
          msg = sync.found
            ? "Fatura kesildi: " + sync.invoiceNo
            : sync.reason === "api_error"
              ? "BizimHesap okunamadı: " + (sync.error || "bilinmeyen hata")
              : sync.reason === "customer_not_found"
                ? "BizimHesap'ta bu siparişin carisi bulunamadı."
                : "BizimHesap'ta bu siparişe kesilmiş fatura yok.";
          ok = Boolean(sync.found);
        } else if (data.result && data.result.submitted) {
          msg = "Sipariş BizimHesap'a aktarıldı. Faturayı orada kesin; Belge No panelde kendiliğinden görünür.";
        } else if (data.result && data.result.reason === "already_submitted") {
          msg = "Sipariş zaten BizimHesap'a aktarılmış.";
        } else {
          msg = (data.result && data.result.reason) || "Tamamlandı.";
        }
        if (bhNote) {
          bhNote.className = "admin-note " + (ok ? "ok" : "warn");
          bhNote.textContent = msg;
        }
        note(adminOrdersNote, ok ? "ok" : "warn", msg);
        const rowOrder = ordersCache.find((row) => row.id === orderId);
        if (rowOrder) {
          rowOrder._bizimhesap = data.integration || rowOrder._bizimhesap || null;
          rowOrder._bizimhesapConfigured = true;
          applyOrderPatchToUi(rowOrder, rowOrder._statusMails);
        } else {
          await expandOrderRow(orderId, { forceFetch: true });
        }
      } catch (err) {
        if (bhNote) {
          bhNote.hidden = false;
          bhNote.className = "admin-note err";
          bhNote.textContent = err.message || "BizimHesap işlemi başarısız";
        }
        note(adminOrdersNote, "err", err.message || "BizimHesap işlemi başarısız");
      } finally {
        if (sendBtn) sendBtn.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
      }
    }

    const bizimhesapBtn = document.getElementById("adminOrderBizimhesapSend");
    if (bizimhesapBtn) {
      bizimhesapBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (bizimhesapBtn.disabled) return;
        const cached = ordersCache.find((row) => row.id === orderId);
        const hasGuid = Boolean(cached && cached._bizimhesap && cached._bizimhesap.guid);
        if (hasGuid) {
          const ok = window.confirm(
            "BizimHesap'taki mevcut kayıt iptal edilip sipariş yeniden aktarılacak. Faturayı orada kestiyseniz önce BizimHesap'ta kontrol edin. Devam?"
          );
          if (!ok) return;
        }
        await postBizimHesapInvoice(
          hasGuid ? { force: true } : {},
          hasGuid ? "Yeniden aktarılıyor…" : "BizimHesap'a aktarılıyor…"
        );
      });
    }
    const invoiceSyncBtn = document.getElementById("adminOrderInvoiceSync");
    if (invoiceSyncBtn) {
      invoiceSyncBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (invoiceSyncBtn.disabled) return;
        await postBizimHesapInvoice({ action: "sync" }, "BizimHesap'tan okunuyor…");
      });
    }
    const invoiceResolveBtn = document.getElementById("adminOrderInvoiceResolve");
    if (invoiceResolveBtn) {
      invoiceResolveBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (invoiceResolveBtn.disabled) return;
        if (!window.confirm("Fatura düzeltmesini BizimHesap'ta / muhasebecinizle yaptınız mı? Uyarı kapanacak.")) return;
        invoiceResolveBtn.disabled = true;
        try {
          const data = await api("/api/admin/orders/" + encodeURIComponent(orderId) + "/bizimhesap-invoice", {
            method: "POST",
            body: JSON.stringify({ action: "resolve" }),
          });
          note(adminOrdersNote, "ok", "Fatura uyarısı kapatıldı.");
          const rowOrder = ordersCache.find((row) => row.id === orderId);
          if (rowOrder) {
            rowOrder._bizimhesap = data.integration || rowOrder._bizimhesap || null;
            applyOrderPatchToUi(rowOrder, rowOrder._statusMails);
          } else {
            await expandOrderRow(orderId, { forceFetch: true });
          }
        } catch (err) {
          invoiceResolveBtn.disabled = false;
          note(adminOrdersNote, "err", err.message || "Fatura uyarısı kapatılamadı");
        }
      });
    }

    const bankButtons = () =>
      ["adminOrderCancelRefund", "adminOrderItemsRefund", "adminOrderBankInquiry"]
        .map((id) => document.getElementById(id))
        .filter(Boolean);

    function setBankNote(kind, text) {
      const brNote = document.getElementById("adminOrderBankReversalNote");
      if (brNote) {
        brNote.hidden = false;
        brNote.className = "admin-note" + (kind ? " " + kind : "");
        brNote.textContent = text;
      }
      if (kind) note(adminOrdersNote, kind, text);
    }

    async function bankCall(path, body, busyLabel) {
      if (await checkPanelBuild()) {
        setBankNote("err", "Panel güncellendi; eski sürümle banka işlemi yapılmaz. Sayfayı yenileyip tekrar deneyin.");
        return null;
      }
      const buttons = bankButtons();
      buttons.forEach((btn) => (btn.disabled = true));
      setBankNote("", busyLabel);
      try {
        return await api("/api/admin/orders/" + encodeURIComponent(orderId) + path, {
          method: "POST",
          body: JSON.stringify(body || {}),
          timeout: 90000,
        });
      } catch (err) {
        setBankNote("err", err.message || "Banka işlemi yapılamadı");
        return null;
      } finally {
        buttons.forEach((btn) => (btn.disabled = false));
      }
    }

    function reversalResultMessage(data) {
      if (data.unknown) {
        return data.error || "Bankadan kesin sonuç alınamadı; “Bankadan sorgula” ile kontrol edin.";
      }
      let msg = data.fully
        ? "Sipariş iptal/iade edildi: " +
          moneyTr(data.order && data.order.total) +
          (data.method === "void"
            ? " bankada iptal edildi (kart limiti hemen açılır)."
            : " müşterinin kartına iade edildi (2–3 iş günü).")
        : moneyTr(data.amount) + " müşterinin kartına iade edildi (2–3 iş günü).";
      if (data.couponReleased) msg += " Kupon kullanım hakkı geri verildi.";
      msg += " " + formatOrderMailFeedback(data);
      const invoice = data.invoice || {};
      if (invoice.action === "cancelled") msg += " BizimHesap faturası iptal edildi.";
      else if (invoice.action === "issued_cancel_required") msg += " Kesilmiş faturayı BizimHesap'ta iptal edin; Fatura sekmesine bakın.";
      else if (invoice.action === "cancel_failed") msg += " Fatura otomatik iptal edilemedi; Fatura sekmesine bakın.";
      else if (invoice.action === "needs_return_document") msg += " Fatura için iade belgesi gerekli; Fatura sekmesine bakın.";
      return msg;
    }

    async function runReversal(body, confirmText) {
      const preview = await bankCall("/bank-reversal", Object.assign({ dryRun: true }, body), "Tutar hesaplanıyor…");
      if (!preview || !preview.preview || !preview.preview.plan) return;
      const plan = preview.preview.plan;
      setBankNote("", "Onay bekleniyor…");
      if (!window.confirm(confirmText(plan))) {
        setBankNote("", "İşlem iptal edildi; bankaya bir şey gönderilmedi.");
        return;
      }
      const data = await bankCall(
        "/bank-reversal",
        Object.assign({ confirm: true, amount: plan.amount }, body),
        "Banka işleniyor… sayfayı kapatmayın."
      );
      if (!data) return;
      setBankNote(data.ok ? "ok" : "warn", reversalResultMessage(data));
      await expandOrderRow(orderId, { forceFetch: true });
      setBankNote(data.ok ? "ok" : "warn", reversalResultMessage(data));
    }

    const cancelRefundBtn = document.getElementById("adminOrderCancelRefund");
    if (cancelRefundBtn) {
      cancelRefundBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (cancelRefundBtn.disabled) return;
        await runReversal({ mode: "cancel" }, (plan) =>
          "Sipariş iptal edilecek ve " +
          plan.amount +
          " TL müşterinin kartına geri gönderilecek.\n\n" +
          (plan.tryVoid
            ? "Ödeme bugün alındığı için önce bankada iptal denenecek (kart limiti hemen açılır); olmazsa karta iade yapılır."
            : "Karta iade yapılacak; tutar 2–3 iş günü içinde müşterinin kartına yansır.") +
          "\n\nBu işlem geri alınamaz. Devam edilsin mi?"
        );
      });
    }

    function selectedRefundItems() {
      return Array.from(document.querySelectorAll(".admin-refund-qty"))
        .map((input) => ({
          index: Number(input.dataset.index),
          qty: Math.max(0, Math.min(Number(input.max) || 0, Math.floor(Number(input.value) || 0))),
        }))
        .filter((row) => row.qty > 0);
    }

    function refreshRefundEstimate() {
      const estimate = document.getElementById("adminRefundEstimate");
      const cached = ordersCache.find((row) => row.id === orderId);
      if (!estimate || !cached) return;
      const shippingBox = document.getElementById("adminRefundShipping");
      estimate.textContent =
        "Tahmini iade: " +
        moneyTr(estimateItemsRefund(cached, selectedRefundItems(), Boolean(shippingBox && shippingBox.checked)));
    }
    document.querySelectorAll(".admin-refund-qty, #adminRefundShipping").forEach((input) => {
      input.addEventListener("input", refreshRefundEstimate);
      input.addEventListener("change", refreshRefundEstimate);
      input.addEventListener("click", (event) => event.stopPropagation());
    });

    const itemsRefundBtn = document.getElementById("adminOrderItemsRefund");
    if (itemsRefundBtn) {
      itemsRefundBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (itemsRefundBtn.disabled) return;
        const items = selectedRefundItems();
        const shippingBox = document.getElementById("adminRefundShipping");
        const includeShipping = Boolean(shippingBox && shippingBox.checked);
        if (!items.length && !includeShipping) {
          setBankNote("err", "İade için en az bir ürün adedi veya kargo ücreti seçin.");
          return;
        }
        await runReversal({ mode: "items", items, includeShipping }, (plan) =>
          plan.amount +
          " TL müşterinin kartına iade edilecek (" +
          items.reduce((sum, row) => sum + row.qty, 0) +
          " ürün" +
          (includeShipping ? " + kargo ücreti" : "") +
          ").\n\nTutar 2–3 iş günü içinde karta yansır. Bu işlem geri alınamaz. Devam edilsin mi?"
        );
      });
    }

    const inquiryBtn = document.getElementById("adminOrderBankInquiry");
    if (inquiryBtn) {
      inquiryBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (inquiryBtn.disabled) return;
        const data = await bankCall("/bank-inquiry", {}, "Bankaya soruluyor…");
        if (!data) return;
        const messages = {
          record_success:
            "Bankada iade/iptal bulundu ve siparişe işlendi (bankadaki toplam: " +
            moneyTr(data.summary && data.summary.reversedAmount) +
            ").",
          resolve_not_performed: "Bankada yeni bir iade/iptal yok; işlem yapılmamış. Gerekirse yeniden deneyebilirsiniz.",
          in_sync: "Kayıtlar bankayla uyumlu (bankada iade/iptal toplamı " +
            moneyTr(data.summary && data.summary.reversedAmount) +
            ").",
          inconclusive:
            "Banka cevabında bu siparişin satış kaydı görünmedi; sonuç kesinleşmedi. Akbank ile kontrol edin, tekrar iade denemeyin.",
        };
        const kind = data.decision === "inconclusive" ? "warn" : "ok";
        const msg = messages[data.decision] || "Sorgulama tamamlandı.";
        await expandOrderRow(orderId, { forceFetch: true });
        setBankNote(kind, msg);
      });
    }
  }

  async function expandOrderRow(orderId, options) {
    selectedOrderId = orderId;
    const block = adminOrderList.querySelector('[data-order-id="' + CSS.escape(orderId) + '"]');
    if (!block) return;
    adminOrderList.querySelectorAll(".admin-order-expand").forEach((panel) => {
      const el = panel.closest(".admin-order-block");
      if (el === block) return;
      if (el) el.classList.remove("is-open");
      panel.hidden = true;
      // Detay alanları sabit id kullanır; kapanan paneller DOM’da kalırsa düğmeler yanlış panele bağlanır.
      panel.innerHTML = "";
    });
    const expand = block.querySelector(".admin-order-expand");
    if (!expand) return;
    expand.hidden = false;
    block.classList.add("is-open");

    const opts = options || {};
    const cached = ordersCache.find((order) => order.id === orderId);
    if (cached && cached._detailLoaded && !opts.forceFetch) {
      if (selectedOrderId !== orderId) return;
      expand.innerHTML = buildOrderDetailHtml(cached, cached._statusMails);
      bindOrderDetailActions(orderId);
      return;
    }
    expand.innerHTML = "<p class='admin-hint'>Yükleniyor…</p>";

    try {
      const data = await api("/api/admin/orders/" + encodeURIComponent(orderId), { timeout: 20000 });
      const order = data.order;
      if (!order || selectedOrderId !== orderId) return;
      if (Array.isArray(data.statusMails)) order._statusMails = data.statusMails;
      order._bizimhesap = data.bizimhesap || null;
      order._bizimhesapConfigured = data.bizimhesapConfigured === true;
      order.invoiceUntracked = data.invoiceUntracked === true;
      order._documents = Array.isArray(data.documents) ? data.documents : [];
      order._bankReversal = data.bankReversal || null;
      order._bankInquiryAvailable = data.bankInquiryAvailable === true;
      order._detailLoaded = true;
      const idx = ordersCache.findIndex((row) => row.id === orderId);
      if (idx >= 0) ordersCache[idx] = order;
      else ordersCache.push(order);
      paintOrderRowBadges(block, order);
      expand.innerHTML = buildOrderDetailHtml(order, order._statusMails);
      bindOrderDetailActions(orderId);
    } catch (err) {
      expand.innerHTML =
        "<p class='admin-note err'>" + escapeHtml(err.message || "Detay yüklenemedi") + "</p>";
    }
  }

  function collapseOrderRow() {
    selectedOrderId = "";
    if (!adminOrderList) return;
    adminOrderList.querySelectorAll(".admin-order-block.is-open").forEach((el) => {
      el.classList.remove("is-open");
      const panel = el.querySelector(".admin-order-expand");
      if (panel) {
        panel.hidden = true;
        panel.innerHTML = "";
      }
    });
  }

  async function toggleOrderRow(orderId) {
    if (selectedOrderId === orderId) {
      collapseOrderRow();
      return;
    }
    await expandOrderRow(orderId);
  }

  async function loadAdminOrders(options) {
    if (!adminOrderList || !token) return;
    const opts = options || {};
    if (opts.keepOpen) selectedOrderId = opts.keepOpen;
    const period = currentOrderPeriod();
    const data = await api("/api/admin/orders?" + orderListQueryString());
    ordersCache = (data && data.orders) || [];
    if (Array.isArray(data.shippingCarriers) && data.shippingCarriers.length) {
      shippingCarriers = data.shippingCarriers;
    }
    if (adminOrdersNote) {
      const q = currentOrderSearch();
      adminOrdersNote.textContent = q
        ? ordersCache.length + " sonuç · tüm tarihlerde arandı"
        : ordersCache.length + " sipariş · " + period.from + " → " + period.to;
    }
    adminOrderList.textContent = "";
    if (!ordersCache.length) {
      const empty = document.createElement("div");
      empty.className = "admin-table-empty";
      empty.textContent = currentOrderSearch()
        ? "Bu aramaya uyan sipariş yok."
        : "Seçilen tarih aralığında sipariş yok.";
      adminOrderList.appendChild(empty);
      selectedOrderId = "";
      return;
    }
    ordersCache.forEach((order) => {
      const block = document.createElement("article");
      block.className =
        "admin-order-block" + (selectedOrderId === order.id ? " is-open" : "");
      block.dataset.orderId = order.id;
      block.setAttribute("role", "listitem");

      const row = document.createElement("button");
      row.type = "button";
      row.className = "admin-order-row";
      row.setAttribute("aria-expanded", selectedOrderId === order.id ? "true" : "false");
      const who = (order.customer && order.customer.name) || "—";
      row.innerHTML =
        "<span class='admin-order-id'>" +
        escapeHtml(order.id) +
        "</span>" +
        "<time class='admin-order-date' datetime='" +
        escapeAttr(order.createdAt || "") +
        "'>" +
        escapeHtml(formatOrderDate(order.createdAt)) +
        "</time>" +
        "<span class='admin-order-customer'>" +
        escapeHtml(who) +
        "</span>" +
        "<span class='admin-order-status-cell admin-order-payment-cell'>" +
        paymentStatusBadge(order) +
        "</span>" +
        "<span class='admin-order-status-cell admin-order-fulfillment-cell'>" +
        fulfillmentStatusBadge(order) +
        "</span>" +
        "<span class='admin-order-progress-cell'>" +
        orderProgressHtml(order) +
        "</span>" +
        "<span class='admin-order-total'>" +
        moneyTr(order.total) +
        "</span>" +
        "<span class='admin-order-chevron' aria-hidden='true'></span>";
      row.addEventListener("click", () => {
        toggleOrderRow(order.id).catch(() => {});
      });

      const expand = document.createElement("div");
      expand.className = "admin-order-expand";
      expand.hidden = selectedOrderId !== order.id;
      expand.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      block.appendChild(row);
      block.appendChild(expand);
      adminOrderList.appendChild(block);
    });

    if (selectedOrderId) {
      const stillThere = ordersCache.some((o) => o.id === selectedOrderId);
      if (stillThere) await expandOrderRow(selectedOrderId);
      else selectedOrderId = "";
    }
  }

  if (orderSearch) {
    orderSearch.addEventListener("input", () => {
      clearTimeout(orderSearchTimer);
      orderSearchTimer = setTimeout(() => {
        selectedOrderId = "";
        loadAdminOrders().catch(() => {});
      }, 250);
    });
    orderSearch.addEventListener("search", () => {
      clearTimeout(orderSearchTimer);
      selectedOrderId = "";
      loadAdminOrders().catch(() => {});
    });
    orderSearch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      clearTimeout(orderSearchTimer);
      selectedOrderId = "";
      loadAdminOrders().catch(() => {});
    });
  }

  if (orderStatusFilter) {
    orderStatusFilter.addEventListener("change", () => {
      selectedOrderId = "";
      loadAdminOrders().catch(() => {});
    });
  }

  if (orderPeriodApply) {
    orderPeriodApply.addEventListener("click", () => {
      selectedOrderId = "";
      loadAdminOrders().catch(() => {});
    });
  }

  document.querySelectorAll("[data-order-days]").forEach((button) => {
    button.addEventListener("click", () => {
      setOrderPeriodDays(button.getAttribute("data-order-days"));
      selectedOrderId = "";
      loadAdminOrders().catch(() => {});
    });
  });

  if (orderFrom || orderTo) {
    const savedOrdersPeriod = readSavedOrderPeriod();
    syncOrderPeriodInputs(savedOrdersPeriod.from, savedOrdersPeriod.to);
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

  const LEAD_REPLY_MAX_FILES = 5;
  const LEAD_REPLY_MAX_BYTES = 10 * 1024 * 1024;
  const LEAD_MESSAGE_PREVIEW_LINES = 8;
  const LEAD_MESSAGE_PREVIEW_CHARS = 600;
  const leadReplyModal = document.getElementById("leadReplyModal");
  const leadReplyForm = document.getElementById("leadReplyForm");
  const leadReplyFiles = document.getElementById("leadReplyFiles");
  const leadReplyFileList = document.getElementById("leadReplyFileList");
  const leadReplyNote = document.getElementById("leadReplyNote");
  let leadReplyTarget = null;
  let leadReplyAttachments = [];

  function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
  }

  function leadReplySummary(reply) {
    const files = Array.isArray(reply.attachments) ? reply.attachments : [];
    return (
      formatOrderDate(reply.at) +
      " · " +
      (reply.subject || "Yanıt") +
      (files.length ? " · ek: " + files.map((file) => file.filename).join(", ") : "") +
      (reply.by ? " · " + reply.by : "")
    );
  }

  function renderLeadRow(lead, replyEnabled) {
    const row = document.createElement("div");
    row.className = "admin-list-item admin-lead-row";
    row.setAttribute("role", "listitem");
    const main = document.createElement("div");
    main.className = "admin-lead-main";

    const head = document.createElement("div");
    head.className = "admin-lead-head";
    const title = document.createElement("strong");
    title.textContent = lead.firma || "—";
    head.appendChild(title);
    const replies = Array.isArray(lead.replies) ? lead.replies : [];
    const badge = document.createElement("em");
    if (lead.spam) {
      badge.className = "admin-lead-badge is-spam";
      badge.textContent = "Spam";
    } else if (replies.length) {
      badge.className = "admin-lead-badge is-replied";
      badge.textContent = "Yanıtlandı" + (replies.length > 1 ? " · " + replies.length : "");
    } else {
      badge.className = "admin-lead-badge is-waiting";
      badge.textContent = "Yanıt bekliyor";
    }
    head.appendChild(badge);
    main.appendChild(head);

    const meta = document.createElement("span");
    meta.textContent = [
      formatOrderDate(lead.createdAt),
      lead.email || "—",
      lead.tel || "—",
      lead.vkn ? "VKN " + lead.vkn : "",
    ]
      .filter(Boolean)
      .join(" · ");
    main.appendChild(meta);

    const topic = [lead.konu, lead.urun, lead.kategori].filter(Boolean).join(" · ");
    if (topic) {
      const topicEl = document.createElement("span");
      topicEl.className = "admin-lead-topic";
      topicEl.textContent = topic;
      main.appendChild(topicEl);
    }
    if (lead.mesaj) {
      const text = String(lead.mesaj);
      const msg = document.createElement("span");
      msg.className = "admin-lead-message";
      msg.textContent = text;
      main.appendChild(msg);
      if (text.split("\n").length > LEAD_MESSAGE_PREVIEW_LINES || text.length > LEAD_MESSAGE_PREVIEW_CHARS) {
        msg.classList.add("is-collapsed");
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "admin-lead-more";
        toggle.textContent = "Tamamını göster";
        toggle.setAttribute("aria-expanded", "false");
        toggle.addEventListener("click", () => {
          const open = !msg.classList.toggle("is-collapsed");
          toggle.textContent = open ? "Kısalt" : "Tamamını göster";
          toggle.setAttribute("aria-expanded", String(open));
        });
        main.appendChild(toggle);
      }
    }
    if (replies.length) {
      const history = document.createElement("ul");
      history.className = "admin-lead-replies";
      replies
        .slice()
        .reverse()
        .forEach((reply) => {
          const item = document.createElement("li");
          item.textContent = "↩ " + leadReplySummary(reply);
          history.appendChild(item);
        });
      main.appendChild(history);
    }
    row.appendChild(main);

    if (!lead.spam && lead.id && lead.email) {
      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "btn btn-primary btn-sm admin-lead-reply-btn";
      replyBtn.textContent = replies.length ? "Tekrar yanıtla" : "Yanıtla";
      if (!replyEnabled) {
        replyBtn.disabled = true;
        replyBtn.title = "Canlı SMTP yapılandırılmadan panelden mail gönderilemez.";
      }
      replyBtn.addEventListener("click", () => openLeadReplyModal(lead));
      row.appendChild(replyBtn);
    }
    return row;
  }

  function isLeadWaiting(lead) {
    return Boolean(lead) && !lead.spam && !(Array.isArray(lead.replies) && lead.replies.length);
  }

  function renderLeadsNavAlert(leads) {
    const alertEl = document.getElementById("leadsNavAlert");
    if (!alertEl) return;
    const waiting = (Array.isArray(leads) ? leads : []).filter(isLeadWaiting).length;
    alertEl.hidden = waiting <= 0;
    const label = waiting + " talep yanıt bekliyor";
    const textEl = document.getElementById("leadsNavAlertText");
    if (textEl) textEl.textContent = label;
    const tabBtn = document.getElementById("leadsTab");
    if (tabBtn) tabBtn.title = waiting > 0 ? label : "";
  }

  async function refreshLeadsNavAlert() {
    if (!token || (panelView && panelView.hidden)) return;
    const data = await api("/api/admin/leads");
    renderLeadsNavAlert(data && data.leads);
  }

  setInterval(() => {
    if (document.hidden) return;
    refreshLeadsNavAlert().catch(() => {});
  }, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshLeadsNavAlert().catch(() => {});
  });

  async function loadAdminLeads() {
    const listEl = document.getElementById("adminLeadList");
    const noteEl = document.getElementById("adminLeadsNote");
    if (!listEl) return;
    try {
      const data = await api("/api/admin/leads");
      const leads = Array.isArray(data.leads) ? data.leads : [];
      renderLeadsNavAlert(leads);
      listEl.textContent = "";
      if (!leads.length) {
        const empty = document.createElement("div");
        empty.className = "admin-table-empty";
        empty.textContent = "Henüz iletişim talebi yok.";
        listEl.appendChild(empty);
        note(noteEl, "ok", "Liste boş.");
        return;
      }
      leads.forEach((lead) => listEl.appendChild(renderLeadRow(lead, data.replyEnabled === true)));
      const waiting = leads.filter(
        (lead) => !lead.spam && !(Array.isArray(lead.replies) && lead.replies.length)
      ).length;
      note(
        noteEl,
        data.replyEnabled === true ? "ok" : "warn",
        leads.length +
          " talep · " +
          waiting +
          " yanıt bekliyor · saklama taslak politika (önerilen 2 yıl)." +
          (data.replyEnabled === true ? "" : " Canlı SMTP yok; panelden yanıt gönderilemez.")
      );
    } catch (err) {
      note(noteEl, "err", err.message || "Talepler yüklenemedi");
    }
  }

  function renderLeadReplyFiles() {
    if (!leadReplyFileList) return;
    leadReplyFileList.textContent = "";
    leadReplyAttachments.forEach((file, index) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = file.name + " · " + formatFileSize(file.size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost btn-sm";
      remove.textContent = "Kaldır";
      remove.setAttribute("aria-label", file.name + " ekini kaldır");
      remove.addEventListener("click", () => {
        leadReplyAttachments.splice(index, 1);
        renderLeadReplyFiles();
      });
      item.appendChild(label);
      item.appendChild(remove);
      leadReplyFileList.appendChild(item);
    });
  }

  function openLeadReplyModal(lead) {
    if (!leadReplyModal || !lead) return;
    leadReplyTarget = lead;
    leadReplyAttachments = [];
    document.getElementById("leadReplyTo").value = lead.email || "";
    document.getElementById("leadReplySubject").value =
      "Teklif talebiniz — Patygo Teknoloji" + (lead.firma ? " / " + lead.firma : "");
    document.getElementById("leadReplyMessage").value =
      "Merhaba,\n\nTalebiniz için teşekkür ederiz.\n\n\nSaygılarımızla,\nPatygo Teknoloji\ninfo@patygoteknoloji.com";
    document.getElementById("leadReplyOriginalMeta").textContent = [
      lead.firma,
      formatOrderDate(lead.createdAt),
      [lead.konu, lead.urun].filter(Boolean).join(" · "),
    ]
      .filter(Boolean)
      .join(" · ");
    document.getElementById("leadReplyOriginal").textContent = lead.mesaj || "";
    if (leadReplyFiles) leadReplyFiles.value = "";
    renderLeadReplyFiles();
    note(leadReplyNote, "", "");
    leadReplyModal.hidden = false;
    document.body.classList.add("admin-modal-open");
    const message = document.getElementById("leadReplyMessage");
    message.focus();
    message.setSelectionRange(message.value.indexOf("\n\n\n") + 2, message.value.indexOf("\n\n\n") + 2);
  }

  function closeLeadReplyModal() {
    if (!leadReplyModal || leadReplyModal.hidden) return;
    leadReplyModal.hidden = true;
    leadReplyTarget = null;
    leadReplyAttachments = [];
    if (!document.querySelector(".admin-modal:not([hidden])")) {
      document.body.classList.remove("admin-modal-open");
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^,]*,/, ""));
      reader.onerror = () => reject(new Error(file.name + " okunamadı."));
      reader.readAsDataURL(file);
    });
  }

  if (leadReplyFiles) {
    leadReplyFiles.addEventListener("change", () => {
      const picked = Array.from(leadReplyFiles.files || []);
      leadReplyFiles.value = "";
      const next = leadReplyAttachments.concat(picked);
      const total = next.reduce((sum, file) => sum + file.size, 0);
      if (next.length > LEAD_REPLY_MAX_FILES) {
        note(leadReplyNote, "err", "En fazla " + LEAD_REPLY_MAX_FILES + " dosya eklenebilir.");
        return;
      }
      if (total > LEAD_REPLY_MAX_BYTES) {
        note(leadReplyNote, "err", "Ekler toplamı en fazla 10 MB olabilir (şu an " + formatFileSize(total) + ").");
        return;
      }
      note(leadReplyNote, "", "");
      leadReplyAttachments = next;
      renderLeadReplyFiles();
    });
  }

  if (leadReplyForm) {
    leadReplyForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!leadReplyTarget) return;
      const sendBtn = document.getElementById("leadReplySendBtn");
      const subject = document.getElementById("leadReplySubject").value.trim();
      const message = document.getElementById("leadReplyMessage").value.trim();
      if (subject.length < 3 || message.length < 5) {
        note(leadReplyNote, "err", "Konu ve mesajı doldurun.");
        return;
      }
      sendBtn.disabled = true;
      note(leadReplyNote, "", "Gönderiliyor…");
      try {
        const attachments = [];
        for (const file of leadReplyAttachments) {
          attachments.push({ filename: file.name, dataBase64: await readFileAsBase64(file) });
        }
        await api("/api/admin/leads/" + encodeURIComponent(leadReplyTarget.id) + "/reply", {
          method: "POST",
          body: JSON.stringify({ subject, message, attachments }),
          timeout: 120000,
        });
        const to = leadReplyTarget.email;
        closeLeadReplyModal();
        await loadAdminLeads().catch(() => {});
        note(document.getElementById("adminLeadsNote"), "ok", "Yanıt " + to + " adresine gönderildi.");
      } catch (err) {
        note(leadReplyNote, "err", (err && err.message) || "Yanıt gönderilemedi.");
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-close-lead-reply]").forEach((el) => {
    el.addEventListener("click", () => closeLeadReplyModal());
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeLeadReplyModal();
  });

  const adminLeadsRefresh = document.getElementById("adminLeadsRefresh");
  if (adminLeadsRefresh) {
    adminLeadsRefresh.addEventListener("click", () => {
      loadAdminLeads().catch(() => {});
    });
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

  const adminShippingForm = document.getElementById("adminShippingForm");
  const shippingSettingsView = document.getElementById("shippingSettingsView");
  const shippingSettingsSummary = document.getElementById("shippingSettingsSummary");
  const shippingAkakceHint = document.getElementById("shippingAkakceHint");
  const shippingEditBtn = document.getElementById("shippingEditBtn");
  const shippingCancelBtn = document.getElementById("shippingCancelBtn");
  const shippingFreeThreshold = document.getElementById("shippingFreeThreshold");
  const shippingFeeAmount = document.getElementById("shippingFeeAmount");
  const shippingMinOrder = document.getElementById("shippingMinOrder");
  const shippingDispatchDays = document.getElementById("shippingDispatchDays");
  const shippingClosedDays = document.getElementById("shippingClosedDays");
  const shippingPreview = document.getElementById("shippingPreview");
  const adminShippingNote = document.getElementById("adminShippingNote");
  let shippingSettingsSaved = null;

  function shippingHasSavedSettings(settings) {
    const cfg = settings || {};
    return Number(cfg.shippingFee) > 0;
  }

  function setShippingEditor(open) {
    if (adminShippingForm) adminShippingForm.hidden = !open;
    if (shippingSettingsView) shippingSettingsView.hidden = open;
    if (shippingCancelBtn) shippingCancelBtn.hidden = !open;
  }

  function renderShippingSummary(settings) {
    if (!shippingSettingsSummary) return;
    shippingSettingsSaved = settings || null;
    const fee = Math.max(0, Number(settings && settings.shippingFee) || 0);
    const threshold = Math.max(0, Number(settings && settings.freeShippingThreshold) || 0);
    const minOrder = Math.max(0, Number(settings && settings.minOrderAmount) || 0);
    const closedDays = settings && Array.isArray(settings.closedDays) ? settings.closedDays : [];
    shippingSettingsSummary.innerHTML =
      "<div><dt>Kargo bedeli (KDV dahil)</dt><dd>" +
      (fee > 0 ? formatMoney(fee) : "Tanımlı değil") +
      "</dd></div>" +
      "<div><dt>Ücretsiz kargo eşiği</dt><dd>" +
      (threshold > 0 ? formatMoney(threshold) + " ve üzeri" : "Yok (her siparişe kargo uygulanır)") +
      "</dd></div>" +
      "<div><dt>Minimum sepet tutarı</dt><dd>" +
      (minOrder > 0 ? formatMoney(minOrder) + " (KDV dahil, kargo hariç)" : "Yok") +
      "</dd></div>" +
      "<div><dt>Kargoya veriliş</dt><dd>" +
      escapeHtml(String((settings && settings.dispatchBusinessDays) || 2)) +
      " iş günü</dd></div>" +
      "<div><dt>Kapalı günler</dt><dd>" +
      (closedDays.length ? escapeHtml(closedDays.join(", ")) : "Yok") +
      "</dd></div>" +
      (settings && settings.updatedAt
        ? "<div><dt>Son güncelleme</dt><dd>" + escapeHtml(formatDate(settings.updatedAt)) + "</dd></div>"
        : "");
    if (shippingAkakceHint) {
      if (fee <= 0) {
        shippingAkakceHint.textContent =
          "Akakçe XML feed’de shipPrice şu an 0,00 TL görünür. Kargo bedeli kaydedilince ürün fiyatına göre güncellenir.";
      } else if (threshold > 0) {
        shippingAkakceHint.textContent =
          "Akakçe XML: ürün KDV dahil fiyatı " +
          formatMoney(threshold) +
          " altındaysa shipPrice " +
          formatMoney(fee) +
          ", eşik ve üzerinde 0,00 TL yazılır.";
      } else {
        shippingAkakceHint.textContent =
          "Akakçe XML feed’de tüm ürünler için shipPrice " + formatMoney(fee) + " olarak yansır.";
      }
    }
  }

  function readShippingFormValues() {
    return {
      freeShippingThreshold: Math.max(0, Number(shippingFreeThreshold && shippingFreeThreshold.value) || 0),
      shippingFee: Math.max(0, Number(shippingFeeAmount && shippingFeeAmount.value) || 0),
      minOrderAmount: Math.max(0, Number(shippingMinOrder && shippingMinOrder.value) || 0),
      dispatchBusinessDays: Math.min(
        10,
        Math.max(1, Math.round(Number(shippingDispatchDays && shippingDispatchDays.value) || 2))
      ),
      closedDays: String((shippingClosedDays && shippingClosedDays.value) || "")
        .split(/[\s,;]+/)
        .filter(Boolean),
    };
  }

  function validateShippingFormValues(values) {
    if (values.freeShippingThreshold > 0 && values.shippingFee <= 0) {
      return "Ücretsiz kargo eşiği tanımlıysa kargo bedeli de girilmelidir.";
    }
    if (values.shippingFee <= 0) {
      return "Akakçe ve sepet için kargo bedeli girilmelidir.";
    }
    return "";
  }

  function fillShippingForm(settings) {
    const cfg = settings || {};
    if (shippingFreeThreshold) {
      shippingFreeThreshold.value =
        Number(cfg.freeShippingThreshold) > 0 ? String(cfg.freeShippingThreshold) : "";
    }
    if (shippingFeeAmount) {
      shippingFeeAmount.value = Number(cfg.shippingFee) > 0 ? String(cfg.shippingFee) : "";
    }
    if (shippingMinOrder) {
      shippingMinOrder.value = Number(cfg.minOrderAmount) > 0 ? String(cfg.minOrderAmount) : "";
    }
    if (shippingDispatchDays) shippingDispatchDays.value = String(cfg.dispatchBusinessDays || 2);
    if (shippingClosedDays) {
      shippingClosedDays.value = Array.isArray(cfg.closedDays) ? cfg.closedDays.join("\n") : "";
    }
    renderShippingPreview();
  }

  function renderShippingPreview() {
    if (!shippingPreview) return;
    const threshold = Math.max(0, Number(shippingFreeThreshold && shippingFreeThreshold.value) || 0);
    const fee = Math.max(0, Number(shippingFeeAmount && shippingFeeAmount.value) || 0);
    if (fee <= 0) {
      shippingPreview.textContent = "Kargo bedeli tanımlanmadığında sepette kargo satırı gösterilmez.";
      return;
    }
    if (threshold > 0) {
      shippingPreview.textContent =
        formatMoney(threshold) +
        " ve üzeri siparişlerde kargo ücretsiz. " +
        formatMoney(threshold) +
        " altı siparişlerde kargo bedeli " +
        formatMoney(fee) +
        " (KDV dahil).";
      return;
    }
    shippingPreview.textContent =
      "Tüm siparişlere kargo bedeli " + formatMoney(fee) + " (KDV dahil) eklenir.";
  }

  async function loadAdminShippingSettings() {
    if (!adminShippingForm || !token) return;
    const data = await api("/api/admin/shipping/settings");
    const settings = (data && data.settings) || {};
    fillShippingForm(settings);
    renderShippingSummary(settings);
    setShippingEditor(!shippingHasSavedSettings(settings));
    note(adminShippingNote, "", "");
  }

  if (shippingEditBtn) {
    shippingEditBtn.addEventListener("click", () => {
      fillShippingForm(shippingSettingsSaved || {});
      setShippingEditor(true);
      note(adminShippingNote, "", "");
      if (shippingFeeAmount) shippingFeeAmount.focus();
    });
  }

  if (shippingCancelBtn) {
    shippingCancelBtn.addEventListener("click", () => {
      fillShippingForm(shippingSettingsSaved || {});
      if (shippingHasSavedSettings(shippingSettingsSaved)) {
        setShippingEditor(false);
      }
      note(adminShippingNote, "", "");
    });
  }

  if (shippingFreeThreshold) shippingFreeThreshold.addEventListener("input", renderShippingPreview);
  if (shippingFeeAmount) shippingFeeAmount.addEventListener("input", renderShippingPreview);

  if (adminShippingForm) {
    adminShippingForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const submitBtn = adminShippingForm.querySelector('button[type="submit"]');
      const values = readShippingFormValues();
      const validationError = validateShippingFormValues(values);
      if (validationError) {
        note(adminShippingNote, "err", validationError);
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        const saved = await api("/api/admin/shipping/settings", {
          method: "PUT",
          timeout: 20000,
          body: JSON.stringify({
            freeShippingThreshold: values.freeShippingThreshold,
            shippingFee: values.shippingFee,
            minOrderAmount: values.minOrderAmount,
            dispatchBusinessDays: values.dispatchBusinessDays,
            closedDays: values.closedDays,
          }),
        });
        const settings = (saved && saved.settings) || values;
        fillShippingForm(settings);
        renderShippingSummary(settings);
        setShippingEditor(false);
        note(adminShippingNote, "ok", "Kargo ayarları kaydedildi. Akakçe XML bir sonraki istekte güncellenir.");
      } catch (err) {
        note(adminShippingNote, "err", err.message || "Kaydedilemedi");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  const adminInstallmentForm = document.getElementById("adminInstallmentForm");
  const installmentEnabled = document.getElementById("installmentEnabled");
  const installmentMinAmount = document.getElementById("installmentMinAmount");
  const installmentRateGrid = document.getElementById("installmentRateGrid");
  const installmentPreview = document.getElementById("installmentPreview");
  const adminInstallmentNote = document.getElementById("adminInstallmentNote");
  const INSTALLMENT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  if (installmentRateGrid && !installmentRateGrid.children.length) {
    INSTALLMENT_COUNTS.forEach((count) => {
      const label = document.createElement("label");
      label.textContent = count + " taksit";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.step = "0.01";
      input.inputMode = "decimal";
      input.placeholder = "Kapalı";
      input.dataset.count = String(count);
      input.addEventListener("input", renderInstallmentPreview);
      label.appendChild(input);
      installmentRateGrid.appendChild(label);
    });
  }

  function readInstallmentForm() {
    const options = [];
    if (installmentRateGrid) {
      installmentRateGrid.querySelectorAll("input[data-count]").forEach((input) => {
        const raw = String(input.value || "").trim().replace(",", ".");
        if (raw === "") return;
        options.push({ count: Number(input.dataset.count), ratePercent: Number(raw) });
      });
    }
    return {
      enabled: Boolean(installmentEnabled && installmentEnabled.checked),
      minAmount: Math.max(0, Number(installmentMinAmount && installmentMinAmount.value) || 0),
      options,
    };
  }

  function fillInstallmentForm(settings) {
    const cfg = settings || {};
    if (installmentEnabled) installmentEnabled.checked = Boolean(cfg.enabled);
    if (installmentMinAmount) {
      installmentMinAmount.value = Number(cfg.minAmount) > 0 ? String(cfg.minAmount) : "";
    }
    const rates = new Map((Array.isArray(cfg.options) ? cfg.options : []).map((o) => [Number(o.count), o.ratePercent]));
    if (installmentRateGrid) {
      installmentRateGrid.querySelectorAll("input[data-count]").forEach((input) => {
        const rate = rates.get(Number(input.dataset.count));
        input.value = rate == null ? "" : String(rate);
      });
    }
    renderInstallmentPreview();
  }

  function renderInstallmentPreview() {
    if (!installmentPreview) return;
    const values = readInstallmentForm();
    if (!values.options.length) {
      installmentPreview.textContent = "Oran girilmediği için müşteriye yalnızca tek çekim sunulur.";
      return;
    }
    const sample = 10000;
    const parts = values.options.map((o) => {
      const total = Math.round(sample * (1 + (Number(o.ratePercent) || 0) / 100) * 100) / 100;
      return o.count + " taksit: " + formatMoney(total);
    });
    installmentPreview.textContent =
      (values.enabled ? "" : "Taksit kapalı (kaydedilen oranlar saklanır). ") +
      formatMoney(sample) + " sepet için toplam: " + parts.join(" · ");
  }

  async function loadAdminInstallmentSettings() {
    if (!adminInstallmentForm || !token) return;
    const data = await api("/api/admin/installments/settings");
    fillInstallmentForm((data && data.settings) || {});
    note(adminInstallmentNote, "", "");
  }

  if (installmentEnabled) installmentEnabled.addEventListener("change", renderInstallmentPreview);

  if (adminInstallmentForm) {
    adminInstallmentForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const submitBtn = adminInstallmentForm.querySelector('button[type="submit"]');
      const values = readInstallmentForm();
      if (values.enabled && !values.options.length) {
        note(adminInstallmentNote, "err", "Taksiti açmak için en az bir taksit oranı girin.");
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        const saved = await api("/api/admin/installments/settings", {
          method: "PUT",
          timeout: 20000,
          body: JSON.stringify(values),
        });
        fillInstallmentForm((saved && saved.settings) || values);
        note(
          adminInstallmentNote,
          "ok",
          values.enabled ? "Taksit seçenekleri kaydedildi ve müşteriye gösteriliyor." : "Kaydedildi. Taksit müşteriye gösterilmiyor."
        );
      } catch (err) {
        note(adminInstallmentNote, "err", err.message || "Kaydedilemedi");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  const adminCouponForm = document.getElementById("adminCouponForm");
  const couponTableBody = document.getElementById("couponTableBody");
  const adminCouponNote = document.getElementById("adminCouponNote");

  function couponDiscountLabel(coupon) {
    if (coupon.type === "amount") return moneyTr(coupon.value);
    return "%" + coupon.value + (coupon.maxDiscount > 0 ? " (en fazla " + moneyTr(coupon.maxDiscount) + ")" : "");
  }

  function couponConditionLabel(coupon) {
    const parts = [];
    if (coupon.minOrder > 0) parts.push(moneyTr(coupon.minOrder) + " ve üzeri");
    if (coupon.startsAt || coupon.endsAt) {
      parts.push((coupon.startsAt || "…") + " → " + (coupon.endsAt || "…"));
    }
    return parts.join(" · ") || "Koşulsuz";
  }

  const COUPON_SORT_VALUES = {
    code: (coupon) => coupon.code,
    // Percent coupons first, then fixed amounts; each group by value.
    discount: (coupon) => (coupon.type === "amount" ? 1e9 : 0) + (Number(coupon.value) || 0),
    minOrder: (coupon) => Number(coupon.minOrder) || 0,
    used: (coupon) => Number(coupon.usedCount) || 0,
    active: (coupon) => (coupon.active ? 1 : 0),
  };

  function renderCouponTable(coupons) {
    if (!couponTableBody) return;
    if (!coupons.length) {
      couponTableBody.innerHTML = '<tr><td colspan="6">Henüz kupon yok.</td></tr>';
      return;
    }
    couponTableBody.innerHTML = couponSort
      .sortList(coupons, COUPON_SORT_VALUES)
      .map((coupon) => {
        const code = escapeHtml(coupon.code);
        return (
          "<tr><td><strong>" + code + "</strong></td>" +
          "<td>" + escapeHtml(couponDiscountLabel(coupon)) + "</td>" +
          "<td>" + escapeHtml(couponConditionLabel(coupon)) + "</td>" +
          "<td>" + escapeHtml(String(coupon.usedCount)) + (coupon.usageLimit > 0 ? " / " + escapeHtml(String(coupon.usageLimit)) : "") + "</td>" +
          "<td>" + (coupon.active ? "Aktif" : "Kapalı") + "</td>" +
          '<td><button type="button" class="btn btn-outline" data-coupon-edit="' + code + '">Düzenle</button> ' +
          '<button type="button" class="btn btn-outline" data-coupon-toggle="' + code + '" data-active="' + (coupon.active ? "1" : "0") + '">' +
          (coupon.active ? "Kapat" : "Aç") +
          "</button> " +
          '<button type="button" class="btn btn-outline" data-coupon-delete="' + code + '">Sil</button></td></tr>'
        );
      })
      .join("");
  }

  let adminCoupons = [];

  async function loadAdminCoupons() {
    if (!couponTableBody || !token) return;
    const data = await api("/api/admin/coupons");
    adminCoupons = (data && data.coupons) || [];
    renderCouponTable(adminCoupons);
  }

  function fillCouponForm(coupon) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value == null ? "" : String(value);
    };
    set("couponCode", coupon.code);
    set("couponType", coupon.type);
    set("couponValue", coupon.value);
    set("couponMaxDiscount", coupon.maxDiscount > 0 ? coupon.maxDiscount : "");
    set("couponMinOrder", coupon.minOrder > 0 ? coupon.minOrder : "");
    set("couponUsageLimit", coupon.usageLimit > 0 ? coupon.usageLimit : "");
    set("couponStartsAt", coupon.startsAt);
    set("couponEndsAt", coupon.endsAt);
    const active = document.getElementById("couponActive");
    if (active) active.checked = coupon.active !== false;
  }

  if (couponTableBody) {
    couponTableBody.addEventListener("click", async (ev) => {
      const target = ev.target.closest("button");
      if (!target) return;
      const editCode = target.getAttribute("data-coupon-edit");
      const toggleCode = target.getAttribute("data-coupon-toggle");
      const deleteCode = target.getAttribute("data-coupon-delete");
      try {
        if (editCode) {
          const coupon = adminCoupons.find((item) => item.code === editCode);
          if (coupon) fillCouponForm(coupon);
          if (adminCouponForm) adminCouponForm.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (toggleCode) {
          await api("/api/admin/coupons/" + encodeURIComponent(toggleCode), {
            method: "PATCH",
            body: JSON.stringify({ active: target.getAttribute("data-active") !== "1" }),
          });
        }
        if (deleteCode) {
          if (!confirm(deleteCode + " kuponu silinsin mi?")) return;
          await api("/api/admin/coupons/" + encodeURIComponent(deleteCode), { method: "DELETE" });
        }
        await loadAdminCoupons();
        note(adminCouponNote, "", "");
      } catch (err) {
        note(adminCouponNote, "err", err.message || "İşlem yapılamadı");
      }
    });
  }

  if (adminCouponForm) {
    adminCouponForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const value = (id) => {
        const el = document.getElementById(id);
        return el ? String(el.value || "").trim() : "";
      };
      const activeEl = document.getElementById("couponActive");
      const submitBtn = adminCouponForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const saved = await api("/api/admin/coupons", {
          method: "POST",
          body: JSON.stringify({
            code: value("couponCode"),
            type: value("couponType"),
            value: Number(value("couponValue").replace(",", ".")) || 0,
            maxDiscount: Number(value("couponMaxDiscount").replace(",", ".")) || 0,
            minOrder: Number(value("couponMinOrder").replace(",", ".")) || 0,
            usageLimit: Number(value("couponUsageLimit")) || 0,
            startsAt: value("couponStartsAt"),
            endsAt: value("couponEndsAt"),
            active: Boolean(activeEl && activeEl.checked),
          }),
        });
        adminCouponForm.reset();
        await loadAdminCoupons();
        note(adminCouponNote, "ok", (saved && saved.coupon ? saved.coupon.code : "Kupon") + " kaydedildi.");
      } catch (err) {
        note(adminCouponNote, "err", err.message || "Kaydedilemedi");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  const adminReviewList = document.getElementById("adminReviewList");
  const adminReviewNote = document.getElementById("adminReviewNote");
  const reviewStatusFilter = document.getElementById("reviewStatusFilter");
  const reviewsNavCount = document.getElementById("reviewsNavCount");
  const REVIEW_STATUS_LABELS = { pending: "Onay bekliyor", approved: "Yayında", rejected: "Reddedildi" };

  function renderReviewCounts(counts) {
    if (!reviewsNavCount) return;
    const pending = Number(counts && counts.pending) || 0;
    reviewsNavCount.textContent = String(pending);
    reviewsNavCount.hidden = pending <= 0;
  }

  function renderAdminReviews(reviews) {
    if (!adminReviewList) return;
    if (!reviews.length) {
      adminReviewList.innerHTML = "<p class='admin-hint'>Bu filtrede yorum yok.</p>";
      return;
    }
    adminReviewList.innerHTML = reviews
      .map((review) => {
        const stars = "★★★★★".slice(0, review.rating) + "☆☆☆☆☆".slice(0, 5 - review.rating);
        const actions = [];
        if (review.status !== "approved") {
          actions.push("<button type='button' class='btn btn-primary btn-sm' data-review-approve='" + review.id + "'>Onayla</button>");
        }
        if (review.status !== "rejected") {
          actions.push("<button type='button' class='btn btn-outline btn-sm' data-review-reject='" + review.id + "'>Reddet</button>");
        }
        actions.push("<button type='button' class='btn btn-outline btn-sm' data-review-delete='" + review.id + "'>Sil</button>");
        return (
          "<article class='admin-review' data-review-id='" + review.id + "'>" +
          "<header class='admin-review-head'>" +
          "<strong>" + escapeHtml(review.productName || review.productId) + "</strong>" +
          "<span class='admin-review-status admin-review-status--" + escapeAttr(review.status) + "'>" +
          escapeHtml(REVIEW_STATUS_LABELS[review.status] || review.status) +
          "</span></header>" +
          "<p class='admin-review-meta'><span class='admin-review-stars' aria-label='" + review.rating + " / 5'>" + stars + "</span> · " +
          escapeHtml(review.author) + " · " + escapeHtml(formatOrderDate(review.createdAt)) +
          " · Sipariş " + escapeHtml(review.orderId) + "</p>" +
          (review.title ? "<p class='admin-review-title'>" + escapeHtml(review.title) + "</p>" : "") +
          "<p class='admin-review-body'>" + escapeHtml(review.body) + "</p>" +
          "<div class='admin-form-actions'>" + actions.join("") + "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  async function loadAdminReviews(withList) {
    if (!token) return;
    const status = reviewStatusFilter ? reviewStatusFilter.value : "pending";
    const data = await api("/api/admin/reviews" + (status ? "?status=" + encodeURIComponent(status) : ""));
    renderReviewCounts(data && data.counts);
    if (withList) renderAdminReviews((data && data.reviews) || []);
  }

  if (reviewStatusFilter) {
    reviewStatusFilter.addEventListener("change", () => {
      loadAdminReviews(true).catch((err) => note(adminReviewNote, "err", err.message || "Yorumlar yüklenemedi"));
    });
  }

  if (adminReviewList) {
    adminReviewList.addEventListener("click", async (ev) => {
      const target = ev.target.closest("button");
      if (!target) return;
      const approveId = target.getAttribute("data-review-approve");
      const rejectId = target.getAttribute("data-review-reject");
      const deleteId = target.getAttribute("data-review-delete");
      target.disabled = true;
      try {
        if (approveId || rejectId) {
          await api("/api/admin/reviews/" + encodeURIComponent(approveId || rejectId), {
            method: "PATCH",
            body: JSON.stringify({ status: approveId ? "approved" : "rejected" }),
          });
          note(adminReviewNote, "ok", approveId ? "Yorum yayına alındı." : "Yorum reddedildi.");
        } else if (deleteId) {
          if (!confirm("Yorum kalıcı olarak silinsin mi?")) {
            target.disabled = false;
            return;
          }
          await api("/api/admin/reviews/" + encodeURIComponent(deleteId), { method: "DELETE" });
          note(adminReviewNote, "ok", "Yorum silindi.");
        }
        await loadAdminReviews(true);
      } catch (err) {
        target.disabled = false;
        note(adminReviewNote, "err", err.message || "İşlem yapılamadı");
      }
    });
  }

  let categoryTree = [];
  const expandedCategorySlugs = new Set();
  const expandedMidKeys = new Set();
  const categoryTreeList = document.getElementById("categoryTreeList");
  const categoryTreeNote = document.getElementById("categoryTreeNote");
  const categoryForm = document.getElementById("categoryForm");
  const catEditKey = document.getElementById("catEditKey");
  const catParentSlug = document.getElementById("catParentSlug");
  const catName = document.getElementById("catName");
  const catSlug = document.getElementById("catSlug");
  const catActive = document.getElementById("catActive");
  const catDeleteBtn = document.getElementById("catDeleteBtn");
  const categoryFormTitle = document.getElementById("categoryFormTitle");

  function slugifyAdminCategory(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ş/g, "s")
      .replace(/ı/g, "i")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function resetCategoryForm() {
    if (!categoryForm) return;
    catEditKey.value = "";
    catParentSlug.disabled = false;
    catParentSlug.value = "";
    catName.value = "";
    catSlug.value = "";
    catSlug.readOnly = false;
    catActive.checked = true;
    catDeleteBtn.hidden = true;
    if (categoryFormTitle) categoryFormTitle.textContent = "Kategori ekle";
  }

  function fillCategoryParentOptions() {
    if (!catParentSlug) return;
    const current = catParentSlug.value;
    catParentSlug.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Ana kategori";
    catParentSlug.appendChild(empty);
    categoryTree.forEach((cat) => {
      const anaOpt = document.createElement("option");
      anaOpt.value = cat.slug;
      anaOpt.textContent = "ARA · " + cat.name;
      catParentSlug.appendChild(anaOpt);
      (cat.children || []).forEach((mid) => {
        const midOpt = document.createElement("option");
        midOpt.value = cat.slug + "/" + mid.slug;
        midOpt.textContent = "ALT · " + cat.name + " › " + mid.name;
        catParentSlug.appendChild(midOpt);
      });
    });
    catParentSlug.value = current;
  }

  function makePublishSwitch(checked, labelText, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "admin-switch";
    wrap.setAttribute("aria-label", labelText);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    const track = document.createElement("span");
    input.addEventListener("change", () => onChange(input));
    wrap.appendChild(input);
    wrap.appendChild(track);
    return wrap;
  }

  async function persistCategoryTree(next, message) {
    const data = await api("/api/admin/categories", {
      method: "PUT",
      body: JSON.stringify({ categories: next }),
    });
    categoryTree = Array.isArray(data.categories) ? data.categories : next;
    siteCategories = categoryTree;
    renderCategoryTree();
    notifySite();
    note(categoryTreeNote, "ok", message || "Kategori ağacı kaydedildi. Site menüsü güncellendi.");
    loadProductPool().catch(() => {});
  }

  function cloneCategoryTree(tree) {
    return JSON.parse(JSON.stringify(tree || []));
  }

  function moveCategoryItem(list, fromIndex, toIndex) {
    const next = list.slice();
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= next.length ||
      toIndex >= next.length
    ) {
      return null;
    }
    const moved = next.splice(fromIndex, 1)[0];
    next.splice(toIndex, 0, moved);
    return next;
  }

  function applyCategoryDrag(tree, from, to) {
    if (!from || !to || from.kind !== to.kind) return null;
    if (from.kind === "parent") {
      return moveCategoryItem(cloneCategoryTree(tree), from.index, to.index);
    }
    if (from.kind === "child" && from.parentIndex === to.parentIndex) {
      const next = cloneCategoryTree(tree);
      const parent = next[from.parentIndex];
      if (!parent) return null;
      const children = moveCategoryItem(parent.children, from.childIndex, to.childIndex);
      if (!children) return null;
      parent.children = children;
      return next;
    }
    if (
      from.kind === "grandchild" &&
      from.parentIndex === to.parentIndex &&
      from.childIndex === to.childIndex
    ) {
      const next = cloneCategoryTree(tree);
      const parent = next[from.parentIndex];
      const mid = parent && parent.children[from.childIndex];
      if (!mid) return null;
      const children = moveCategoryItem(mid.children || [], from.grandIndex, to.grandIndex);
      if (!children) return null;
      mid.children = children;
      return next;
    }
    return null;
  }

  async function dropCategory(from, to) {
    const next = applyCategoryDrag(categoryTree, from, to);
    if (!next) return;
    await persistCategoryTree(next, "Sıra kaydedildi. Site menüsü güncellendi.");
  }

  function createCategoryHandle(payload) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "admin-cat-handle";
    handle.draggable = true;
    handle.setAttribute("aria-label", "Sürükleyerek sırayı değiştir");
    handle.textContent = "⋮⋮";
    handle.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.effectAllowed = "move";
      const raw = JSON.stringify(payload);
      ev.dataTransfer.setData("text/plain", raw);
      const row = handle.closest("[data-cat-drop]");
      if (row) row.classList.add("is-dragging");
    });
    handle.addEventListener("dragend", () => {
      if (!categoryTreeList) return;
      categoryTreeList.querySelectorAll(".is-dragging, .is-drop-target").forEach((node) => {
        node.classList.remove("is-dragging");
        node.classList.remove("is-drop-target");
      });
    });
    return handle;
  }

  function bindCategoryDropTarget(el, toPayload) {
    el.setAttribute("data-cat-drop", toPayload.kind);
    el.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer.dropEffect = "move";
      el.classList.add("is-drop-target");
    });
    el.addEventListener("dragleave", (ev) => {
      if (!el.contains(ev.relatedTarget)) el.classList.remove("is-drop-target");
    });
    el.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      el.classList.remove("is-drop-target");
      let from = null;
      try {
        from = JSON.parse(ev.dataTransfer.getData("text/plain") || "null");
      } catch (_) {
        return;
      }
      try {
        await dropCategory(from, toPayload);
      } catch (err) {
        note(categoryTreeNote, "err", err.message);
      }
    });
  }

  function renderCategoryTree() {
    if (!categoryTreeList) return;
    categoryTreeList.textContent = "";
    fillCategoryParentOptions();
    if (!categoryTree.length) {
      const empty = document.createElement("p");
      empty.className = "admin-table-empty";
      empty.textContent = "Henüz kategori yok. Sağdaki formdan ana kategori ekleyin.";
      categoryTreeList.appendChild(empty);
      return;
    }
    categoryTree.forEach((parent, parentIndex) => {
      const card = document.createElement("article");
      const expanded = expandedCategorySlugs.has(parent.slug);
      card.className = "admin-cat-parent" + (expanded ? "" : " is-collapsed");
      bindCategoryDropTarget(card, { kind: "parent", index: parentIndex });
      const head = document.createElement("div");
      head.className = "admin-cat-row";
      const title = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = parent.name;
      const count = document.createElement("span");
      count.className = "admin-cat-count";
      count.textContent = (parent.children || []).length + " ara";
      strong.appendChild(count);
      const slug = document.createElement("span");
      slug.className = "admin-cat-slug";
      slug.textContent = parent.slug + (parent.active ? "" : " · taslak");
      title.appendChild(strong);
      title.appendChild(slug);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "admin-cat-toggle";
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.setAttribute("aria-label", parent.name + (expanded ? " altlarını gizle" : " altlarını göster"));
      toggle.textContent = "▸";
      toggle.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (expandedCategorySlugs.has(parent.slug)) expandedCategorySlugs.delete(parent.slug);
        else expandedCategorySlugs.add(parent.slug);
        renderCategoryTree();
      });
      const publish = makePublishSwitch(parent.active, parent.name + " yayın", async (input) => {
        const next = cloneCategoryTree(categoryTree);
        if (next[parentIndex]) next[parentIndex].active = input.checked;
        try {
          await persistCategoryTree(
            next,
            input.checked ? parent.name + " webde yayına alındı." : parent.name + " yayından kaldırıldı."
          );
        } catch (err) {
          input.checked = !input.checked;
          note(categoryTreeNote, "err", err.message);
        }
      });
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-ghost btn-xs";
      editBtn.textContent = "Düzenle";
      editBtn.addEventListener("click", () => {
        expandedCategorySlugs.add(parent.slug);
        catEditKey.value = parent.slug;
        catParentSlug.value = "";
        catParentSlug.disabled = true;
        catName.value = parent.name;
        catSlug.value = parent.slug;
        catSlug.readOnly = true;
        catActive.checked = parent.active !== false;
        catDeleteBtn.hidden = false;
        if (categoryFormTitle) categoryFormTitle.textContent = "Ana kategori düzenle";
        renderCategoryTree();
      });
      head.appendChild(createCategoryHandle({ kind: "parent", index: parentIndex }));
      head.appendChild(toggle);
      head.appendChild(title);
      head.appendChild(publish);
      head.appendChild(editBtn);
      card.appendChild(head);

      const children = document.createElement("div");
      children.className = "admin-cat-children";
      (parent.children || []).forEach((child, childIndex) => {
        const midKey = parent.slug + "/" + child.slug;
        const midExpanded = expandedMidKeys.has(midKey);
        const row = document.createElement("div");
        row.className = "admin-cat-row admin-cat-row-child" + (midExpanded ? "" : " is-mid-collapsed");
        bindCategoryDropTarget(row, {
          kind: "child",
          parentIndex: parentIndex,
          childIndex: childIndex,
        });
        const childTitle = document.createElement("div");
        const childName = document.createElement("strong");
        childName.textContent = child.name;
        const midCount = document.createElement("span");
        midCount.className = "admin-cat-count";
        midCount.textContent = (child.children || []).length + " alt";
        childName.appendChild(midCount);
        const childSlug = document.createElement("span");
        childSlug.className = "admin-cat-slug";
        childSlug.textContent = child.slug + (child.active ? "" : " · taslak");
        childTitle.appendChild(childName);
        childTitle.appendChild(childSlug);
        const midToggle = document.createElement("button");
        midToggle.type = "button";
        midToggle.className = "admin-cat-toggle";
        midToggle.setAttribute("aria-expanded", midExpanded ? "true" : "false");
        midToggle.textContent = "▸";
        midToggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (expandedMidKeys.has(midKey)) expandedMidKeys.delete(midKey);
          else expandedMidKeys.add(midKey);
          renderCategoryTree();
        });
        const childPublish = makePublishSwitch(child.active, child.name + " yayın", async (input) => {
          const next = cloneCategoryTree(categoryTree);
          if (next[parentIndex] && next[parentIndex].children[childIndex]) {
            next[parentIndex].children[childIndex].active = input.checked;
          }
          try {
            await persistCategoryTree(
              next,
              input.checked ? child.name + " webde yayına alındı." : child.name + " yayından kaldırıldı."
            );
          } catch (err) {
            input.checked = !input.checked;
            note(categoryTreeNote, "err", err.message);
          }
        });
        const childEdit = document.createElement("button");
        childEdit.type = "button";
        childEdit.className = "btn btn-ghost btn-xs";
        childEdit.textContent = "Düzenle";
        childEdit.addEventListener("click", () => {
          expandedCategorySlugs.add(parent.slug);
          catEditKey.value = parent.slug + "/" + child.slug;
          catParentSlug.value = parent.slug;
          catParentSlug.disabled = true;
          catName.value = child.name;
          catSlug.value = child.slug;
          catSlug.readOnly = true;
          catActive.checked = child.active !== false;
          catDeleteBtn.hidden = false;
          if (categoryFormTitle) categoryFormTitle.textContent = "Ara kategori düzenle";
        });
        row.appendChild(
          createCategoryHandle({
            kind: "child",
            parentIndex: parentIndex,
            childIndex: childIndex,
          })
        );
        row.appendChild(midToggle);
        row.appendChild(childTitle);
        row.appendChild(childPublish);
        row.appendChild(childEdit);
        children.appendChild(row);

        const leavesWrap = document.createElement("div");
        leavesWrap.className = "admin-cat-leaves" + (midExpanded ? "" : " is-collapsed");
        (child.children || []).forEach((leaf, grandIndex) => {
          const leafRow = document.createElement("div");
          leafRow.className = "admin-cat-row admin-cat-row-leaf";
          bindCategoryDropTarget(leafRow, {
            kind: "grandchild",
            parentIndex: parentIndex,
            childIndex: childIndex,
            grandIndex: grandIndex,
          });
          const leafTitle = document.createElement("div");
          const leafName = document.createElement("strong");
          leafName.textContent = leaf.name;
          const leafSlug = document.createElement("span");
          leafSlug.className = "admin-cat-slug";
          leafSlug.textContent = leaf.slug + (leaf.active ? "" : " · taslak");
          leafTitle.appendChild(leafName);
          leafTitle.appendChild(leafSlug);
          const leafPublish = makePublishSwitch(leaf.active, leaf.name + " yayın", async (input) => {
            const next = cloneCategoryTree(categoryTree);
            const target =
              next[parentIndex] &&
              next[parentIndex].children[childIndex] &&
              next[parentIndex].children[childIndex].children[grandIndex];
            if (target) target.active = input.checked;
            try {
              await persistCategoryTree(
                next,
                input.checked ? leaf.name + " webde yayına alındı." : leaf.name + " yayından kaldırıldı."
              );
            } catch (err) {
              input.checked = !input.checked;
              note(categoryTreeNote, "err", err.message);
            }
          });
          const leafEdit = document.createElement("button");
          leafEdit.type = "button";
          leafEdit.className = "btn btn-ghost btn-xs";
          leafEdit.textContent = "Düzenle";
          leafEdit.addEventListener("click", () => {
            expandedCategorySlugs.add(parent.slug);
            expandedMidKeys.add(midKey);
            catEditKey.value = parent.slug + "/" + child.slug + "/" + leaf.slug;
            catParentSlug.value = parent.slug + "/" + child.slug;
            catParentSlug.disabled = true;
            catName.value = leaf.name;
            catSlug.value = leaf.slug;
            catSlug.readOnly = true;
            catActive.checked = leaf.active !== false;
            catDeleteBtn.hidden = false;
            if (categoryFormTitle) categoryFormTitle.textContent = "Alt kategori düzenle";
          });
          leafRow.appendChild(
            createCategoryHandle({
              kind: "grandchild",
              parentIndex: parentIndex,
              childIndex: childIndex,
              grandIndex: grandIndex,
            })
          );
          leafRow.appendChild(leafTitle);
          leafRow.appendChild(leafPublish);
          leafRow.appendChild(leafEdit);
          leavesWrap.appendChild(leafRow);
        });
        const addLeaf = document.createElement("button");
        addLeaf.type = "button";
        addLeaf.className = "btn btn-outline btn-xs";
        addLeaf.textContent = "+ Alt kategori";
        addLeaf.addEventListener("click", () => {
          expandedCategorySlugs.add(parent.slug);
          expandedMidKeys.add(midKey);
          resetCategoryForm();
          catParentSlug.value = parent.slug + "/" + child.slug;
          catParentSlug.disabled = false;
          if (categoryFormTitle) categoryFormTitle.textContent = "Alt kategori ekle";
          if (catName) catName.focus();
          renderCategoryTree();
        });
        leavesWrap.appendChild(addLeaf);
        children.appendChild(leavesWrap);
      });
      const addChild = document.createElement("button");
      addChild.type = "button";
      addChild.className = "btn btn-outline btn-xs";
      addChild.textContent = "+ Ara kategori";
      addChild.addEventListener("click", () => {
        expandedCategorySlugs.add(parent.slug);
        resetCategoryForm();
        catParentSlug.value = parent.slug;
        catParentSlug.disabled = false;
        if (categoryFormTitle) categoryFormTitle.textContent = "Ara kategori ekle";
        if (catName) catName.focus();
        renderCategoryTree();
      });
      children.appendChild(addChild);
      card.appendChild(children);
      categoryTreeList.appendChild(card);
    });
  }

  async function loadCategoryTree() {
    if (!categoryTreeList) return;
    const data = await api("/api/admin/categories");
    categoryTree = Array.isArray(data.categories) ? data.categories : [];
    siteCategories = categoryTree;
    renderCategoryTree();
    loadProductPool().catch(() => {});
  }

  const catExpandAllBtn = document.getElementById("catExpandAllBtn");
  const catCollapseAllBtn = document.getElementById("catCollapseAllBtn");
  if (catExpandAllBtn) {
    catExpandAllBtn.addEventListener("click", () => {
      categoryTree.forEach((parent) => {
        expandedCategorySlugs.add(parent.slug);
        (parent.children || []).forEach((child) => expandedMidKeys.add(parent.slug + "/" + child.slug));
      });
      renderCategoryTree();
    });
  }
  if (catCollapseAllBtn) {
    catCollapseAllBtn.addEventListener("click", () => {
      expandedCategorySlugs.clear();
      expandedMidKeys.clear();
      renderCategoryTree();
    });
  }

  if (catName && catSlug) {
    catName.addEventListener("input", () => {
      if (catEditKey.value) return;
      if (catSlug.dataset.manual === "1") return;
      catSlug.value = slugifyAdminCategory(catName.value);
    });
    catSlug.addEventListener("input", () => {
      catSlug.dataset.manual = catSlug.value.trim() ? "1" : "";
    });
  }

  if (categoryForm) {
    categoryForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = catName.value.trim();
      const slug = catEditKey.value
        ? ""
        : slugifyAdminCategory(catSlug.value || catName.value);
      const active = catActive.checked;
      const parentSlug = catParentSlug.value;
      const editKey = catEditKey.value;
      const next = cloneCategoryTree(categoryTree);
      try {
        if (editKey && !editKey.includes("/")) {
          const index = next.findIndex((row) => row.slug === editKey);
          if (index < 0) throw new Error("Ana kategori bulunamadı.");
          next[index] = Object.assign({}, next[index], { name, active });
        } else if (editKey.split("/").length === 2) {
          const parts = editKey.split("/");
          const parent = next.find((row) => row.slug === parts[0]);
          if (!parent) throw new Error("Ana kategori bulunamadı.");
          const childIndex = parent.children.findIndex((row) => row.slug === parts[1]);
          if (childIndex < 0) throw new Error("Ara kategori bulunamadı.");
          parent.children[childIndex] = Object.assign({}, parent.children[childIndex], {
            name,
            active,
          });
        } else if (editKey.split("/").length === 3) {
          const parts = editKey.split("/");
          const parent = next.find((row) => row.slug === parts[0]);
          const mid = parent && parent.children.find((row) => row.slug === parts[1]);
          if (!mid) throw new Error("Ara kategori bulunamadı.");
          const leafIndex = (mid.children || []).findIndex((row) => row.slug === parts[2]);
          if (leafIndex < 0) throw new Error("Alt kategori bulunamadı.");
          mid.children[leafIndex] = Object.assign({}, mid.children[leafIndex], { name, active });
        } else if (parentSlug.includes("/")) {
          const parts = parentSlug.split("/");
          const parent = next.find((row) => row.slug === parts[0]);
          const mid = parent && parent.children.find((row) => row.slug === parts[1]);
          if (!mid) throw new Error("Ara kategori seçin.");
          if (!Array.isArray(mid.children)) mid.children = [];
          mid.children.push({ name, slug, active, children: [] });
        } else if (parentSlug) {
          const parent = next.find((row) => row.slug === parentSlug);
          if (!parent) throw new Error("Ana kategori seçin.");
          parent.children.push({ name, slug, active, children: [] });
        } else {
          next.push({ name, slug, active, children: [] });
        }
        await persistCategoryTree(next, "Kategori adı kaydedildi. XML ürünleri aynı koda bağlanmaya devam eder.");
        resetCategoryForm();
        catSlug.dataset.manual = "";
      } catch (err) {
        note(categoryTreeNote, "err", err.message);
      }
    });
  }

  if (document.getElementById("catResetBtn")) {
    document.getElementById("catResetBtn").addEventListener("click", () => {
      resetCategoryForm();
      catSlug.dataset.manual = "";
      note(categoryTreeNote, "", "");
    });
  }

  if (catDeleteBtn) {
    catDeleteBtn.addEventListener("click", async () => {
      const editKey = catEditKey.value;
      if (!editKey) return;
      if (!confirm("Bu kategoriyi silmek istiyor musunuz?")) return;
      let next = cloneCategoryTree(categoryTree);
      try {
        const parts = editKey.split("/");
        if (parts.length === 3) {
          const parent = next.find((row) => row.slug === parts[0]);
          const mid = parent && parent.children.find((row) => row.slug === parts[1]);
          if (mid) mid.children = (mid.children || []).filter((leaf) => leaf.slug !== parts[2]);
        } else if (parts.length === 2) {
          next = next.map((row) => {
            if (row.slug !== parts[0]) return row;
            return Object.assign({}, row, {
              children: row.children.filter((child) => child.slug !== parts[1]),
            });
          });
        } else {
          next = next.filter((row) => row.slug !== editKey);
        }
        await persistCategoryTree(next, "Kategori silindi.");
        resetCategoryForm();
      } catch (err) {
        note(categoryTreeNote, "err", err.message);
      }
    });
  }

  let productPoolPage = 1;
  let productPoolQuery = "";

  function xmlCategoryLabel(item) {
    return [item.xmlMainCategory || item.mainCategory, item.xmlMidCategory || item.midCategory, item.xmlSubCategory || item.subCategory]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" › ") || "—";
  }

  function renderProductPoolPager(totalPages) {
    const pager = document.getElementById("productPoolPager");
    if (!pager) return;
    pager.textContent = "";
    if (totalPages <= 1) {
      pager.hidden = true;
      return;
    }
    pager.hidden = false;
    const addBtn = (label, page, options) => {
      const opts = options || {};
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (opts.current) btn.className = "is-current";
      btn.disabled = !!opts.disabled;
      btn.addEventListener("click", () => {
        productPoolPage = page;
        loadProductPool().catch((err) => note(document.getElementById("productPoolNote"), "err", err.message));
      });
      pager.appendChild(btn);
    };
    addBtn("‹", productPoolPage - 1, { disabled: productPoolPage <= 1 });
    addBtn(String(productPoolPage), productPoolPage, { current: true, disabled: true });
    addBtn("›", productPoolPage + 1, { disabled: productPoolPage >= totalPages });
  }

  function renderProductPoolRow(item) {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    const strong = document.createElement("strong");
    strong.textContent = item.name || item.supplierSku;
    const meta = document.createElement("span");
    meta.className = "admin-cat-slug";
    meta.textContent = [item.brand, item.supplierSku].filter(Boolean).join(" · ");
    nameCell.appendChild(strong);
    nameCell.appendChild(meta);

    const stockCell = document.createElement("td");
    stockCell.textContent = item.stockQty == null ? "—" : String(item.stockQty);

    const xmlCell = document.createElement("td");
    xmlCell.textContent = xmlCategoryLabel(item);

    const catCell = document.createElement("td");
    const catWrap = document.createElement("div");
    catWrap.className = "admin-cat-selects";
    const parentSelect = document.createElement("select");
    const midSelect = document.createElement("select");
    const childSelect = document.createElement("select");
    fillSiteParentSelect(parentSelect, item.siteParent || "");
    fillSiteMidSelect(midSelect, item.siteParent || "", item.siteMid || "");
    fillSiteChildSelect(childSelect, item.siteParent || "", item.siteMid || "", item.siteChild || "");
    parentSelect.addEventListener("change", () => {
      fillSiteMidSelect(midSelect, parentSelect.value, "");
      fillSiteChildSelect(childSelect, parentSelect.value, "", "");
    });
    midSelect.addEventListener("change", () => {
      fillSiteChildSelect(childSelect, parentSelect.value, midSelect.value, "");
    });
    catWrap.appendChild(parentSelect);
    catWrap.appendChild(midSelect);
    catWrap.appendChild(childSelect);
    catCell.appendChild(catWrap);

    const actionCell = document.createElement("td");
    const publishBtn = document.createElement("button");
    publishBtn.type = "button";
    publishBtn.className = "btn btn-primary btn-xs";
    publishBtn.textContent = "Yayına al";
    publishBtn.addEventListener("click", async () => {
      const parentSlug = parentSelect.value;
      const midSlug = midSelect.value;
      const childSlug = childSelect.value;
      if (!parentSlug || !midSlug || !childSlug) {
        note(document.getElementById("productPoolNote"), "err", "ANA, ARA ve ALT kategori seçin.");
        return;
      }
      publishBtn.disabled = true;
      try {
        await updateSupplierProducts([
          {
            supplierSku: item.supplierSku,
            supplierSlot: item.supplierSlot,
            siteParent: parentSlug,
            siteMid: midSlug,
            siteChild: childSlug,
            active: true,
          },
        ]);
        notifySite();
        note(document.getElementById("productPoolNote"), "ok", item.name + " yayına alındı.");
        await loadProductPool();
      } catch (err) {
        note(document.getElementById("productPoolNote"), "err", err.message);
        publishBtn.disabled = false;
      }
    });
    actionCell.appendChild(publishBtn);

    [nameCell, stockCell, xmlCell, catCell, actionCell].forEach((cell) => tr.appendChild(cell));
    return tr;
  }

  async function loadProductPool() {
    const body = document.getElementById("productPoolBody");
    const poolNote = document.getElementById("productPoolNote");
    if (!body) return;
    const qs = new URLSearchParams({
      status: "pool",
      q: productPoolQuery,
      page: String(productPoolPage || 1),
      limit: "50",
    });
    productPoolSort.apply(qs);
    const data = await api("/api/admin/supplier/products?" + qs.toString());
    const rows = Array.isArray(data.products) ? data.products : [];
    body.textContent = "";
    if (!rows.length) {
      const empty = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "admin-table-empty";
      cell.textContent = "Stoklu ve yayında olmayan ürün yok.";
      empty.appendChild(cell);
      body.appendChild(empty);
    } else {
      rows.forEach((item) => body.appendChild(renderProductPoolRow(item)));
    }
    const total = Number(data.total) || 0;
    const totalPages = Math.max(1, Number(data.totalPages) || 1);
    productPoolPage = Math.min(totalPages, Number(data.page) || 1);
    renderProductPoolPager(totalPages);
    if (poolNote && poolNote.className.indexOf("err") < 0) {
      note(poolNote, "", total ? total + " stoklu ürün sitede yayında değil." : "");
    }
  }

  const productPoolSearch = document.getElementById("productPoolSearch");
  if (productPoolSearch) {
    let poolSearchTimer = null;
    productPoolSearch.addEventListener("input", () => {
      clearTimeout(poolSearchTimer);
      poolSearchTimer = setTimeout(() => {
        productPoolQuery = productPoolSearch.value.trim();
        productPoolPage = 1;
        loadProductPool().catch((err) => note(document.getElementById("productPoolNote"), "err", err.message));
      }, 280);
    });
  }

  if (token) {
    bootAuthedWorkspace();
  }
})();
