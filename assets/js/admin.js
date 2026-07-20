(function () {
  "use strict";

  const TOKEN_KEY = "patygo_admin_token";
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let products = [];
  let selectedIndex = -1;
  let currentImages = [];
  let supplierProducts = [];
  let supplierSlots = [];
  let feedStatus = null;
  const selectedSupplierSkus = new Set();

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
  const productSearch = document.getElementById("productSearch");
  const productCategoryFilter = document.getElementById("productCategoryFilter");
  const productStatusFilter = document.getElementById("productStatusFilter");
  const supplierRows = document.getElementById("supplierProductRows");
  const supplierSearch = document.getElementById("supplierSearch");
  const supplierStatusFilter = document.getElementById("supplierStatusFilter");
  const supplierSlotFilter = document.getElementById("supplierSlotFilter");

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
      throw new Error("Paneli file:// ile açmayın. https://patygoteknoloji.com/admin veya yerel sunucu /admin kullanın.");
    }
    const opts = options || {};
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(),
      Number(opts.timeout) || (path.includes("/supplier/refresh") ? 45000 : 12000)
    );
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
        throw new Error("API'ye ulaşılamadı. Sunucu çalışıyor mu? Adres: /admin");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function showPanel(on) {
    loginView.hidden = !!on;
    panelView.hidden = !on;
    loginView.classList.toggle("is-hidden", !!on);
    panelView.classList.toggle("is-hidden", !on);
    document.body.classList.toggle("admin-authed", !!on);
  }

  function selectAdminTab(name, focus) {
    const tabs = Array.from(document.querySelectorAll("[data-admin-tab]"));
    const pageMeta = {
      overview: ["Genel Bakış", "Katalog ve yayın durumunu tek ekrandan yönetin."],
      products: ["Ürünler", "Manuel ürün kataloğunu düzenleyin."],
      xml: ["XML Yönetimi", "Tedarikçi ürünlerini ve Akakçe yayınını yönetin."],
    };
    tabs.forEach((tab) => {
      const selected = tab.dataset.adminTab === name;
      tab.classList.toggle("active", selected);
      if (selected) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
      if (selected && focus) tab.focus();
    });
    const meta = pageMeta[name] || pageMeta.overview;
    document.getElementById("adminPageTitle").textContent = meta[0];
    document.getElementById("adminPageSubtitle").textContent = meta[1];
    if (name === "xml" && token) loadSupplierData().catch(() => {});
    try {
      sessionStorage.setItem("patygo_admin_tab", name);
    } catch (_) {}
  }

  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    tab.addEventListener("click", () => selectAdminTab(tab.dataset.adminTab, false));
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
    if (["overview", "products", "xml"].includes(saved)) initialAdminTab = saved;
  } catch (_) {}
  selectAdminTab(initialAdminTab, false);

  function selectProductsView(name, focus) {
    document.querySelectorAll("[data-products-view]").forEach((tab) => {
      const selected = tab.dataset.productsView === name;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
      if (selected && focus) tab.focus();
    });
    document.getElementById("newProductBtn").hidden = name !== "manual";
    if (name === "xml") renderSupplierProducts();
    try {
      sessionStorage.setItem("patygo_products_view", name);
    } catch (_) {}
  }

  document.querySelectorAll("[data-products-view]").forEach((tab) => {
    tab.addEventListener("click", () => selectProductsView(tab.dataset.productsView, false));
    tab.addEventListener("keydown", (ev) => {
      if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      ev.preventDefault();
      selectProductsView(tab.dataset.productsView === "manual" ? "xml" : "manual", true);
    });
  });
  let initialProductsView = "manual";
  try {
    if (sessionStorage.getItem("patygo_products_view") === "xml") {
      initialProductsView = "xml";
    }
  } catch (_) {}
  selectProductsView(initialProductsView, false);

  function renderImagePreviews() {
    imagePreview.textContent = "";
    imagePreview.hidden = currentImages.length === 0;
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
    currentImages = [];
    fields.imageFile.value = "";
    fields.featured.checked = true;
    fields.active.checked = true;
    imagePreview.hidden = true;
    renderImagePreviews();
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
    currentImages = Array.isArray(p.images)
      ? p.images.filter(Boolean).slice(0, 10)
      : p.image
        ? [p.image]
        : [];
    fields.featured.checked = !!p.featured;
    fields.active.checked = p.active !== false;
    formTitle.textContent = "Ürünü düzenle";
    renderImagePreviews();
    note(formNote, "", "");
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
        " +KDV · " +
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
              formNote,
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
          note(formNote, "err", err.message || "Durum güncellenemedi.");
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
      document.getElementById("feedSourceCounts").textContent =
        String(feedStatus.supplierActiveCount || 0) +
        " / " +
        String(feedStatus.manualActiveCount || 0);
      const feedBadge = document.getElementById("feedStatusBadge");
      feedBadge.className =
        "admin-status " + (feedStatus.activeCount > 0 ? "on" : "pending");
      feedBadge.textContent =
        feedStatus.activeCount > 0 ? "Feed hazır" : "Uygun ürün yok";
      const warnings = document.getElementById("feedWarnings");
      warnings.textContent = "";
      warnings.hidden = !(feedStatus.excludedCount > 0);
      if (feedStatus.excludedCount > 0) {
        const summary = document.createElement("strong");
        summary.textContent =
          feedStatus.excludedCount + " aktif ürün feed’e alınmadı.";
        warnings.appendChild(summary);
        const list = document.createElement("ul");
        (feedStatus.issues || []).slice(0, 3).forEach((issue) => {
          const item = document.createElement("li");
          item.textContent = issue.name + ": " + issue.reasons.join(", ");
          list.appendChild(item);
        });
        warnings.appendChild(list);
      }
    }
    const absoluteFeedUrl = location.origin + "/api/feeds/akakce.xml";
    document.getElementById("feedUrl").textContent = absoluteFeedUrl;
    document.getElementById("feedOpenBtn").href = absoluteFeedUrl;
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
    const data = await api("/api/admin/products", {
      method: "PUT",
      body: JSON.stringify({ products: list }),
    });
    products = data.products || list;
    renderList();
    notifySite();
    note(
      formNote,
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
          timeout: 45000,
        });
        selectedSupplierSkus.clear();
        await loadSupplierData();
        notifySite();
        const count = supplierProducts.filter((item) => item.supplierSlot === slotId).length;
        note(statusNote, "ok", count + " ürün bu XML kaynağından güncellendi.");
      } catch (err) {
        await loadSupplierData().catch(() => {});
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

  document.getElementById("feedCopyBtn").addEventListener("click", async () => {
    const url = location.origin + "/api/feeds/akakce.xml";
    try {
      await navigator.clipboard.writeText(url);
      note(document.getElementById("feedNote"), "ok", "Akakçe XML bağlantısı kopyalandı.");
    } catch (_) {
      note(document.getElementById("feedNote"), "err", "Bağlantı kopyalanamadı: " + url);
    }
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
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: document.getElementById("password").value }),
      });
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      showPanel(true);
      await Promise.all([refresh(), loadSupplierData()]);
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
    selectAdminTab("products", false);
    selectProductsView("manual", false);
    emptyForm();
    renderList();
    fields.name.focus();
  });

  fields.imageFile.addEventListener("change", async () => {
    const files = Array.from(fields.imageFile.files || []).slice(
      0,
      Math.max(0, 10 - currentImages.length)
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
        currentImages.push(uploaded.url);
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
    const item = {
      id: fields.id.value.trim(),
      brand: fields.brand.value.trim(),
      name: fields.name.value.trim(),
      price: Number(fields.price.value),
      category: fields.category.value,
      description: fields.description.value.trim(),
      details: fields.details.value.trim(),
      image: currentImages[0] || "",
      images: currentImages.slice(0, 10),
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
    Promise.all([refresh(), loadSupplierData()]).catch(() => {
      token = "";
      sessionStorage.removeItem(TOKEN_KEY);
      showPanel(false);
    });
  }
})();
