"use strict";

const SCHEMA_VERSION = 5;

const REQUIRED_PARENT_SLUGS = [
  "bilgisayar-tablet",
  "bilgisayar-bilesenleri",
  "kartus-toner",
  "baski-cozumleri",
  "yapi-gerecleri",
  "ofis-urunleri",
];

const NAV_PARENT_ORDER = REQUIRED_PARENT_SLUGS.slice();

const CATEGORY_QUERY_ALIASES = {
  "kisisel-bilgisayarlar": "bilgisayar-tablet",
  "oem-cevre-birimleri": "bilgisayar-bilesenleri",
  "cevre-baski-birimleri": "baski-cozumleri",
  "tuketici-elektronigi": "bilgisayar-bilesenleri",
  "kurumsal-ag-urunleri": "bilgisayar-tablet",
};

function node(name, children, xmlNames) {
  const row = { name };
  if (Array.isArray(children) && children.length) row.children = children;
  if (Array.isArray(xmlNames) && xmlNames.length) row.xmlNames = xmlNames;
  return row;
}

function canonicalCategoryTree() {
  return sortParentsForNav([
    node(
      "BASKI ÇÖZÜMLERİ",
      [
        node("Barkod Ürünleri", [
          node("Etiket Yazıcıları Şeritleri"),
          node("Barkod Okuyucular"),
          node("Barkod Yazıcılar"),
          node("Barkod Yazıcı Şeritleri"),
          node("Etiket Yazıcıları"),
          node("El Terminalleri"),
          node("Barkod Yazıcı Kağıtları"),
          node("Pos Yazıcılar"),
          node("Kart Yazıcılar"),
        ]),
        node("Yazıcı - Tarayıcı", [
          node("Inkjet Çok Fonksiyonlu"),
          node("Inkjet Yazıcılar"),
          node("Mono Laser Çok Fonksiyonlu"),
          node("Mono Laser"),
          node("Tarayıcılar"),
          node("Renkli Laser Çok Fonksiyonlu"),
          node("Renkli Laser"),
          node("Matris Yazıcılar"),
        ]),
        node("UPS (Kesintisiz Güç Kaynağı)", [node("Online UPS"), node("Line-Interactive UPS")], [
          "UPS",
        ]),
      ],
      ["ÇEVRE & BASKI BİRİMLERİ"]
    ),
    node("YAPI GEREÇLERİ", [
      node("Hırdavat Ürünleri", [
        node("Ölçü ve Test Aletleri"),
        node("Tornavida - Alyans Setleri"),
        node("Eldivenler"),
        node("Silikon Tabancası"),
        node("Havya ve Lehim teli"),
        node("Şerit ve Lazer Metre"),
        node("Elektrik ve Eriyent Bant"),
        node("Anahtarlar"),
        node("Takım Çantaları"),
        node("Fırça - Testere"),
        node("Yankeski - Kargaburnu - Pense"),
      ]),
      node("Elektrik Ürünleri", [
        node("Prizler"),
        node("Kapı Zilleri"),
        node("Akıllı Prizler"),
        node("Akım Korumalı Prizler"),
        node("Çeşitli Adaptörler"),
        node("Inverterler"),
      ]),
      node("Aydınlatma Ürünleri", [
        node("Fenerler"),
        node("Masa Lambaları"),
        node("Ampuller"),
        node("Işıldaklar"),
        node("Dış Cephe Aydınlatma"),
        node("USB Hub"),
      ]),
      node("Deterjan ve Temizlik", [node("Oda Kokusu")]),
    ]),
    node(
      "OFİS ÜRÜNLERİ",
      [
        node("Pil - Şarj - Batarya Ürünleri", [
          node("PowerBank"),
          node("Küçük Piller"),
          node("Akü ve Akü Şarj Cihazları"),
          node("Şarjlı Piller"),
          node("Pil Şarj Cihazları"),
          node("İnce Kalem Pil"),
          node("Kalem Pil"),
          node("Telsiz Telefon Pilleri"),
          node("9V Pil"),
          node("Büyük Boy Pil"),
          node("Orta Boy Pil"),
        ]),
        node("Hesap Makineleri ve Sözlük", [
          node("Masaüstü Makineler"),
          node("Cep Tipi Makineler"),
          node("FX Bilimsel Makineler"),
          node("Pro.Masaüstü Makineler"),
          node("Grafik Çiz. Bilimsel Makineler"),
          node("Şeritli Makineler"),
          node("Hes.Mak.Sarf Malzemeleri"),
          node("Finansal Makineler"),
        ]),
        node("Telefon - Telsiz Çeşitleri", [
          node("Cep Telefonları"),
          node("Telsiz Telefonlar"),
          node("IP Telefonlar"),
          node("Masaüstü Telefonlar"),
          node("Pmr El Telsizler"),
          node("Santral - Bileşenleri"),
          node("Telefon Kulaklıkları"),
          node("Duvar Tipi Telefon"),
        ]),
        node("Ofis Gıda", [node("Çay Kahve Ürünleri")]),
        node("Temizlik Ürünleri", [node("Bezler ve Setler"), node("Sprey ve Köpükler")]),
        node("Personel Devam Kontrol Sistemleri", [
          node("PDKS Cihazları"),
          node("Turnike Bariyer Ürünleri"),
        ]),
        node("Kağıt Ürünleri", [
          node("Gramajlı Kağıtlar"),
          node("Fotokopi Kağıtları"),
          node("Kağıt İmha Makineleri"),
          node("Fotoğraf Kağıtları"),
        ]),
        node("Banyo Ürünleri", [node("Sıvı Sabun"), node("Kronometre")]),
        node("Kırtasiye Ürünleri", [node("Okul Çantaları")]),
        node("Para Sayma ve Kontrol Cihazı", [node("Para Kontrol Cihazı")]),
        node("Deterjan ve Temizlik", [
          node("Oda Kokusu"),
          node("Kolonya"),
          node("Islak Mendiller"),
          node("Oto Kokusu"),
          node("Tuvalet Kağıtları"),
          node("Duş Jeli"),
          node("Sıvı Sabun"),
          node("Şampuan"),
        ]),
        node("Projeksiyon Ürünleri", [
          node("Projeksiyonlar"),
          node("Projeksiyon Perdeleri"),
          node("Sunum Kumandası"),
          node("Projeksiyon Asma Aparatları"),
        ]),
        node("Kameralar", [
          node("Ip Kameralar"),
          node("Analog Kameralar"),
          node("Ahd Kameralar"),
          node("Speed Dome Kamera"),
          node("Hd-Tvi Kameralar"),
        ]),
        node("Kayıt Cihazları", [
          node("Nvr Kayıt Cihazları"),
          node("Dvr Kayıt Cihazları"),
          node("Araç Kameraları"),
          node("Ahd Kayıt Cihazları"),
        ]),
        node("Güvenlik Ürünü Aksesuarları", [
          node("Kamera Ayakları"),
          node("CCTV Kablolar"),
          node("Güvenlik Adaptörleri"),
          node("Güvenlik Bağlantı Ürünleri"),
        ]),
      ],
      ["GÜVENLİK SİSTEMLERİ", "KİŞİSEL BAKIM VE KOZMETİK"]
    ),
    node(
      "BİLGİSAYAR / TABLET",
      [
        node("Taşınabilir Bilgisayarlar", [
          node("Notebooklar"),
          node("Tabletler"),
          node("Grafik Tabletler"),
        ]),
        node("Bilgisayarlar", [node("Masaüstü Bilgisayarlar"), node("All-In-One-PC")], [
          "Masaüstü Bilgisayarlar",
        ]),
        node("Monitörler ve Aks.", [
          node("Monitörler", null, ["LED Monitörler"]),
          node("Askı ve Stand", null, ["Monitör Askı ve Standları"]),
        ], ["Monitörler"]),
        node("Klavye - Mouse Ürünleri", [
          node("Mouse"),
          node("Klavye"),
          node("Klavye ve Mouse"),
        ]),
        node("Bilgisayar Aksesuarları", [
          node("Notebook Çantaları"),
          node("Notebook Adaptörleri"),
          node("Notebook Stand ve Soğutucu"),
          node("Mouse Pad"),
          node("Notebook Bataryaları"),
          node("Notebook Klavye Etiketleri"),
        ]),
        node("Diskler", [
          node("Harddisk Kılıfları"),
          node("Harddiskler"),
          node("SSD Diskler"),
          node("PC Harddiski - SATA"),
          node("Harici Diskler (External)"),
          node("Harddisk Kutuları"),
          node("Notebook Harddisk Sürücü Yuvası"),
        ], ["Harddiskler"]),
        node("Yazılım Ürünleri", [
          node("Antivirüs ve Int. Security"),
          node("İşletim Sistemleri"),
          node("Office"),
          node("Sunucu ve Veri"),
        ]),
        node("Ağ Ürünleri", [
          node("Access Point ve Router"),
          node("WIFI Adaptörler"),
          node("Ethernet Kartları"),
          node("Menzil Genişleticiler"),
          node("Powerline Adaptörler"),
          node("Anten ve Anten Kabloları"),
        ]),
        node("Modem ve Switch", [node("Switch ve Hub Çeşitleri"), node("DSL Modemler")]),
        node("KVM Switch ve Printserver", [
          node("HDMI Switch ve Çoklayıcı"),
          node("KVM Switch"),
          node("VGA Switch ve Çoklayıcı"),
          node("Sinyal Uzatıcılar (Extender)"),
        ]),
      ],
      ["KİŞİSEL BİLGİSAYARLAR", "KURUMSAL & AĞ ÜRÜNLERİ"]
    ),
    node(
      "BİLGİSAYAR BİLEŞENLERİ",
      [
        node("Bellekler", [
          node("PC Belleği DDR3"),
          node("PC Belleği DDR4"),
          node("PC Belleği DDR5"),
          node("Notebook Belleği DDR3"),
          node("Notebook Belleği DDR4"),
        ]),
        node("Kasalar", [node("ATX Kasalar"), node("Power Supply"), node("Kasa Aksesuarları")]),
        node("Ekran Kartları", [node("PCI-Ex Ekran Kartları")]),
        node("İşlemciler", [node("Intel İşlemciler"), node("Amd İşlemciler")]),
        node("Anakartlar", [node("Intel Anakartlar"), node("Amd Anakartlar")]),
        node("Soğutucular - Overclock", [
          node("İşlemci Fanları"),
          node("Kasa Fanları"),
          node("Termal Macunlar"),
          node("Soğutucular - Overclock"),
        ]),
        node("TV ve Ses Kartları", [node("Ses Kartları"), node("TV Box")]),
        node("PCI Kartlar", [node("PCI Express Kartlar")]),
        node("Kulaklık ve Mikrofon ve Webcam", [
          node("Kulaklıklı Mikrofonlar"),
          node("Bluetooth Kulaklıklar"),
          node("MP3 ve MP4 Kulaklıklar"),
          node("Webcam"),
          node("Mikrofon"),
          node("PC Kulaklıklar"),
          node("Usb Kulaklıklar"),
        ]),
        node("USB ve Kart Bellek Ürünleri", [
          node("USB Flash", null, ["USB Bellekler", "USB Bellek"]),
          node("Micro SD Kartlar"),
          node("SD Kartlar"),
        ]),
        node("USB Ürünleri", [
          node("USB Hub"),
          node("USB Fanlar"),
          node("Kart Okuyucu"),
          node("Bluetooth Adaptör"),
        ]),
        node("Ses Sistemleri", [
          node("Anfi Sistemler"),
          node("Pikap (Plakçalar)"),
          node("Bluetooth Speaker"),
        ]),
        node("Saat ve Uzaktan Kumandalar", [node("Akıllı Saat ve Bileklik"), node("Saatler")]),
        node("Televizyon", [node("TV Askı Aparatları")]),
      ],
      ["OEM & ÇEVRE BİRİMLERİ", "TÜKETİCİ ELEKTRONİĞİ"]
    ),
    node(
      "KARTUŞ TONER",
      [
        node("Yazıcı Tüketim Ürünleri (Orj.)", [
          node("Laser Tonerler"),
          node("Inkjet Kartuşlar"),
          node("Plotter Kartuşlar"),
          node("Drumlar"),
          node("3D Yazıcı Flamentleri"),
          node("Fuser"),
          node("Atık Toner Kutusu"),
          node("Bakım Kiti (Maintenance)"),
          node("Belt Cleaner"),
        ]),
        node("Yazıcı Tüketim Ürünleri (Muadil)", [
          node("Muadil Laser Tonerler"),
          node("Muadil Inkjet Kartuşlar"),
          node("Muadil Şeritler"),
          node("Muadil Drumlar"),
        ]),
        node("Fotokopi Tüketim", [
          node("Fotokopi Tonerler"),
          node("Fotokopi Mürekkepler"),
          node("Fotokopi Atık Kutuları"),
        ]),
        node("Faks Tüketim Ürünleri", [node("Faks Tonerler")]),
      ],
      ["TÜKETİM ÜRÜNLERİ"]
    ),
  ]);
}

