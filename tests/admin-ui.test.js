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

test("admin overview uses consistent full-width grid spacing", () => {
  assert.match(html, /admin-page--overview/);
  assert.doesNotMatch(html, /admin-overview-grid-2" style="margin-top/);
  assert.doesNotMatch(html, /admin-kpis" style="margin-top/);
  assert.doesNotMatch(html, /admin-akakce-card" style="margin-top/);
  assert.match(css, /\.admin-page--overview/);
  assert.match(css, /\.admin-overview-grid-3\s*\{[\s\S]*?repeat\(3,/);
  assert.match(css, /\.admin-overview-grid\s*>\s*\.admin-card/);
});

test("admin XML schedule is editable under critical stock", () => {
  assert.match(html, /id="supplierCriticalStock1"[\s\S]*?id="supplierScheduleStart1"[\s\S]*?id="supplierScheduleInterval1"/);
  assert.match(html, /data-slot-input="scheduleStart"/);
  assert.match(html, /data-slot-input="scheduleInterval"/);
  assert.match(html, /Otomatik XML okuma/);
  assert.match(script, /scheduleStart/);
  assert.match(script, /scheduleIntervalMinutes/);
  assert.match(css, /\.admin-schedule-row/);
  assert.doesNotMatch(html, /07:00’da başlar, günde 10 kez/);
  assert.match(html, /Avansas \(test\)/);
  assert.match(html, /Yayına almayın/);
  assert.match(html, /id="supplierPoolPager"/);
  assert.match(html, /Stok \(son XML\)/);
  assert.match(html, /Site kategorisi/);
  assert.match(script, /Son XML okumasındaki stok adedi/);
  assert.match(html, /value="nocat"/);
  assert.match(script, /POOL_PAGE_SIZE/);
  assert.match(script, /siteCategoryAssigned/);
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
  assert.match(html, /id="dashServerStatus"/);
  assert.match(script, /\/api\/admin\/dashboard/);
  assert.match(script, /loadDigitalDashboard/);
  assert.match(html, /id="dashTopViewed"/);
  assert.match(html, /id="dashTopPurchased"/);
  assert.match(script, /topViewedProducts/);
  assert.match(script, /topPurchasedProducts/);
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

test("admin never renders the default password as a login hint", () => {
  assert.doesNotMatch(html, /patygo-admin/);
  assert.match(html, /ADMIN_PASSWORD/);
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
  assert.match(script, /admin-order-row/);
  assert.match(script, /adminOrderSaveShipping/);
  assert.match(script, /notifyEmail/);
  assert.match(script, /\/api\/admin\/users/);
  assert.match(script, /\/api\/admin\/orders/);
});

test("admin XML refresh errors mention supplier access not generic /admin path", () => {
  assert.doesNotMatch(script, /API'ye ulaşılamadı\. Sunucu çalışıyor mu\? Adres: \/admin/);
  assert.match(script, /XML çekimi zaman aşımına uğradı/);
  assert.match(script, /IP whitelist/);
  assert.match(script, /slot\.lastError/);
});
