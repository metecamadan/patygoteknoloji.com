const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const script = fs.readFileSync(path.join(root, "assets", "js", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "admin.css"), "utf8");

test("admin markup has unique element IDs", () => {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test("products tab separates manual and XML product areas", () => {
  assert.match(html, /id="manualProductsView"/);
  assert.match(html, /id="xmlProductsView"/);
  assert.match(html, /id="productsNavChildren"/);
  assert.match(html, /id="manualProductsNav"/);
  assert.match(html, /id="xmlProductsNav"/);
  assert.doesNotMatch(html, /id="productsPageTitle"|id="productsPageSubtitle"/);
  assert.doesNotMatch(html, /admin-subtabs|manualProductsSubtab|xmlProductsSubtab/);
  assert.match(script, /selectProductsView/);
  assert.match(script, /productsNavChildren/);
  assert.match(script, /\.admin-nav > \[data-admin-tab\]/);
  assert.doesNotMatch(script, /\.admin-subtabs/);
});

test("manual product form opens in a modal over full-width catalog", () => {
  assert.match(html, /id="productFormModal"/);
  assert.match(html, /class="admin-layout admin-layout--catalog"/);
  assert.match(html, /admin-page--flush/);
  assert.match(html, /id="productForm"/);
  assert.match(html, /id="newProductBtn"/);
  assert.match(html, /admin-product-toolbar[\s\S]*?id="newProductBtn"/);
  const topActions = html.match(/class="admin-top-actions"[\s\S]*?<\/div>/);
  assert.ok(topActions);
  assert.doesNotMatch(topActions[0], /id="newProductBtn"/);
  assert.match(css, /\.admin-modal/);
  assert.match(css, /\.admin-layout--catalog/);
  assert.match(script, /openProductModal/);
  assert.match(script, /closeProductModal/);
  assert.match(script, /newProductBtn[\s\S]*openProductModal/);
});

test("admin calendar tab supports reminders and notes", () => {
  assert.match(html, /id="calendarTab"/);
  assert.match(html, /id="adminTabCalendar"/);
  assert.match(html, /id="calendarGrid"/);
  assert.match(html, /id="calendarEntryForm"/);
  assert.match(html, /id="calendarEntryType"/);
  assert.match(html, /value="reminder"/);
  assert.match(html, /value="note"/);
  assert.match(css, /\.admin-calendar-shell/);
  assert.match(css, /\.admin-calendar-grid/);
  assert.match(script, /loadCalendarMonth/);
  assert.match(script, /\/api\/admin\/calendar/);
  assert.match(script, /"calendar"/);
  assert.match(html, /id="calendarNotifyPermissionBtn"/);
  assert.match(html, /data-smtp-mail-help/);
  assert.doesNotMatch(html, /e-posta gider/);
  assert.match(script, /checkBrowserCalendarReminders/);
  assert.match(script, /Notification\.requestPermission|ensureCalendarNotificationPermission/);
});

test("admin categories tab manages the site category tree", () => {
  assert.match(html, /id="categoriesTab"/);
  assert.match(html, /id="adminTabCategories"/);
  assert.match(html, /id="categoryTreeList"/);
  assert.match(html, /id="categoryForm"/);
  assert.match(html, /id="catActive"/);
  assert.match(css, /\.admin-cat-tree/);
  assert.match(script, /loadCategoryTree/);
  assert.match(script, /\/api\/admin\/categories/);
  assert.match(script, /yayına alındı/);
  assert.match(script, /applyCategoryDrag/);
  assert.match(script, /createCategoryHandle/);
  assert.match(script, /bindCategoryDropTarget/);
  assert.match(script, /notifySite/);
  assert.match(css, /\.admin-cat-handle/);
  assert.match(html, /id="catExpandAllBtn"/);
  assert.match(html, /id="catCollapseAllBtn"/);
  assert.match(css, /\.admin-cat-parent\.is-collapsed/);
  assert.match(script, /expandedCategorySlugs/);
  assert.match(script, /catSlug\.readOnly/);
  assert.match(html, /id="productPoolBody"/);
  assert.match(html, /Ürün havuzu/);
  assert.match(script, /status=pool|status: "pool"/);
  assert.match(script, /Yayına al/);
});

test("admin panel exposes dark theme toggle in the top bar", () => {
  assert.match(html, /id="adminThemeToggle"/);
  assert.match(html, /admin-theme-toggle/);
  assert.match(html, /patygo_admin_theme/);
  assert.match(css, /html\.admin-theme-dark/);
  assert.match(css, /\.admin-theme-toggle/);
  assert.match(script, /THEME_KEY/);
  assert.match(script, /applyAdminTheme/);
  assert.match(script, /adminThemeToggle/);
});

test("admin ops health badge is hidden until XML or POS reports a real issue", () => {
  assert.match(html, /id="adminOpsHealth"/);
  assert.doesNotMatch(html, /Sistem hazır/);
  assert.match(script, /function renderOpsHealth/);
  assert.match(script, /data\.opsHealth/);
  assert.doesNotMatch(script, /Sistem hazır/);
  assert.match(css, /\.admin-health\.is-err/);
  assert.match(css, /\.admin-health\.is-warn/);
  assert.doesNotMatch(css, /background:\s*#22c55e/);
});

test("admin overview uses consistent full-width grid spacing", () => {
  assert.match(html, /admin-page--overview/);
  assert.doesNotMatch(html, /admin-overview-grid-2" style="margin-top/);
  assert.doesNotMatch(html, /admin-kpis" style="margin-top/);
  assert.doesNotMatch(html, /admin-akakce-card" style="margin-top/);
  assert.match(css, /\.admin-page--overview/);
  assert.match(css, /\.admin-overview-grid-3\s*\{[\s\S]*?repeat\(3,/);
  assert.match(css, /\.admin-overview-grid\s*>\s*\.admin-card/);
});

test("admin XML schedule is locked to five Istanbul pull times", () => {
  assert.match(html, /08:00, 11:00, 16:00, 21:00, 23:30/);
  assert.match(html, /Saatler kilitlidir/);
  assert.doesNotMatch(html, /data-slot-input="scheduleStart"/);
  assert.doesNotMatch(html, /data-slot-input="scheduleInterval"/);
  assert.match(html, /Otomatik XML okuma/);
  assert.doesNotMatch(script, /scheduleIntervalMinutes/);
  assert.doesNotMatch(html, /07:00’da başlar, günde 10 kez/);
  assert.doesNotMatch(html, /Avansas/i);
  assert.doesNotMatch(html, /Agent Ops/i);
  assert.doesNotMatch(html, /Yayına almayın/);
  assert.doesNotMatch(html, /cdnsta\.avansas\.com/);
  assert.match(html, /id="supplierPoolPager"/);
  assert.match(html, /Stok \(son XML\)/);
  assert.match(html, /Site kategorisi/);
  assert.match(script, /Son XML okumasındaki stok adedi/);
  assert.match(html, /value="nocat"/);
  assert.match(script, /POOL_PAGE_SIZE/);
  assert.match(script, /siteCategoryAssigned/);
  assert.match(html, /supplier-publish-btn/);
  assert.match(script, /\/api\/admin\/supplier\/publish/);
  assert.match(script, /Site kategorisi seçilmeden ürün yayına alınamaz/);
  assert.doesNotMatch(script, /POOL_RENDER_LIMIT/);
});

test("admin exposes three XML connections and source-specific margins", () => {
  assert.equal((html.match(/data-supplier-card="supplier-/g) || []).length, 3);
  assert.match(html, /id="supplierSlotFilter"/);
  assert.match(html, /Özel kâr %/);
  assert.match(script, /marginPercent:\s*marginInput\.value/);
  assert.match(script, /supplierSlot:\s*item\.supplierSlot/);
});

test("admin overview exposes digital dashboard metrics", () => {
  assert.match(html, /id="dashFrom"/);
  assert.match(html, /id="dashTo"/);
  assert.match(html, /id="dashApplyPeriod"/);
  assert.match(html, /id="dashLeads"/);
  assert.match(html, /id="dashRevenue"/);
  assert.match(html, /id="dashAov"/);
  assert.match(html, /id="dashPos"/);
  assert.match(html, /id="dashSmtp"/);
  assert.doesNotMatch(html, /id="dashServerStatus"/);
  assert.doesNotMatch(script, /API yanıt verdi/);
  assert.match(script, /\/api\/admin\/dashboard/);
  assert.match(script, /loadDigitalDashboard/);
  assert.match(html, /id="dashTopViewed"/);
  assert.match(html, /id="dashTopPurchased"/);
  assert.match(script, /topViewedProducts/);
  assert.match(script, /topPurchasedProducts/);
});

test("admin login does not block on supplier catalog or dashboard merge", () => {
  assert.match(script, /function bootAuthedWorkspace/);
  assert.match(script, /bootAuthedWorkspace\(\)/);
  assert.match(script, /ensureManualProducts/);
  assert.doesNotMatch(
    script,
    /await Promise\.all\(\[\s*refresh\(\),\s*loadSupplierData/
  );
  assert.match(script, /if \(xmlView\) \{\s*loadSupplierData/s);
  assert.doesNotMatch(script, /refresh\(\)\.catch\(\(\) => \{\}\);/);
});

test("admin Akakçe feed shows exclusion diagnostics and public URL", () => {
  assert.match(html, /id="feedCatalogActiveCount"/);
  assert.match(html, /id="feedWarnings"/);
  assert.match(html, /id="dashboardFeedUrl"/);
  assert.match(html, /id="dashboardFeedCopyBtn"/);
  assert.match(html, /Akakçe’ye verilecek canlı XML linki/);
  assert.match(html, /https:\/\/patygoteknoloji\.com\/api\/feeds\/akakce\.xml/);
  assert.match(script, /reasonCounts/);
  assert.match(script, /publicUrl/);
  assert.match(script, /syncFeedUrlUi/);
  assert.match(script, /copyFeedUrl/);
  assert.match(script, /Katalogda feed/);
});

test("admin brand opens the public site in a new tab", () => {
  assert.match(
    html,
    /href="\/" class="admin-sidebar-brand" target="_blank" rel="noopener"/
  );
  assert.match(
    html,
    /id="loginBrandLink" href="\/" class="admin-login-brand" target="_blank" rel="noopener"/
  );
  assert.match(html, /href="\/" target="_blank" rel="noopener">Siteyi görüntüle/);
  assert.doesNotMatch(html, /href="[^"]*\.html"/);
});

test("admin ends session after 30 minutes of inactivity", () => {
  assert.match(script, /IDLE_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(script, /function endSession/);
  assert.match(script, /idleTimer/);
  assert.match(script, /mousemove/);
  assert.match(script, /keydown/);
  assert.match(script, /pointerdown/);
  assert.match(script, /touchstart/);
  assert.match(script, /30 dakika/);
});

test("admin login form does not POST onto static /admin HTML", () => {
  assert.match(html, /id="loginForm"[^>]*action="\/api\/admin\/login"/);
  assert.doesNotMatch(html, /id="loginForm"[^>]*action="#"/);
  assert.match(html, /loginForm"\)\.addEventListener\("submit"/);
});


test("admin shipping tab exposes threshold and fee settings", () => {
  assert.match(html, /id="shippingTab"/);
  assert.match(html, /id="adminTabShipping"/);
  assert.match(html, /id="adminShippingForm"/);
  assert.match(html, /id="adminShippingForm"[^>]*action="#"/);
  assert.match(html, /id="shippingFreeThreshold"/);
  assert.match(html, /id="shippingFeeAmount"/);
  assert.match(html, /id="shippingSettingsView"/);
  assert.match(html, /id="shippingEditBtn"/);
  assert.match(script, /loadAdminShippingSettings/);
  assert.match(script, /renderShippingSummary/);
  assert.match(script, /shipPrice/);
  assert.match(script, /\/api\/admin\/shipping\/settings/);
  assert.match(script, /applyOrderPatchToUi/);
  assert.match(script, /isAuthSessionError/);
});

test("admin users tab supports panel account management", () => {
  assert.match(html, /id="usersTab"/);
  assert.match(html, /id="adminTabUsers"/);
  assert.match(html, /id="adminUserForm"/);
  assert.match(html, /id="loginEmail"/);
  assert.match(html, /id="calendarNotifyEmail"/);
  assert.match(html, /id="ordersTab"/);
  assert.match(html, /id="adminTabOrders"/);
  assert.match(html, /id="adminOrderList"/);
  assert.match(html, /admin-orders-list/);
  assert.match(html, /admin-order-list-head/);
  assert.match(html, /admin-order-head-date/);
  assert.match(html, /admin-order-head-payment/);
  assert.match(html, /admin-order-head-fulfillment/);
  assert.match(html, /id="orderFrom"/);
  assert.match(html, /id="orderTo"/);
  assert.match(html, /id="orderPeriodApply"/);
  assert.match(html, /id="orderSearch"/);
  assert.match(html, /Sipariş no, e-posta veya telefon/);
  assert.match(html, /tüm tarihlerde bakılır/);
  assert.match(script, /params\.set\("q"/);
  assert.match(script, /tüm tarihlerde arandı/);
  assert.match(script, /Bu aramaya uyan sipariş yok/);
  assert.match(html, /data-order-days="1"/);
  assert.doesNotMatch(html, /id="adminOrderDetailTitle"/);
  assert.match(
    html,
    /id="overviewTab"[\s\S]*?id="ordersTab"[\s\S]*?id="productsTab"/
  );
  assert.match(html, /id="xmlProductsView"[\s\S]*id="supplierFeedModal"/);
  assert.doesNotMatch(html, /id="manualProductsView"[\s\S]*id="supplierFeedModal"[\s\S]*id="xmlProductsView"/);
  assert.match(html, /Son başarılı katalog/);
  assert.match(html, /stok dondurulur/);
  assert.match(script, /loadAdminUsers/);
  assert.match(script, /loadAdminOrders/);
  assert.match(script, /formatOrderDate/);
  assert.match(script, /admin-order-date/);
  assert.match(script, /paymentStatusBadge/);
  assert.match(script, /fulfillmentStatusBadge/);
  assert.match(script, /admin-order-payment-cell/);
  assert.match(script, /ordersCache\.find/);
  assert.match(script, /forceFetch/);
  assert.match(script, /admin-order-row/);
  assert.match(script, /adminOrderSaveShipping/);
  assert.match(script, /saveBtn\.disabled = true/);
  assert.match(script, /adminOrderResendShippingMail/);
  assert.match(script, /Müşteri e-posta geçmişi/);
  assert.match(script, /admin-order-mail-badge--sent/);
  assert.match(script, /renderBizimHesapBlock/);
  assert.match(script, /adminOrderBizimhesapSend/);
  assert.match(script, /BizimHesap faturası/);
  assert.match(script, /\/api\/admin\/orders\/.*\/bizimhesap-invoice/);
  assert.match(script, /notifyEmail/);
  assert.match(script, /\/api\/admin\/users/);
  assert.match(script, /supplier\/products\?/);
  assert.match(script, /isSupplierProducts/);
});

test("XML feed revision edits image gallery and description", () => {
  assert.match(html, /id="sFeedImagePreview"/);
  assert.match(html, /id="sFeedImageFile"/);
  assert.match(html, /id="sFeedImageUrlBtn"/);
  assert.match(html, /id="sFeedDetails"/);
  assert.match(html, /<textarea id="sFeedDescription"/);
  assert.match(script, /renderSupplierFeedImagePreviews/);
  assert.match(script, /supplierFeedImages/);
  assert.match(script, /details: supplierFeedFields.details/);
});

test("admin XML refresh errors mention supplier access not generic /admin path", () => {
  assert.doesNotMatch(script, /API'ye ulaşılamadı\. Sunucu çalışıyor mu\? Adres: \/admin/);
  assert.match(script, /XML çekimi zaman aşımına uğradı/);
  assert.match(script, /IP whitelist/);
  assert.match(script, /slot\.lastError/);
});
