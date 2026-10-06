const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const loginScript = fs.readFileSync(path.join(root, "assets", "js", "admin-login.js"), "utf8");
const script = fs.readFileSync(path.join(root, "assets", "js", "admin-panel.js"), "utf8");
const css = fs.readFileSync(path.join(root, "assets", "css", "admin.css"), "utf8");

test("admin markup has unique element IDs", () => {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
});

test("sidebar has an unlisted products tab wired to the supplier API", () => {
  assert.match(html, /data-admin-tab="unlisted"[^>]*>[\s\S]*?Listelenmeyen Ürünler/);
  assert.match(html, /id="adminTabUnlisted"/);
  assert.match(html, /id="adminUnlistedRows"/);
  assert.match(html, /id="unlistedNavCount"/);
  assert.match(script, /status: "unlisted"/);
  assert.match(script, /unlisted: false/);
  assert.match(script, /unlisted: true/);
  assert.match(script, /"categories", "unlisted"\]\.includes/);
  assert.match(script, /textContent = text \|\| "—"/);
  assert.doesNotMatch(script, /adminUnlistedRows[^\n]*innerHTML/);
});

test("unlisted tab also lists products whose category left the menu, with paging and a move action", () => {
  assert.match(html, /id="adminUnlistedSearch"/);
  assert.match(html, /id="adminUnlistedReason"[\s\S]*?value="menu"[\s\S]*?value="manual"/);
  assert.match(html, /id="adminUnlistedPager"/);
  assert.match(script, /reason: unlistedReason/);
  assert.match(script, /item\.menuMissing/);
  assert.match(script, /Kategoriye taşı/);
  assert.match(script, /data\.menuMissingCount/);
  assert.match(script, /renderUnlistedNavCount\(unlistedTotal\(results\[1\]\)\)/);
  assert.doesNotMatch(script, /status=unlisted&limit=100/);
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

test("order detail is a summary strip plus tabs, keeping every action id wired", () => {
  const start = script.indexOf("const ORDER_DETAIL_TABS");
  const end = script.indexOf("function stashOrderMailNotice");
  assert.ok(start > 0 && end > start, "sipariş detay bloğu bulunmalı");
  const block = script.slice(start, end);
  ["ozet", "kargo", "odeme", "fatura", "gecmis", "kvkk"].forEach((key) => {
    assert.match(block, new RegExp('\\["' + key + '", "'));
  });
  assert.match(block, /role='tablist'/);
  assert.match(block, /role='tabpanel'/);
  assert.match(block, /aria-selected/);
  assert.match(block, /ArrowRight/);
  assert.match(block, /Sıradaki adım:/);
  assert.match(block, /data-od-goto/);
  assert.match(block, /Teknik banka kaydı/);
  assert.match(block, /<details class='admin-od-tech'>/);
  ["adminOrderStatus", "adminOrderSaveStatus", "adminOrderCarrier", "adminOrderTracking", "adminOrderSaveShipping",
    "adminOrderResendShippingMail", "adminOrderAnonymize"].forEach((id) => {
    assert.equal(block.split("id='" + id + "'").length - 1, 1, id + " tek kez render edilmeli");
  });
  assert.match(block, /renderBankReversalBlock\(order\)/);
  assert.match(block, /renderBizimHesapBlock\(order\)/);
  assert.match(block, /<option value='' selected>Seçin<\/option>/);
  assert.match(script, /bindOrderDetailTabs\(orderId\);/);
  assert.match(script, /Yeni durumu seçin\./);
  assert.match(script, /status === "paid" && order\.paymentStatus === "paid"\) return "new"/);
  assert.match(css, /\.admin-od-tab\[aria-selected="true"\]/);
  assert.match(css, /\.order-status--new/);
});

test("saved order/dashboard ranges ending on the save day roll forward so new days' orders stay visible", () => {
  const pick = (name) => {
    const start = script.indexOf("function " + name + "(");
    assert.ok(start > 0, name + " bulunmalı");
    let depth = 0;
    for (let i = script.indexOf("{", start); i < script.length; i++) {
      if (script[i] === "{") depth++;
      if (script[i] === "}" && --depth === 0) return script.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const vm = require("node:vm");
  const ctx = {};
  vm.runInNewContext(
    [
      pick("isoDate"),
      pick("defaultPeriodRange"),
      pick("rollSavedRange"),
      "this.roll = (p, d) => JSON.stringify(rollSavedRange(p, d)); this.iso = isoDate;",
    ].join("\n"),
    ctx
  );
  const roll = (parsed, days) => JSON.parse(ctx.roll(parsed, days));
  const day = (offset) => ctx.iso(new Date(Date.now() + offset * 86400000));
  const today = day(0);
  assert.deepEqual(roll({ from: day(-30), to: day(-1), savedOn: day(-1) }, 30), { from: day(-29), to: today });
  assert.deepEqual(roll({ from: day(-30), to: day(-1) }, 30), { from: day(-29), to: today });
  assert.deepEqual(roll({ from: day(-40), to: day(-20), savedOn: day(-1) }, 30), { from: day(-40), to: day(-20) });
  assert.deepEqual(roll({ from: day(-6), to: today, savedOn: today }, 30), { from: day(-6), to: today });
  assert.deepEqual(roll(null, 7), { from: day(-6), to: today });
  assert.match(script, /localStorage\.setItem\(ORDER_PERIOD_KEY, storedRange\(from, to\)\)/);
  assert.match(script, /localStorage\.setItem\(PERIOD_KEY, storedRange\(from, to\)\)/);
});

test("stale admin tabs detect a newer build and refuse bank operations", () => {
  assert.match(script, /fetch\("\/admin", \{ cache: "no-store"/);
  assert.match(script, /admin-login\\\.js\\\?v=/);
  assert.match(script, /showPanelOutdatedBanner/);
  assert.match(script, /if \(await checkPanelBuild\(\)\) \{\s*setBankNote\("err"/);
  assert.match(script, /visibilitychange/);
  assert.match(css, /\.admin-update-banner/);
  assert.match(html, /admin-login\.js\?v=([\w-]+)"/);
});

test("payment badge tells same-day cancel (void) apart from card refund and partial refund", () => {
  const pick = (name) => {
    const start = script.indexOf("function " + name + "(");
    assert.ok(start > 0, name + " bulunmalı");
    let depth = 0;
    for (let i = script.indexOf("{", start); i < script.length; i++) {
      if (script[i] === "{") depth++;
      if (script[i] === "}" && --depth === 0) return script.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const vm = require("node:vm");
  const ctx = {};
  vm.runInNewContext(
    [
      pick("orderReversalKinds"),
      pick("orderVoidedOnly"),
      pick("paymentStatusKey"),
      pick("orderStatusLabel"),
      pick("bankEventLabel"),
      "this.key = paymentStatusKey; this.label = orderStatusLabel; this.eventLabel = bankEventLabel;",
    ].join("\n"),
    ctx
  );
  const ev = (type, extra) => Object.assign({ kind: "bank_reversal", type, success: true, amount: "10.00" }, extra);
  assert.equal(ctx.key({ paymentStatus: "refunded", paymentEvents: [ev("void")] }), "voided");
  assert.equal(ctx.label("voided"), "Sipariş iptali");
  assert.equal(ctx.key({ paymentStatus: "refunded", paymentEvents: [ev("refund")] }), "refunded");
  assert.equal(ctx.key({ paymentStatus: "refunded", paymentEvents: [ev("refund"), ev("void")] }), "refunded");
  assert.equal(ctx.key({ paymentStatus: "paid", paymentEvents: [ev("refund")] }), "partially_refunded");
  assert.equal(ctx.label("partially_refunded"), "Kısmi iade");
  assert.equal(ctx.key({ paymentStatus: "paid", paymentEvents: [ev("refund", { success: false, unknown: true })] }), "paid");
  assert.equal(ctx.key({ paymentStatus: "paid", paymentEvents: [ev("void", { dryRun: true })] }), "paid");
  assert.equal(ctx.key({ paymentStatus: "failed" }), "payment_failed");
  assert.match(script, /ödeme bankada iptal edildi, karttan çekim yapılmadı/);
  assert.equal(ctx.eventLabel({ outcome: "paid", responseCode: "VPS-0000" }), "Ödeme onayı");
  assert.equal(ctx.eventLabel(ev("void")), "Sipariş iptali");
  assert.equal(ctx.eventLabel(ev("refund")), "İade");
  assert.equal(ctx.eventLabel(ev("void", { success: false, unknown: true })), "Sipariş iptali — sonuç bilinmiyor");
  assert.equal(ctx.eventLabel(ev("refund", { success: false })), "İade — reddedildi");
  assert.match(script, /\["Sipariş no \(bankada\)", order\.id\]/);
});

test("fully reversed orders hide the items refund form and refetched detail repaints row badges", () => {
  assert.match(script, /const fullyReversed = Number\(preview\.reversedAmount\) > 0 && !\(Number\(preview\.remainingAmount\) > 0\)/);
  assert.match(script, /!pending &&\s*!fullyReversed;/);
  const expand = script.slice(script.indexOf("async function expandOrderRow"));
  assert.match(expand.slice(0, 2500), /paintOrderRowBadges\(block, order\);\s*expand\.innerHTML = buildOrderDetailHtml/);
});

test("admin buttons do not shift on hover (no translateY from storefront btn)", () => {
  assert.match(css, /\.admin-body \.btn[\s\S]*?transform:\s*none/);
  assert.match(css, /\.admin-body \.btn-primary[\s\S]*?box-shadow:\s*none/);
  assert.match(html, /admin\.css\?v=siparis-4/);
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

test("admin overview shows catalog summary right under the digital KPIs", () => {
  const overview = html.match(/id="adminTabOverview"[\s\S]*?id="adminTabOrders"/)[0];
  const digitalAt = overview.indexOf('id="dashAov"');
  const catalogAt = overview.indexOf("Katalog özeti");
  const trafficAt = overview.indexOf('id="dashSpark"');
  assert.ok(digitalAt > 0 && catalogAt > digitalAt && catalogAt < trafficAt);
  for (const id of [
    "dashCatalogTotal",
    "dashCatalogSiteActive",
    "dashCatalogCritical",
    "dashCatalogOutOfStock",
    "dashCatalogUnlisted",
    "dashCatalogXml",
  ]) {
    assert.match(overview, new RegExp('id="' + id + '"'));
  }
  assert.match(overview, /data-open-admin-tab="unlisted"/);
  assert.doesNotMatch(html, /id="dashboardProductCount"/);
  assert.doesNotMatch(script, /dashboardProductCount|dashboardFeedCount"/);
  assert.match(script, /function renderCatalogSummary/);
  assert.match(script, /payload\.catalogSummary/);
});

test("admin overview header keeps period controls on one compact row", () => {
  const head = html.match(/admin-overview-head[\s\S]*?admin-kpis-digital/)[0];
  assert.match(head, /id="dashPeriodHint"/);
  assert.doesNotMatch(head, /<p class="admin-hint" id="dashPeriodHint"/);
  assert.match(head, /data-dash-days="30" aria-pressed/);
  assert.doesNotMatch(html, /<p class="admin-hint" id="dashLeadsNote"/);
  assert.match(html, /gelen kutusu ayrı/);
  assert.match(css, /\.admin-overview-head\s*\{[^}]*align-items:\s*center/);
  assert.match(css, /\.admin-period-box \.admin-period-custom\s*\{[^}]*nowrap/);
  assert.match(script, /function syncPeriodPresets/);
});

test("admin products view does not overwrite the overview title on reload", () => {
  const fn = script.match(/function selectProductsView\(name\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /productsTab\.classList\.contains\("active"\)[\s\S]*?adminPageTitle/);
});

test("admin mobile shell does not widen the page with the scrolling nav", () => {
  assert.match(css, /\.admin-shell \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("admin top pages keep view counts aligned when paths are long", () => {
  assert.match(css, /\.admin-top-pages li strong\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(css, /\.admin-top-pages li span:first-child\s*\{[^}]*min-width:\s*0/);
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

test("admin login distinguishes timeout from wrong password and retries once", () => {
  assert.match(loginScript, /Bu şifre hatası değil/);
  assert.match(loginScript, /Bağlantı yenileniyor, tekrar deneniyor/);
  assert.match(loginScript, /timeout|60000/);
  const loginVersion = (html.match(/admin-login\.js\?v=([\w-]+)/) || [])[1];
  assert.ok(loginVersion, "admin-login.js must carry a cache-busting version");
  assert.match(html, /defer src="\/assets\/js\/admin-login\.js/);
  assert.equal((loginScript.match(/admin-panel\.js\?v=([\w-]+)/) || [])[1], loginVersion);
  assert.match(loginScript, /createElement\("script"\)/);
});

test("admin supplier load keeps panel responsive without blocking on feed=1", () => {
  assert.match(script, /api\("\/api\/admin\/supplier\/status"\)/);
  assert.match(script, /api\("\/api\/admin\/supplier\/status\?feed=1"/);
  assert.match(script, /timeout:\s*90000/);
  const loadFn = script.match(/async function loadSupplierData\(\) \{[\s\S]*?\n  \}/);
  assert.ok(loadFn, "loadSupplierData bulunmalı");
  const waitBlock = loadFn[0].match(/Promise\.all\(\[[\s\S]*?\]\)/);
  assert.ok(waitBlock, "Promise.all block bulunmalı");
  assert.match(waitBlock[0], /api\("\/api\/admin\/supplier\/status"\)/);
  assert.doesNotMatch(waitBlock[0], /status\?feed=1/);
  assert.match(loadFn[0], /\.then\(\(feedData\) =>/);
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
    /id="overviewTab"[\s\S]*?id="ordersTab"[\s\S]*?id="productsTab"[\s\S]*?id="unlistedTab"[\s\S]*?id="categoriesTab"[\s\S]*?id="xmlTab"[\s\S]*?id="calendarTab"[\s\S]*?id="shippingTab"[\s\S]*?id="usersTab"[\s\S]*?id="reviewsTab"[\s\S]*?id="leadsTab"[\s\S]*?<\/nav>/
  );
  assert.match(html, /id="adminTabLeads"/);
  assert.match(html, /id="adminLeadList"/);
  assert.match(html, /id="xmlProductsView"[\s\S]*id="supplierFeedModal"/);
  assert.doesNotMatch(html, /id="manualProductsView"[\s\S]*id="supplierFeedModal"[\s\S]*id="xmlProductsView"/);
  assert.match(html, /Son başarılı katalog/);
  assert.match(html, /stok dondurulur/);
  assert.match(script, /loadAdminUsers/);
  assert.match(script, /loadAdminOrders/);
  assert.match(script, /loadAdminLeads/);
  assert.match(script, /\/api\/admin\/leads/);
  assert.match(script, /adminOrderAnonymize/);
  assert.match(script, /\/anonymize/);
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
  assert.match(script, /Müşteriye giden e-postalar/);
  assert.match(script, /admin-order-mail-badge--sent/);
  assert.match(script, /renderBizimHesapBlock/);
  assert.match(script, /adminOrderBizimhesapSend/);
  assert.match(script, /adminOrderBizimhesapMail/);
  assert.match(script, /Fatura kes/);
  assert.match(script, /PDF mailini tekrar gönder/);
  assert.match(script, /BizimHesap faturası/);
  assert.match(script, /\/api\/admin\/orders\/.*\/bizimhesap-invoice/);
  assert.match(script, /mailOnly:\s*true/);
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

test("leads tab lets the admin reply with attachments and stays readable in dark theme", () => {
  assert.doesNotMatch(html, /admin-leads-list-head/);
  assert.match(html, /id="adminTabLeads"(?:(?!id="adminTabUnlisted")[\s\S])*id="leadReplyModal" class="admin-modal" hidden/);
  for (const id of ["leadReplyForm", "leadReplyTo", "leadReplySubject", "leadReplyMessage", "leadReplyFiles", "leadReplyFileList", "leadReplySendBtn", "leadReplyNote", "leadReplyOriginal"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /accept="\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.png,\.jpg,\.jpeg"/);
  assert.match(html, /gizli kopyası info@/);
  assert.ok((html.match(/data-close-lead-reply/g) || []).length >= 3);
  assert.match(script, /"\/api\/admin\/leads\/" \+ encodeURIComponent\(leadReplyTarget\.id\) \+ "\/reply"/);
  assert.match(script, /readAsDataURL/);
  assert.match(script, /LEAD_REPLY_MAX_FILES = 5/);
  assert.match(script, /LEAD_REPLY_MAX_BYTES = 10 \* 1024 \* 1024/);
  assert.match(script, /data\.replyEnabled === true/);
  assert.match(script, /Yanıt bekliyor/);
  assert.match(script, /Yanıtlandı/);
  assert.match(css, /html\.admin-theme-dark \.admin-item,\s*html\.admin-theme-dark \.admin-list-item/);
  assert.match(css, /html\.admin-theme-dark \.admin-lead-badge\.is-waiting/);
});

test("leads nav item blinks a red dot while a lead waits for a reply", () => {
  assert.match(html, /id="leadsTab"[^>]*>[\s\S]*?Talepler<span class="admin-nav-alert" id="leadsNavAlert" hidden>[\s\S]*?class="sr-only" id="leadsNavAlertText"/);
  assert.match(css, /\.admin-nav-alert \{[\s\S]*?background: #ef4444;[\s\S]*?animation: admin-nav-alert-blink/);
  assert.match(css, /\.admin-nav-alert\[hidden\] \{ display: none; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.admin-nav-alert \{ animation: none; \}/);
  assert.match(script, /!lead\.spam && !\(Array\.isArray\(lead\.replies\) && lead\.replies\.length\)/);
  assert.match(script, /renderLeadsNavAlert\(leads\);\s*listEl\.textContent = ""/);
  assert.match(script, /if \(tab === "leads"\) loadAdminLeads\(\)\.catch\(\(\) => \{\}\);\s*else refreshLeadsNavAlert\(\)/);
  assert.match(script, /refreshLeadsNavAlert\(\)\.catch\(\(\) => \{\}\);\s*\}, 60 \* 1000\)/);
  assert.match(script, /visibilitychange/);
});

test("every light surface or dark text color in admin.css has a dark theme override", () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const luminance = (hex) => {
    let h = hex.replace("#", "").toLowerCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return null;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const tokens = (value) =>
    (value.match(/#[0-9a-fA-F]{3,6}\b|\bwhite\b/g) || [])
      .map((tok) => luminance(tok.toLowerCase() === "white" ? "#fff" : tok))
      .filter((l) => l !== null);
  const rules = Array.from(source.matchAll(/([^{}@;]+)\{([^{}]*)\}/g), (m) => ({
    selector: m[1].replace(/\s+/g, " ").trim(),
    body: m[2],
  }));
  const darkCovered = new Set();
  for (const rule of rules) {
    for (const part of rule.selector.split(",").map((p) => p.trim())) {
      if (part.startsWith("html.admin-theme-dark ")) darkCovered.add(part.replace(/^html\.admin-theme-dark\s+/, ""));
    }
  }
  // The switch knob stays white on both themes by design.
  const allowed = new Set([".admin-switch span::after"]);
  const missing = [];
  for (const rule of rules) {
    if (rule.selector.includes("admin-theme-dark")) continue;
    const decls = rule.body.split(";").map((d) => d.split(":")).filter((d) => d.length > 1);
    const needsDark = decls.some(([prop, ...rest]) => {
      const name = prop.trim().toLowerCase();
      const value = rest.join(":");
      if (name === "background" || name === "background-color") return tokens(value).some((l) => l > 0.75);
      if (name === "color") return tokens(value).some((l) => l < 0.12);
      return false;
    });
    if (!needsDark) continue;
    for (const part of rule.selector.split(",").map((p) => p.trim())) {
      if (!darkCovered.has(part) && !allowed.has(part)) missing.push(part);
    }
  }
  assert.deepEqual(missing, []);
});

test("unlisted toolbar and table rows are styled for both themes", () => {
  assert.match(css, /\.admin-toolbar input,\s*\.admin-toolbar select \{[\s\S]*?min-height: 40px;/);
  assert.match(css, /html\.admin-theme-dark \.admin-toolbar input,\s*html\.admin-theme-dark \.admin-toolbar select,/);
  assert.match(css, /html\.admin-theme-dark \.admin-table tr:hover td \{ background: #16213a; \}/);
  assert.match(css, /html\.admin-theme-dark \.field input,\s*html\.admin-theme-dark \.field select,\s*html\.admin-theme-dark \.field textarea,/);
});

test("admin tables expose click-to-sort headers wired to whitelisted server sort", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "admin-panel.js"), "utf8");
  const headKeys = (id) => {
    const match = html.match(new RegExp('id="' + id + '"[\\s\\S]*?</(?:thead|div)>'));
    assert.ok(match, id + " header exists");
    return Array.from(match[0].matchAll(/data-sort-key="([^"]+)"/g), (m) => m[1]);
  };
  assert.deepEqual(headKeys("supplierProductHead"), ["name", "sku", "source", "cost", "margin", "price", "stock", "siteCategory", "feed", "active"]);
  assert.deepEqual(headKeys("adminUnlistedHead"), ["name", "sku", "stock", "xmlCategory", "reason"]);
  assert.deepEqual(headKeys("productPoolHead"), ["name", "stock", "xmlCategory"]);
  assert.deepEqual(headKeys("adminOrderListHead"), ["id", "date", "customer", "payment", "status", "total"]);
  assert.deepEqual(headKeys("couponTableHead"), ["code", "discount", "minOrder", "used", "active"]);
  assert.doesNotMatch(html, /class="admin-order-list-head"[^>]*aria-hidden/, "sortable order head stays reachable");

  const serverSortKeys = fs.readFileSync(path.join(__dirname, "..", "lib", "multi-supplier.js"), "utf8")
    .match(/const PRODUCT_SORT_VALUES = \{([\s\S]*?)\n  \};/)[1];
  new Set([...headKeys("supplierProductHead"), ...headKeys("adminUnlistedHead"), ...headKeys("productPoolHead")]).forEach((key) => {
    if (key === "feed") return;
    assert.match(serverSortKeys, new RegExp("\\n    " + key + ":"), key + " is a server sort key");
  });
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /sortValues: \{[\s\S]{0,200}feed: \(item\) =>/, "Export sort key is provided by the products endpoint");
  assert.match(html, /<option value="feedmissing">Stokta · Export eksik<\/option>/);

  assert.match(js, /function setupSortableHeader\(head, name, onChange\)/);
  assert.match(js, /SORT_STORAGE_PREFIX = "patygo_sort_"/);
  assert.match(js, /aria-sort/);
  assert.match(js, /supplierSort\.apply\(qs\)/);
  assert.match(js, /unlistedSort\.apply\(qs\)/);
  assert.match(js, /productPoolSort\.apply\(qs\)/);
  assert.match(js, /orderSort\.apply\(params\)/);
  assert.match(js, /couponSort\s*\.sortList\(coupons, COUPON_SORT_VALUES\)/);
});
