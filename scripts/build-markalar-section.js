/** Emits brand category HTML fragments for markalar.html */
const tiles = (items) =>
  items
    .map(
      ([file, alt, desc]) =>
        `            <article class="brand-tile"><div class="logo"><img src="assets/img/brands/${file}.svg" alt="${alt}" width="170" height="48" loading="lazy" /></div><p>${desc}</p></article>`
    )
    .join("\n");

const pc = [
  ["apple", "Apple", "Mac, iPad ve kurumsal Apple ürünleri"],
  ["lenovo", "Lenovo", "ThinkPad, masaüstü ve iş istasyonları"],
  ["hp", "HP", "Notebook, workstation ve çevre birimleri"],
  ["dell", "Dell", "Latitude, OptiPlex ve sunucu çözümleri"],
  ["asus", "ASUS", "Dizüstü, anakart ve gaming serileri"],
  ["acer", "Acer", "Kurumsal ve eğitim bilgisayarları"],
  ["microsoft", "Microsoft", "Surface ve Microsoft ekosistemi"],
  ["huawei", "Huawei", "Laptop, tablet ve ağ ürünleri"],
  ["msi", "MSI", "Gaming ve iş istasyonu çözümleri"],
  ["gigabyte", "Gigabyte", "Anakart, ekran kartı ve sistem"],
  ["intel", "Intel", "İşlemci ve NUC çözümleri"],
  ["amd", "AMD", "İşlemci ve grafik çözümleri"],
  ["logitech", "Logitech", "Klavye, mouse ve konferans"],
  ["everest", "Everest", "Yerli bilgisayar ve çevre birimleri"],
  ["razer", "Razer", "Gaming çevre birimleri"],
  ["corsair", "Corsair", "Bellek, kasa ve güç kaynakları"],
  ["kingston", "Kingston", "SSD, RAM ve bellek ürünleri"],
  ["casper", "Casper", "Yerli dizüstü ve masaüstü"],
  ["monster", "Monster", "Gaming notebook serileri"],
  ["toshiba", "Toshiba", "Depolama ve kurumsal donanım"],
  ["fujitsu", "Fujitsu", "Kurumsal PC ve sunucu"],
  ["benq", "BenQ", "Monitör ve projeksiyon"],
  ["viewsonic", "ViewSonic", "Monitör ve görüntü çözümleri"],
  ["tplink", "TP-Link", "Ağ ve Wi-Fi ekipmanları"],
  ["cisco", "Cisco", "Kurumsal ağ altyapısı"],
];

const mobile = [
  ["samsung", "Samsung", "Galaxy, TV ve ekran çözümleri"],
  ["apple", "Apple", "iPhone, iPad ve aksesuar"],
  ["xiaomi", "Xiaomi", "Akıllı telefon ve IoT ürünleri"],
  ["huawei", "Huawei", "Telefon, tablet ve giyilebilir"],
  ["lg", "LG", "TV, monitör ve ev elektroniği"],
  ["sony", "Sony", "TV, ses ve görüntü sistemleri"],
  ["oppo", "OPPO", "Akıllı telefon ve aksesuar"],
  ["vivo", "vivo", "Akıllı telefon serileri"],
  ["honor", "Honor", "Telefon ve tablet ürünleri"],
  ["oneplus", "OnePlus", "Flagship telefon çözümleri"],
  ["google", "Google", "Pixel telefon ve Nest ürünleri"],
  ["duracell", "Duracell", "Pil ve güç çözümleri"],
  ["dji", "DJI", "Drone, gimbal ve kamera sistemleri"],
  ["panasonic", "Panasonic", "TV ve görüntü sistemleri"],
  ["gopro", "GoPro", "Aksiyon kamera ve aksesuar"],
  ["garmin", "Garmin", "Akıllı saat ve navigasyon"],
  ["jbl", "JBL", "Hoparlör ve kulaklık"],
  ["bose", "Bose", "Premium ses sistemleri"],
  ["beats", "Beats", "Kulaklık ve ses aksesuarı"],
  ["philips", "Philips", "Kişisel bakım ve ev elektroniği"],
  ["anker", "Anker", "Şarj ve güç bankası"],
  ["marshall", "Marshall", "Premium hoparlör ve ses"],
  ["nikon", "Nikon", "Fotoğraf makinesi ve lens"],
  ["braun", "Braun", "Kişisel bakım ürünleri"],
];

