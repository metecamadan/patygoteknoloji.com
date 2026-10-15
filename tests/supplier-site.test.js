const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildTreeFromSupplierProducts,
  mergeCategoryTrees,
  suggestSiteCategory,
  browseChildName,
  cleanCategoryName,
  syncXmlSiteCategories,
  syncXmlSiteCategoriesAsync,
  ensureCanonicalSiteTree,
  markPanelCategoryChoice,
  inferEmptyXmlCategories,
} = require("../lib/supplier-site");
const { createCategoryStore, slugifyCategory } = require("../lib/categories");
const { queryPublicCatalog } = require("../lib/catalog");

test("XML ana/ara kategori becomes a two-level site tree", () => {
  const tree = buildTreeFromSupplierProducts([
    { mainCategory: "OEM &amp; ÇEVRE BİRİMLERİ", midCategory: "İşlemciler" },
    { mainCategory: "OEM & ÇEVRE BİRİMLERİ", midCategory: "İşlemciler" },
    { mainCategory: "KİŞİSEL BİLGİSAYARLAR", midCategory: "Taşınabilir Bilgisayarlar" },
  ]);
  assert.equal(cleanCategoryName("OEM &amp; ÇEVRE BİRİMLERİ"), "OEM & ÇEVRE BİRİMLERİ");
  assert.equal(tree.length, 2);
  const oem = tree.find((row) => row.slug === slugifyCategory("OEM & ÇEVRE BİRİMLERİ"));
  assert.ok(oem);
  assert.equal(oem.children[0].name, "İşlemciler");
  const pair = suggestSiteCategory(
    { mainCategory: "OEM & ÇEVRE BİRİMLERİ", midCategory: "İşlemciler" },
    tree
  );
  assert.equal(pair.siteParent, oem.slug);
  assert.equal(pair.siteChild, oem.children[0].slug);
});