function sortParentsForNav(tree) {
  const rank = new Map(NAV_PARENT_ORDER.map((slug, index) => [slug, index]));
  rank.set("BİLGİSAYAR / TABLET", 0);
  rank.set("BİLGİSAYAR BİLEŞENLERİ", 1);
  rank.set("KARTUŞ TONER", 2);
  rank.set("BASKI ÇÖZÜMLERİ", 3);
  rank.set("YAPI GEREÇLERİ", 4);
  rank.set("OFİS ÜRÜNLERİ", 5);
  return (Array.isArray(tree) ? tree : []).slice().sort((left, right) => {
    const leftKey = rank.has(left && left.slug)
      ? left.slug
      : rank.has(left && left.name)
        ? left.name
        : "";
    const rightKey = rank.has(right && right.slug)
      ? right.slug
      : rank.has(right && right.name)
        ? right.name
        : "";
    const leftRank = leftKey ? rank.get(leftKey) : 100;
    const rightRank = rightKey ? rank.get(rightKey) : 100;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return 0;
  });
}

function hasCanonicalParents(tree) {
  const slugs = new Set((Array.isArray(tree) ? tree : []).map((row) => row && row.slug).filter(Boolean));
  return REQUIRED_PARENT_SLUGS.every((slug) => slugs.has(slug));
}

function resolveCategoryQuerySlug(slug) {
  const key = String(slug || "").trim();
  if (!key) return "";
  if (Object.prototype.hasOwnProperty.call(CATEGORY_QUERY_ALIASES, key)) {
    return CATEGORY_QUERY_ALIASES[key] || "";
  }
  return key;
}

module.exports = {
  SCHEMA_VERSION,
  REQUIRED_PARENT_SLUGS,
  NAV_PARENT_ORDER,
  CATEGORY_QUERY_ALIASES,
  canonicalCategoryTree,
  sortParentsForNav,
  hasCanonicalParents,
  resolveCategoryQuerySlug,
};