const home = [
  ["arcelik", "Arçelik", "Beyaz eşya ve küçük ev aletleri"],
  ["beko", "Beko", "Buzdolabı, çamaşır ve mutfak"],
  ["vestel", "Vestel", "TV, klima ve beyaz eşya"],
  ["bosch", "Bosch", "Ankastre ve beyaz eşya"],
  ["siemens", "Siemens", "Premium beyaz eşya"],
  ["dyson", "Dyson", "Süpürge ve bakım ürünleri"],
  ["korkmaz", "Korkmaz", "Mutfak ve küçük ev aletleri"],
  ["profilo", "Profilo", "Beyaz eşya çözümleri"],
  ["karcher", "Kärcher", "Basınçlı yıkama ve temizlik"],
  ["regal", "Regal", "Beyaz eşya serileri"],
  ["grundig", "Grundig", "Ev aletleri ve elektronik"],
  ["electrolux", "Electrolux", "Beyaz eşya ve mutfak"],
  ["whirlpool", "Whirlpool", "Çamaşır ve mutfak ürünleri"],
  ["miele", "Miele", "Premium ev aletleri"],
  ["hotpoint", "Hotpoint", "Beyaz eşya çözümleri"],
  ["indesit", "Indesit", "Pratik beyaz eşya"],
  ["tefal", "Tefal", "Mutfak ve pişirme ürünleri"],
  ["fakir", "Fakir", "Küçük ev aletleri"],
  ["homend", "Homend", "Mutfak robotları ve aletler"],
  ["schafer", "Schafer", "Mutfak ve ev ürünleri"],
  ["rowenta", "Rowenta", "Ütü ve bakım ürünleri"],
  ["arzum", "Arzum", "Mutfak ve kişisel bakım"],
  ["smeg", "Smeg", "Premium tasarım beyaz eşya"],
  ["kitchenaid", "KitchenAid", "Mutfak robotları ve aletler"],
];

const print = [
  ["epson", "Epson", "Tanklı ve lazer yazıcılar"],
  ["canon", "Canon", "Yazıcı, tarayıcı ve görüntü"],
  ["brother", "Brother", "Ofis yazıcı ve etiket"],
  ["hp-print", "HP", "LaserJet ve ofis yazıcıları"],
  ["xerox", "Xerox", "Kurumsal baskı çözümleri"],
  ["kyocera", "Kyocera", "A3/A4 çok fonksiyonlu"],
  ["ricoh", "Ricoh", "Kurumsal MFP çözümleri"],
  ["lexmark", "Lexmark", "Ofis yazıcı sistemleri"],
  ["seagate", "Seagate", "HDD, SSD ve yedekleme"],
  ["oki", "OKI", "LED ve etiket yazıcılar"],
  ["konica", "Konica Minolta", "Kurumsal baskı sistemleri"],
  ["zebra", "Zebra", "Barkod ve etiket yazıcı"],
  ["wd", "Western Digital", "Depolama ve SSD çözümleri"],
  ["honeywell", "Honeywell", "Barkod ve mobil yazıcı"],
  ["dymo", "DYMO", "Etiketleme çözümleri"],
  ["sandisk", "SanDisk", "Bellek kartı ve USB depolama"],
  ["kodak", "Kodak", "Tarayıcı ve görüntü"],
  ["fujifilm", "FUJIFILM", "Görüntü ve baskı çözümleri"],
  ["3m", "3M", "Ofis ve güvenlik ürünleri"],
  ["logitech-print", "Logitech", "Webcam ve konferans"],
  ["samsung-print", "Samsung", "Lazer yazıcı serileri"],
  ["nikon-print", "Nikon", "Görüntü ve baskı aksesuarı"],
  ["fujitsu-scan", "Fujitsu", "Doküman tarayıcıları"],
  ["energizer", "Energizer", "Pil ve güç çözümleri"],
];

function section(title, sub, items) {
  return `        <div class="brand-cat reveal">
          <div class="brand-cat-head">
            <h3>${title}</h3>
            <span>${sub} · ${items.length} marka</span>
          </div>
          <div class="brand-grid">
${tiles(items)}
          </div>
        </div>`;
}

const out = [
  section("Bilgisayar &amp; BT", "Kurumsal donanım", pc),
  section("Mobil &amp; Tüketici Elektroniği", "Telefon, TV, ses", mobile),
  section("Beyaz Eşya &amp; Ev Aletleri", "Mutfak ve yaşam", home),
  section("Yazıcı &amp; Çevre Birimleri", "Ofis ekipmanları", print),
].join("\n\n");

const fs = require("fs");
const path = require("path");
fs.writeFileSync(path.join(__dirname, "markalar-brands.fragment.html"), out);
console.log("pc", pc.length, "mobile", mobile.length, "home", home.length, "print", print.length);
console.log("fragment written");