test("Intel Alt kategori maps onto schema ANA/ARA/ALT leaves", () => {
  assert.equal(
    browseChildName({ mid: "İşlemciler", sub: "Intel İşlemciler" }),
    "İşlemciler"
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  const store = createCategoryStore(root);
  const pair = suggestSiteCategory(
    {
      mainCategory: "KİŞİSEL BİLGİSAYARLAR",
      midCategory: "Bilgisayar Bileşenleri",
      subCategory: "İşlemci",
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "İşlemciler",
      xmlSubCategory: "Intel İşlemciler",
    },
    store.list()
  );
  assert.equal(pair.siteParent, "bilgisayar-bilesenleri");
  assert.equal(pair.siteMid, "islemciler");
  assert.equal(pair.siteChild, "intel-islemciler");
  fs.rmSync(root, { recursive: true, force: true });
});

test("DDR5 XML categories map onto PC and notebook memory leaves", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-ddr5-"));
  const store = createCategoryStore(root);
  const tree = store.list();
  const desktop = suggestSiteCategory(
    {
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "Bellekler",
      xmlSubCategory: "PC Belleği DDR5",
      name: "Kingston Fury Beast DDR5 16GB",
    },
    tree
  );
  assert.equal(desktop.siteParent, "bilgisayar-bilesenleri");
  assert.equal(desktop.siteMid, "bellekler");
  assert.equal(desktop.siteChild, "pc-bellegi-ddr5");

  const short = suggestSiteCategory(
    {
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "Bellekler",
      xmlSubCategory: "DDR5",
      name: "Corsair Vengeance DDR5 32GB",
    },
    tree
  );
  assert.equal(short.siteChild, "pc-bellegi-ddr5");

  const hyphen = suggestSiteCategory(
    {
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "Bellekler",
      xmlSubCategory: "PC Belleği - DDR5",
      name: "XPG Lancer Blade DDR5 16GB",
    },
    tree
  );
  assert.equal(hyphen.siteParent, "bilgisayar-bilesenleri");
  assert.equal(hyphen.siteMid, "bellekler");
  assert.equal(hyphen.siteChild, "pc-bellegi-ddr5");

  const notebook = suggestSiteCategory(
    {
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "Bellekler",
      xmlSubCategory: "Notebook Belleği DDR5",
      name: "Notebook SODIMM DDR5 16GB",
    },
    tree
  );
  assert.equal(notebook.siteChild, "notebook-bellegi-ddr5");
  assert.equal(
    browseChildName({ mid: "Bellekler", sub: "PC Belleği DDR5" }),
    "PC Belleği DDR5"
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("stocked XML groups without a site leaf map onto the cable, phone, alarm and rack leaves", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-new-leaves-"));
  const tree = createCategoryStore(root).list();
  const place = (main, mid, sub, name) => {
    const pair = suggestSiteCategory(
      { xmlMainCategory: main, xmlMidCategory: mid, xmlSubCategory: sub, name },
      tree
    );
    return pair ? [pair.siteParent, pair.siteMid, pair.siteChild].join("/") : null;
  };
  const NET = "KURUMSAL & AĞ ÜRÜNLERİ";
  const cases = [
    [NET, "Kablo Çeşitleri", "Cat5 ve Cat6 Kablolar", "Cat6 Patch Kablo 2m", "bilgisayar-tablet/kablolar-ve-donusturuculer/cat5-ve-cat6-kablolar"],
    [NET, "Kablo Çeşitleri", "Çevirici Kablolar", "HDMI Extender", "bilgisayar-tablet/kablolar-ve-donusturuculer/cevirici-ve-donusturuculer"],
    [NET, "Kablo Çeşitleri", "HDMI Kablolar", "HDMI 2.1 5m", "bilgisayar-tablet/kablolar-ve-donusturuculer/goruntu-kablolari"],
    [NET, "Kablo Çeşitleri", "Görüntü Kabloları", "VGA Kablo", "bilgisayar-tablet/kablolar-ve-donusturuculer/goruntu-kablolari"],
    [NET, "Kablo Çeşitleri", "Güç (Power) Kabloları", "Power Kablosu", "bilgisayar-tablet/kablolar-ve-donusturuculer/guc-kablolari"],
    [NET, "Kablo Çeşitleri", "Kablo Bağı", "Kablo Kanalı 16x16", "bilgisayar-tablet/kablolar-ve-donusturuculer/kablo-kanali-ve-duzenleyiciler"],
    [NET, "Kablo Çeşitleri", "Uydu Kabloları", "Tv Uzatma Kablosu", "bilgisayar-tablet/ag-urunleri/anten-ve-anten-kablolari"],
    [NET, "Kablo Çeşitleri", "Konnectör ve Jaklar", "Cat6 RJ45 Konnektör", "bilgisayar-tablet/modem-ve-switch/konnektor-ve-jaklar"],
    [NET, "Kablo Çeşitleri", "Kablo Sıyırıcı ve Penseleri", "RJ45 Sıkma Pensesi", "bilgisayar-tablet/modem-ve-switch/kablo-sikma-ve-siyiricilar"],
    [NET, "Kabin & Aksesuarları", "Kabin", "9U Rack Kabin", "bilgisayar-tablet/modem-ve-switch/rack-kabinler"],
    [NET, "Kabin & Aksesuarları", "Patch Paneller", "Fiber Adapter", "bilgisayar-tablet/modem-ve-switch/patch-paneller"],
    ["OEM & ÇEVRE BİRİMLERİ", "Telefon ve Tablet Aksesuarları", "Şarj ve Data Kabloları", "Type-C Data Kablosu", "bilgisayar-tablet/telefon-ve-tablet-aksesuarlari/sarj-ve-data-kablolari"],
    ["OEM & ÇEVRE BİRİMLERİ", "Telefon ve Tablet Aksesuarları", "Duvar Şarj Cihazları", "25W Şarj Kafa", "bilgisayar-tablet/telefon-ve-tablet-aksesuarlari/duvar-sarj-cihazlari"],
    ["GÜVENLİK SİSTEMLERİ", "Alarm Sistemleri", "Alarm Sistemleri", "4 Zone Yangın Alarm Kontrol Paneli", "ofis-urunleri/alarm-sistemleri/yangin-alarm-sistemleri"],
    ["GÜVENLİK SİSTEMLERİ", "Alarm Sistemleri", "Dedektörler", "Kablosuz Pır Dedektör", "ofis-urunleri/alarm-sistemleri/dedektorler"],
    ["GÜVENLİK SİSTEMLERİ", "Alarm Sistemleri", "Kontrol Paneli", "Wireless LED Keypad", "ofis-urunleri/alarm-sistemleri/alarm-kontrol-panelleri"],
    ["OEM & ÇEVRE BİRİMLERİ", "Optik Sürücü", "External DVD Yazıcılar", "Harici Dvdrw Slim", "bilgisayar-bilesenleri/optik-suruculer/dvd-yazicilar"],
    [NET, "Veri Yedekleme ve Depolama", "Veri Depolama Sistemleri", "QNAP NAS 8 Yuva", "bilgisayar-tablet/diskler/nas-depolama"],
    ["TÜKETİCİ ELEKTRONİĞİ", "Hobi ve Oyuncak", "Oyuncaklar", "USB Oyun Kolu", "bilgisayar-tablet/klavye-mouse-urunleri/oyun-kollari-ve-konsollar"],
    ["TÜKETİM ÜRÜNLERİ", "Fotokopi Tüketim (Muadil)", "Muadil Fotokopi Tonerler", "Kyocera TK-435 Muadil Toner", "kartus-toner/fotokopi-tuketim/muadil-fotokopi-tonerler"],
    ["YAPI GEREÇLERİ", "Hırdavat Ürünleri", "Hırdavat Ürünleri", "Hızlı Yapıştırıcı 400ml", "yapi-gerecleri/hirdavat-urunleri/diger-hirdavat"],
  ];
  for (const [main, mid, sub, name, expected] of cases) {
    assert.equal(place(main, mid, sub, name), expected, sub);
  }
  // Leaves that already matched keep their products.
  assert.equal(
    place("GÜVENLİK SİSTEMLERİ", "Güvenlik Ürünü Aksesuarları", "CCTV Kablolar", "CCTV Kablo 100m"),
    "ofis-urunleri/guvenlik-urunu-aksesuarlari/cctv-kablolar"
  );
  assert.equal(
    place("OEM & ÇEVRE BİRİMLERİ", "İşlemciler", "Intel İşlemciler", "Intel Core i7 14700K"),
    "bilgisayar-bilesenleri/islemciler/intel-islemciler"
  );
  assert.equal(place("KİŞİSEL BAKIM VE KOZMETİK", "Ağız ve Diş Bakımı", "Diş Macunu", "Diş Macunu"), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("canonical merge adds missing DDR5 leaves onto a live Bellekler tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-merge-ddr5-"));
  const store = createCategoryStore(root);
  const tree = store.list();
  const parent = tree.find((row) => row.slug === "bilgisayar-bilesenleri");
  const mid = parent.children.find((row) => row.slug === "bellekler");
  mid.children = mid.children.filter((row) => row.slug !== "notebook-bellegi-ddr5");
  store.save(tree);
  const next = ensureCanonicalSiteTree(store);
  const bellekler = next
    .find((row) => row.slug === "bilgisayar-bilesenleri")
    .children.find((row) => row.slug === "bellekler");
  const slugs = bellekler.children.map((row) => row.slug);
  assert.ok(slugs.includes("pc-bellegi-ddr5"));
  assert.ok(slugs.includes("notebook-bellegi-ddr5"));
  const leaf = bellekler.children.find((row) => row.slug === "pc-bellegi-ddr5");
  assert.ok((leaf.xmlNames || []).some((name) => String(name).includes("PC Belleği - DDR5")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("rename keeps slug so XML products stay on the same nav category", () => {
  const existing = [
    {
      slug: "oem-cevre-birimleri",
      name: "Bilgisayar Parçaları",
      xmlNames: ["OEM & ÇEVRE BİRİMLERİ"],
      children: [
        {
          slug: "islemciler",
          name: "İşlemci",
          xmlNames: ["İşlemciler"],
        },
      ],
    },
  ];
  const pair = suggestSiteCategory(
    {
      xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
      xmlMidCategory: "İşlemciler",
      xmlSubCategory: "Intel İşlemciler",
    },
    existing
  );
  assert.equal(pair.siteParent, "oem-cevre-birimleri");
  assert.equal(pair.siteChild, "islemciler");
  const merged = mergeCategoryTrees(existing, [
    {
      name: "OEM & ÇEVRE BİRİMLERİ",
      slug: "oem-cevre-birimleri",
      children: [{ name: "İşlemciler", slug: "islemciler" }],
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].slug, "oem-cevre-birimleri");
  assert.equal(merged[0].name, "Bilgisayar Parçaları");
  assert.ok((merged[0].xmlNames || []).includes("OEM & ÇEVRE BİRİMLERİ"));
});

test("merge aliases XML OEM parent onto curated Bilgisayar Bileşenleri", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-"));
  const store = createCategoryStore(root);
  const merged = mergeCategoryTrees(store.list(), [
    {
      name: "OEM & ÇEVRE BİRİMLERİ",
      slug: "oem-cevre-birimleri",
      children: [{ name: "İşlemciler", slug: "islemciler" }],
    },
  ]);
  assert.ok(merged.some((row) => row.slug === "bilgisayar-tablet"));
  assert.ok(merged.some((row) => row.slug === "bilgisayar-bilesenleri"));
  assert.ok(!merged.some((row) => row.slug === "oem-cevre-birimleri"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("panel-chosen category survives XML sync; publish only activates it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-manual-"));
  const store = createCategoryStore(root);
  const misfiled = {
    supplierSlot: "supplier-1",
    supplierSku: "AIO-1",
    name: "Lenovo ThinkCentre Neo 50a 23.8 FHD",
    mainCategory: "KİŞİSEL BİLGİSAYARLAR",
    midCategory: "Taşınabilir Bilgisayarlar",
    subCategory: "Notebooklar",
    siteParent: "bilgisayar-tablet",
    siteMid: "masaustu-bilgisayarlar",
    siteChild: "all-in-one",
    siteCategoryManual: true,
    siteCategoryAssigned: true,
    active: false,
  };
  const updates = [];
  const manager = {
    listProducts: () => [misfiled],
    updateProducts: (rows) => updates.push(...rows),
  };
  try {
    syncXmlSiteCategories({ manager, categoryStore: store, slotId: "supplier-1" });
    assert.deepEqual(updates, [], "XML refresh must not move a panel-chosen category back");

    syncXmlSiteCategories({ manager, categoryStore: store, slotId: "supplier-1", activate: true });
    assert.deepEqual(updates, [{ supplierSlot: "supplier-1", supplierSku: "AIO-1", active: true }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("XML sync opens new matched products but never reopens one closed in the panel", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-open-"));
  const store = createCategoryStore(root);
  const row = (sku, extra) =>
    Object.assign(
      {
        supplierSlot: "supplier-1",
        supplierSku: sku,
        name: "Epson ERC-38 Şerit " + sku,
        xmlMainCategory: "TÜKETİM ÜRÜNLERİ",
        xmlMidCategory: "Yazıcı Tüketim Ürünleri (Orj.)",
        xmlSubCategory: "Şeritler",
        active: false,
      },
      extra
    );
  const placed = { siteParent: "kartus-toner", siteMid: "yazici-tuketim-urunleri-orj", siteChild: "seritler", siteCategoryAssigned: true };
  const products = [
    row("NEW-1"),
    row("SEEN-1", placed),
    row("CLOSED-1", Object.assign({ deactivated: true }, placed)),
    row("CLOSED-NEW", { deactivated: true }),
    row("LIVE-1", Object.assign({ active: true }, placed)),
  ];
  const updates = [];
  const manager = { listProducts: () => products, updateProducts: (rows) => updates.push(...rows) };
  try {
    const result = syncXmlSiteCategories({ manager, categoryStore: store, slotId: "supplier-1", activate: true });
    const bySku = Object.fromEntries(updates.map((u) => [u.supplierSku, u]));
    assert.equal(bySku["NEW-1"].active, true, "kategorisi eşleşen yeni ürün yayına girer");
    assert.equal(bySku["SEEN-1"].active, true, "kategorisi atanmış ama hiç kapatılmamış ürün yayına girer");
    assert.equal(bySku["CLOSED-1"], undefined, "panelden kapatılan ürün yeniden açılmaz");
    assert.equal(bySku["CLOSED-NEW"].siteChild, "seritler", "kapalı ürünün kategorisi yine güncellenir");
    assert.equal(bySku["CLOSED-NEW"].active, undefined, "ama açılmaz");
    assert.equal(bySku["LIVE-1"], undefined, "zaten yayında olan ürüne dokunulmaz");
    assert.equal(result.activated, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every XML read publishes new matched products and mirrors their images", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(
    server,
    /function syncLiveXmlCategoriesAsync\(slotId\) \{[\s\S]*?activate: true,[\s\S]*?result\.activated > 0[\s\S]*?scheduleAkakceImageMirror\(\)/
  );
});

test("XML sub-category without a counterpart is not dropped into a sibling leaf", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-cats-sibling-"));
  const store = createCategoryStore(root);
  const xml = (main, mid, sub, name) => ({
    xmlMainCategory: main,
    xmlMidCategory: mid,
    xmlSubCategory: sub,
    name: name || sub,
  });
  const toner = "TÜKETİM ÜRÜNLERİ";
  const orj = "Yazıcı Tüketim Ürünleri (Orj.)";
  try {
    const tree = store.list();
    const ribbon = suggestSiteCategory(xml(toner, orj, "Şeritler", "Epson ERC-38 Şerit"), tree);
    assert.deepEqual(ribbon, {
      siteParent: "kartus-toner",
      siteMid: "yazici-tuketim-urunleri-orj",
      siteChild: "seritler",
    });
    assert.equal(suggestSiteCategory(xml(toner, orj, "Transfer Roller"), tree), null);
    assert.equal(
      suggestSiteCategory(xml("TÜKETİCİ ELEKTRONİĞİ", "Bilgisayar Aksesuarları", "Gamepad"), tree).siteChild,
      "oyun-kollari-ve-konsollar",
      "gamepads are not mouse pads"
    );
    assert.equal(
      suggestSiteCategory(xml("TÜKETİCİ ELEKTRONİĞİ", "Oyun Konsolu", "Oyuncu Koltuğu"), tree),
      null,
      "gaming chairs are not game controllers"
    );
    assert.equal(
      suggestSiteCategory(xml("OEM & ÇEVRE BİRİMLERİ", "Monitörler", "LED Monitörler"), tree).siteChild,
      "monitorler",
      "a shared word still matches"
    );
    assert.equal(
      suggestSiteCategory(xml("OEM & ÇEVRE BİRİMLERİ", "Harddiskler", "Notebook Harddiski - SATA"), tree).siteChild,
      "harddiskler",
      "harddiski / harddiskler share a stem; the drive is not a caddy"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sync withdraws automatic placements the mapper no longer suggests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-stale-"));
  const store = createCategoryStore(root);
  const gamepad = (sku, extra) =>
    Object.assign(
      {
        supplierSlot: "supplier-1",
        supplierSku: sku,
        xmlMainCategory: "TÜKETİCİ ELEKTRONİĞİ",
        xmlMidCategory: "Oyun Konsolu",
        xmlSubCategory: "Oyuncu Koltuğu",
        siteParent: "bilgisayar-tablet",
        siteMid: "bilgisayar-aksesuarlari",
        siteChild: "mouse-pad",
        siteCategoryAssigned: true,
        active: true,
      },
      extra || {}
    );
  const updates = [];
  const manager = {
    listProducts: () => [
      gamepad("AUTO"),
      gamepad("PANEL", { siteCategoryManual: true }),
      gamepad("OLD", { siteParent: "tuketici-elektronigi", siteMid: "", siteChild: "oyun", siteCategoryAssigned: false }),
    ],
    updateProducts: (rows) => updates.push(...rows),
  };
  try {
    syncXmlSiteCategories({ manager, categoryStore: store, slotId: "supplier-1" });
    assert.deepEqual(updates, [
      { supplierSlot: "supplier-1", supplierSku: "AUTO", siteParent: "", siteMid: "", siteChild: "" },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rows with only the main XML group take the category of a clear majority of their stock-code group", () => {
  const OEM = "OEM & ÇEVRE BİRİMLERİ";
  const row = (sku, mid, sub, extra) =>
    Object.assign({ supplierSlot: "supplier-1", supplierSku: sku, xmlMainCategory: OEM, xmlMidCategory: mid, xmlSubCategory: sub }, extra || {});
  const speakers = Array.from({ length: 9 }, (_, i) => row("550.20.20.000" + i, "Ses Sistemleri", "Bluetooth Speaker"));
  const cases = Array.from({ length: 4 }, (_, i) => row("100.40.10.000" + i, "Kasalar", "ATX Kasalar"));
  const mixed = [
    ...Array.from({ length: 3 }, (_, i) => row("300.10.10.000" + i, "Kablo Çeşitleri", "USB Kablolar")),
    ...Array.from({ length: 3 }, (_, i) => row("300.10.10.001" + i, "Kablo Çeşitleri", "HDMI Kablolar")),
  ];
  const radio = row("550.20.20.0041", "", "", { name: "Everton Rt-557 Bluetooth Fm-Usb" });
  const lonelyCase = row("100.40.10.0137", "", "");
  const mixedCable = row("300.10.10.0099", "", "");
  const otherMain = row("550.20.20.0099", "", "", { xmlMainCategory: "TÜKETİCİ ELEKTRONİĞİ" });
  const out = inferEmptyXmlCategories([...speakers, ...cases, ...mixed, radio, lonelyCase, mixedCable, otherMain]);
  const bySku = new Map(out.map((item) => [item.supplierSku, item]));

  const inferred = bySku.get("550.20.20.0041");
  assert.equal(inferred.xmlMidCategory, "Ses Sistemleri");
  assert.equal(inferred.xmlSubCategory, "Bluetooth Speaker");
  assert.equal(inferred.name, "Everton Rt-557 Bluetooth Fm-Usb");
  assert.equal(radio.xmlSubCategory, "", "input rows are not mutated");
  assert.equal(bySku.get("100.40.10.0137").xmlSubCategory, "", "fewer than 5 categorised siblings");
  assert.equal(bySku.get("300.10.10.0099").xmlSubCategory, "", "no 80 % majority");
  assert.equal(bySku.get("550.20.20.0099").xmlSubCategory, "", "a different main group is not borrowed");
  assert.equal(bySku.get("550.20.20.0001"), speakers[1], "categorised rows pass through untouched");
});

test("XML sync places an empty-category radio next to its stock-code siblings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-skugroup-"));
  const store = createCategoryStore(root);
  const speaker = (sku, mid, sub) => ({
    supplierSlot: "supplier-1",
    supplierSku: sku,
    xmlMainCategory: "OEM & ÇEVRE BİRİMLERİ",
    xmlMidCategory: mid,
    xmlSubCategory: sub,
    active: false,
  });
  const updates = [];
  const manager = {
    listProducts: () => [
      ...Array.from({ length: 6 }, (_, i) => speaker("550.20.20.000" + i, "Ses Sistemleri", "Bluetooth Speaker")),
      speaker("550.20.20.0041", "", ""),
    ],
    updateProducts: (rows) => updates.push(...rows),
  };
  try {
    syncXmlSiteCategories({ manager, categoryStore: store, slotId: "supplier-1", activate: true });
    const radio = updates.find((row) => row.supplierSku === "550.20.20.0041");
    const sibling = updates.find((row) => row.supplierSku === "550.20.20.0000");
    assert.ok(sibling && sibling.siteChild, "siblings map onto a site leaf");
    assert.deepEqual(
      radio && [radio.siteParent, radio.siteMid, radio.siteChild, radio.active],
      [sibling.siteParent, sibling.siteMid, sibling.siteChild, true]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("panel PATCH marks category edits as manual unless explicitly released", () => {
  assert.equal(
    markPanelCategoryChoice({ supplierSku: "A", siteParent: "x", siteMid: "y", siteChild: "z" })
      .siteCategoryManual,
    true
  );
  assert.equal(markPanelCategoryChoice({ supplierSku: "A", siteParent: "" }).siteCategoryManual, true);
  const toggle = { supplierSku: "A", active: true };
  assert.equal(markPanelCategoryChoice(toggle), toggle);
  const release = { supplierSku: "A", siteParent: "x", siteCategoryManual: false };
  assert.equal(markPanelCategoryChoice(release).siteCategoryManual, false);
  const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(serverJs, /body\.updates\.slice\(0, 5000\) : \[\]\)\.map\(\s*markPanelCategoryChoice/);
});

test("sync maps XML products onto the curated schema without rebuilding the menu", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-"));
  const store = createCategoryStore(root);
  const updates = [];
  const manager = {
    listProducts() {
      return [
        {
          supplierSlot: "supplier-1",
          supplierSku: "NB-1",
          mainCategory: "KİŞİSEL BİLGİSAYARLAR",
          midCategory: "Taşınabilir Bilgisayarlar",
          subCategory: "Notebooklar",
        },
        {
          supplierSlot: "supplier-1",
          supplierSku: "CPU-1",
          mainCategory: "OEM & ÇEVRE BİRİMLERİ",
          midCategory: "İşlemciler",
          subCategory: "Intel İşlemciler",
          siteParent: "oem-cevre-birimleri",
          siteChild: "islemciler",
        },
      ];
    },
    updateProducts(rows) {
      updates.push(...rows);
    },
  };
  try {
    const result = syncXmlSiteCategories({
      manager,
      categoryStore: store,
      slotId: "supplier-1",
    });
    const tree = store.list();
    assert.equal(result.empty, false);
    assert.ok(tree.some((row) => row.slug === "bilgisayar-tablet"));
    assert.ok(tree.some((row) => row.slug === "bilgisayar-bilesenleri"));
    assert.ok(!tree.some((row) => row.slug === "kisisel-bilgisayarlar"));
    assert.ok(!tree.some((row) => row.slug === "oem-cevre-birimleri"));
    const notebook = updates.find((row) => row.supplierSku === "NB-1");
    assert.equal(notebook.siteParent, "bilgisayar-tablet");
    assert.equal(notebook.siteMid, "tasinabilir-bilgisayarlar");
    assert.equal(notebook.siteChild, "notebooklar");
    assert.equal(notebook.active, undefined);
    const cpu = updates.find((row) => row.supplierSku === "CPU-1");
    assert.equal(cpu.siteParent, "bilgisayar-bilesenleri");
    assert.equal(cpu.siteMid, "islemciler");
    assert.equal(cpu.siteChild, "intel-islemciler");
    assert.equal(cpu.active, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("async XML category sync assigns the same leaves as the sync path", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "patygo-sync-async-"));
  const store = createCategoryStore(root);
  const updates = [];
  const manager = {
    listProducts() {
      return [
        {
          supplierSlot: "supplier-1",
          supplierSku: "NB-1",
          mainCategory: "KİŞİSEL BİLGİSAYARLAR",
          midCategory: "Taşınabilir Bilgisayarlar",
          subCategory: "Notebooklar",
        },
      ];
    },
    updateProducts(rows) {
      updates.push(...rows);
    },
  };
  try {
    const result = await syncXmlSiteCategoriesAsync({
      manager,
      categoryStore: store,
      slotId: "supplier-1",
      yieldEvery: 8,
    });
    assert.equal(result.empty, false);
    assert.equal(updates[0].siteParent, "bilgisayar-tablet");
    assert.equal(updates[0].siteMid, "tasinabilir-bilgisayarlar");
    assert.equal(updates[0].siteChild, "notebooklar");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("queryPublicCatalog pages and filters by site category", () => {
  const products = Array.from({ length: 60 }, (_, i) => ({
    id: "p-" + i,
    name: "Ürün " + i,
    brand: "PATYGO",
    price: 10 + i,
    category: i < 5 ? "bilgisayar-tablet" : "oem-cevre-birimleri",
    siteChild: i < 5 ? "notebook" : "islemciler",
    image: "https://cdn.example/p-" + i + ".jpg",
    active: true,
  }));
  const page1 = queryPublicCatalog(products, { page: 1, limit: 48 });
  assert.equal(page1.products.length, 48);
  assert.equal(page1.total, 60);
  assert.equal(page1.totalPages, 2);
  const notebooks = queryPublicCatalog(products, {
    kategori: "bilgisayar-tablet",
    alt: "notebook",
  });
  assert.equal(notebooks.total, 5);
  const one = queryPublicCatalog(products, { id: "p-3" });
  assert.equal(one.products[0].id, "p-3");
});

test("queryPublicCatalog sorts popular products by sales and views first", () => {
  const products = [
    {
      id: "quiet",
      name: "Sakin Ürün",
      brand: "NO-NAME",
      price: 50,
      category: "bilgisayar-tablet",
      active: true,
    },
    {
      id: "hot",
      name: "Popüler Ürün",
      brand: "NO-NAME",
      price: 50,
      category: "bilgisayar-tablet",
      active: true,
    },
    {
      id: "apple-box",
      name: "Apple Kutu",
      brand: "Apple",
      price: 200,
      category: "bilgisayar-tablet",
      image: "https://cdn.example/a.jpg",
      active: true,
    },
  ];
  const ranked = queryPublicCatalog(products, {
    kategori: "bilgisayar-tablet",
    sort: "popular",
    popularity: { hot: 80 },
    limit: 12,
  });
  assert.deepEqual(
    ranked.products.map((row) => row.id),
    ["hot", "apple-box", "quiet"]
  );
  assert.equal(ranked.products.length, 3);
});

test("homeFeaturedCatalog groups 12 popular products per ANA category", () => {
  const { homeFeaturedCatalog } = require("../lib/catalog");
  const parents = [
    "bilgisayar-tablet",
    "bilgisayar-bilesenleri",
    "kartus-toner",
    "baski-cozumleri",
    "yapi-gerecleri",
    "ofis-urunleri",
  ];
  const products = [];
  parents.forEach((slug) => {
    for (let i = 0; i < 15; i += 1) {
      products.push({
        id: slug + "-" + i,
        name: slug + " " + String(i).padStart(2, "0"),
        brand: "NO-NAME",
        price: 100,
        category: slug,
        active: true,
      });
    }
  });
  const featured = homeFeaturedCatalog(products, {
    popularity: { "bilgisayar-tablet-3": 500, "yapi-gerecleri-1": 400 },
    limit: 12,
  });
  assert.equal(featured.perCategory, 12);
  assert.equal(featured.byParent["bilgisayar-tablet"][0].id, "bilgisayar-tablet-3");
  assert.equal(featured.byParent["yapi-gerecleri"][0].id, "yapi-gerecleri-1");
  parents.forEach((slug) => {
    assert.equal(featured.byParent[slug].length, 12);
  });
  assert.equal(featured.products.length, 12);
  // "Tümü" global popüler sıralama: en yüksek skorlar önce (kategori round-robin değil)
  assert.equal(featured.products[0].id, "bilgisayar-tablet-3");
  assert.equal(featured.products[1].id, "yapi-gerecleri-1");
});

test("isHomeFeaturedSnapshotValid rejects incomplete featured snapshots", () => {
  const { isHomeFeaturedSnapshotValid } = require("../lib/catalog");
  assert.equal(
    isHomeFeaturedSnapshotValid({
      products: [{ id: "a", category: "bilgisayar-tablet" }],
      byParent: {},
    }),
    false
  );
  assert.equal(
    isHomeFeaturedSnapshotValid({
      products: [{ id: "a", category: "bilgisayar-tablet" }],
      byParent: { "bilgisayar-tablet": [{ id: "a" }] },
    }),
    true
  );
});

test("homeFeaturedCatalog Tümü list ranks global popularity before category mix", () => {
  const { homeFeaturedCatalog } = require("../lib/catalog");
  const products = [
    {
      id: "low-bt",
      name: "Sakin Tablet",
      brand: "NO-NAME",
      price: 100,
      category: "bilgisayar-tablet",
      active: true,
    },
    {
      id: "hot-toner",
      name: "HP Muadil Toner",
      brand: "NO-NAME",
      price: 100,
      category: "kartus-toner",
      active: true,
    },
    {
      id: "mid-comp",
      name: "RTX 4060 Ekran Kartı",
      brand: "MSI",
      price: 5000,
      category: "bilgisayar-bilesenleri",
      active: true,
    },
  ];
  const featured = homeFeaturedCatalog(products, {
    popularity: { "hot-toner": 900, "mid-comp": 100 },
    limit: 3,
  });
  assert.deepEqual(
    featured.products.map((row) => row.id),
    ["hot-toner", "mid-comp", "low-bt"]
  );
});

test("homeFeaturedCatalog prefers market-popular notebooks in bilgisayar-tablet", () => {
  const { homeFeaturedCatalog } = require("../lib/catalog");
  const products = [
    {
      id: "cpu",
      name: "Intel Core i3 10100",
      brand: "Intel",
      price: 4000,
      category: "bilgisayar-bilesenleri",
      active: true,
    },
    {
      id: "nb",
      name: "Lenovo IdeaPad Notebook 15",
      brand: "Lenovo",
      price: 18000,
      category: "bilgisayar-tablet",
      siteChild: "notebooklar",
      active: true,
    },
    {
      id: "phone",
      name: "Samsung Galaxy A55",
      brand: "Samsung",
      price: 16000,
      category: "bilgisayar-tablet",
      siteChild: "telefon",
      active: true,
    },
  ];
  const featured = homeFeaturedCatalog(products, { limit: 1 });
  assert.equal(featured.byParent["bilgisayar-tablet"][0].id, "nb");
});

test("homeFeaturedCatalog mixes ALT types inside an ANA instead of filling with notebooks", () => {
  const { homeFeaturedCatalog } = require("../lib/catalog");
  const products = [];
  for (let i = 0; i < 20; i += 1) {
    products.push({
      id: "nb-" + i,
      name: "Notebook " + i,
      brand: "NO-NAME",
      price: 1000,
      category: "bilgisayar-tablet",
      siteChild: "notebooklar",
      active: true,
    });
  }
  [
    ["mouse-1", "Mouse", "mouse"],
    ["klavye-1", "Klavye", "klavye"],
    ["monitor-1", "Monitor", "monitorler"],
    ["combo-1", "Set", "klavye-ve-mouse"],
  ].forEach(([id, name, child]) => {
    products.push({
      id,
      name,
      brand: "NO-NAME",
      price: 200,
      category: "bilgisayar-tablet",
      siteChild: child,
      active: true,
    });
  });
  const popularity = {};
  for (let i = 0; i < 20; i += 1) popularity["nb-" + i] = 900 - i;
  popularity["mouse-1"] = 10;
  popularity["klavye-1"] = 9;
  popularity["monitor-1"] = 8;
  popularity["combo-1"] = 7;
  const featured = homeFeaturedCatalog(products, { popularity, limit: 12 });
  const computers = featured.byParent["bilgisayar-tablet"];
  const alts = computers.map((row) => row.alt);
  assert.equal(computers[0].id, "nb-0");
  assert.ok(alts.includes("mouse"));
  assert.ok(alts.includes("klavye"));
  assert.ok(alts.includes("monitorler"));
  assert.ok(alts.includes("klavye-ve-mouse"));
  assert.equal(alts.filter((alt) => alt === "notebooklar").length, 8);
  assert.equal(new Set(alts.slice(0, 5)).size, 5);
});
