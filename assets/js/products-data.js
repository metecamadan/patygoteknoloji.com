/**
 * ============================================================
 * PATYGO ÜRÜN KATALOĞU — TEK YÖNETİM NOKTASI
 * ============================================================
 * Yeni ürün eklemek için bu listeye bir nesne ekleyin.
 * Değişiklik sonrası siteyi yenileyin; index, urunler ve ödeme
 * sayfaları bu listeden beslenir.
 *
 * Alanlar:
 *  id        → benzersiz kod (odeme.html?id=BU_DEGER)
 *  brand     → marka etiketi (APPLE, HP …)
 *  name      → ürün adı
 *  price     → KDV hariç fiyat (sayı, örn. 12999)
 *  category  → bilgisayar | yazici | kucuk-ev | beyaz-esya
 *  featured  → true ise ana sayfada da görünür
 *  active    → false yaparsanız siteden gizlenir (silmeye gerek yok)
 * ============================================================
 */
window.PATYGO_PRODUCTS = [
  {
    id: "macbook-air-m3",
    brand: "APPLE",
    name: 'MacBook Air 13" M3 8/256GB',
    price: 52999,
    category: "bilgisayar",
    featured: true,
    active: true,
  },
  {
    id: "thinkpad-e16",
    brand: "LENOVO",
    name: "ThinkPad E16 i7 16/512GB",
    price: 38499,
    category: "bilgisayar",
    featured: true,
    active: true,
  },
  {
    id: "probook-450",
    brand: "HP",
    name: "ProBook 450 G10 i5 16/512GB",
    price: 29999,
    category: "bilgisayar",
    featured: true,
    active: true,
  },
  {
    id: "epson-l3560",
    brand: "EPSON",
    name: "EcoTank L3560 Wi-Fi Tanklı",
    price: 8749,
    category: "yazici",
    featured: true,
    active: true,
  },
  {
    id: "dyson-v15",
    brand: "DYSON",
    name: "V15 Detect Absolute Süpürge",
    price: 27499,
    category: "kucuk-ev",
    featured: true,
    active: true,
  },
  {
    id: "arcelik-9103",
    brand: "ARÇELİK",
    name: "9103 NFY A++ No-Frost Buzdolabı",
    price: 34499,
    category: "beyaz-esya",
    featured: true,
    active: true,
  },
  {
    id: "philips-airfryer",
    brand: "PHILIPS",
    name: "Airfryer XXL 5000 Series",
    price: 9999,
    category: "kucuk-ev",
    featured: true,
    active: true,
  },
  {
    id: "hp-m404dn",
    brand: "HP",
    name: "LaserJet Pro M404dn",
    price: 12499,
    category: "yazici",
    featured: true,
    active: true,
  },
];
