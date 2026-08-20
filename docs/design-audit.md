# Patygo — Product Designer denetim raporu

**Tarih:** 2026-08-17  
**Kapsam:** Vitrin (`*.html`, `assets/css/style.css`, storefront JS) + Admin (`admin.html`, `assets/css/admin.css`, `assets/js/admin.js`)  
**Canlı:** https://patygoteknoloji.com

Öncelik: **Y**üksek · **O**rta · **D**üşük

---

## Vitrin (storefront)

### Ana sayfa
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| V1 | Y | Öne çıkan sekmeler `<a>` ama JS filtre; orta tık / JS kapalıyken yanlış navigasyon | `role="tablist"` + `button` veya saf link listesi | `index.html`, `catalog.js` |
| V2 | O | Hero istatistikleri (“43+ Marka”) kanıtsız | Doğrulanabilir metin: KDV dahil, 3D Secure, faturalı satış | `index.html` |
| V3 | O | B2C vitrin + kurumsal Teklif formu aynı sayfada rekabet ediyor | Teklif’i ayrı landing veya iki net hero yolu | `index.html`, `main.js` |
| V4 | O | Öne çıkan kartta yalnızca Sepete Ekle; detay yolu belirsiz | “İncele” secondary veya daha belirgin başlık linki | `catalog.js` |
| V5 | D | Marka bandı düz metin | Logo tile veya `/markalar` linkli grid | `index.html` |

### Katalog
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| V6 | Y | Arama ve sıralama UI yok | Header/katalog üstü arama + sıra (`q`, `sira`) | `urunler.html`, `catalog.js`, API |
| V7 | Y | Ürün listesi tamamen JS; yavaş ağ / bot riski | İlk sayfa skeleton veya SSR tohum | `urunler.html`, sunucu |
| V8 | O | Yalnızca sonsuz kaydırma; konum kaybı | Sayfa göstergesi veya “Yukarı” + toplam | `catalog.js`, `urunler.html` |
| V9 | O | Marka filtresi anında, fiyat “Uygula” — tutarsız | Tek etkileşim modeli | `catalog.js` |
| V10 | O | Mobilde aktif filtre chip’leri görünmüyor | Sonuç üstü “Marka: HP ×” chip’leri | `catalog.js`, `style.css` |

### Ürün detay
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| V11 | Y | Adet seçici yok (listede var) | `createQtyStepper` detayda da | `urun-detay.js` |
| V12 | Y | Stok / teslimat / kargo CTA yakınında yok | Stok + güven micro-copy | `urun-detay.js`, `urun-detay.html` |
| V13 | O | “Sepete eklendi” kalıcı; listede timeout var | Aynı toast/reset pattern | `urun-detay.js` |
| V14 | O | Uzun `details` düz metin | Accordion veya spec tablosu | `urun-detay.js`, `style.css` |
| V15 | O | Görsel zoom yok | Lightbox + klavye kapat | `urun-detay.js` |

### Sepet / ödeme
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| V16 | Y | Sepet “sipariş talebi, ödeme alınmaz” vs ödeme “Güvenli Ödemeye Geç” çelişkisi | Tek huni dili (gerçek POS akışına göre) | `sepet.js`, `odeme.html`, `checkout.js` |
| V17 | Y | CTA: boş “Ödemeye geç” / dolu “Sipariş talebine geç” | Tek etiket | `sepet.js` |
| V18 | Y | KDV dili karışık (dahil/hariç satırlar) | B2C standardı: satırlar KDV dahil + altta döküm | `sepet.html`, `odeme.html`, JS |
| V19 | O | Huni adım göstergesi yok | Sepet → Bilgiler → Ödeme progress | `sepet.html`, `odeme.html`, `style.css` |
| V20 | O | Ödeme özetinde ürünler virgülle tek satır | Mini satır listesi veya “Sepeti düzenle” | `checkout.js` |
| V21 | O | Teslimat = fatura için “Aynı adres” yok | Checkbox + otomatik doldur | `odeme.html`, `checkout.js` |
| V22 | O | Başarı sonrası “Sepete dön” (sepet boş) | “Alışverişe devam et” | `odeme.html`, `checkout.js` |

### Navigasyon / mobil / a11y
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| V23 | Y | Nav async; hata da menü boş | Skeleton + statik fallback | `nav.js` |
| V24 | Y | `:focus-visible` yalnızca formda | Global brand ring tüm buton/link | `style.css` |
| V25 | Y | Skip link yok | “Ana içeriğe geç” | Tüm storefront HTML |
| V26 | O | Sepet/ödemede nav gizli; katalog dönüşü zor | Minimal “Alışverişe devam” | `style.css`, `sepet.html`, `odeme.html` |
| V27 | O | Mobilde sepet satırı 2 kolon karma | Tek sütun kart layout | `style.css` |
| V28 | O | Filtre butonunda aktif sayı badge yok | `Filtrele (2)` | `catalog.js`, `style.css` |
| V29 | O | Inline `style=` dağınık | Utility sınıfları | HTML, JS |
| V30 | O | Marka etiketi UPPERCASE vs `prettyBrandName` | Tek görsel kural | `catalog.js`, `style.css` |

---

## Admin panel

### Layout / IA
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| A1 | Y | Overview aşırı uzun; operasyonel odak kayboluyor | 4–6 eylem KPI üstte; detay katmanlı | `admin.html`, `admin.js`, `admin.css` |
| A2 | Y | “Sistem hazır” rozeti statik/yanıltıcı | API durumuna bağla | `admin.html`, `admin.js` |
| A3 | Y | Üç paralel kategori modeli (site / feed / ağaç) | Tek cascade kaynak | `admin.html`, `admin.js` |
| A4 | O | Unicode nav ikonları tutarsız | SVG ikon seti | `admin.html`, `admin.css` |
| A5 | O | Sekme durumu kısmen hatırlanıyor | Tüm tab + alt görünüm persist | `admin.js` |
| A6 | O | Akakçe feed Overview + XML’de tekrar | Overview özet, detay XML sekmesi | `admin.html`, `admin.js` |

### Ürün / XML
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| A7 | Y | Kategori filtresi HTML’de hardcoded | API’den doldur | `admin.html`, `admin.js` |
| A8 | Y | Ürün modal tek dev form | Bölümlü form + sticky Kaydet | `admin.html`, `admin.css`, `admin.js` |
| A9 | Y | XML tablo 11 sütun; çift scroll | Sticky ilk sütun, sütun gizleme, mobil kart | `admin.html`, `admin.css`, `admin.js` |
| A10 | Y | Satır içi edit anında PATCH; geri al yok | Düzenle modu + onay | `admin.js` |
| A11 | O | Slot 1’de “Siteye yayınla”, 2–3’te yok | Üç slotta aynı aksiyon seti | `admin.html`, `admin.js` |
| A12 | O | `is-critical-stock` CSS yok | Görsel vurgu | `admin.css`, `admin.js` |
| A13 | O | Toplu yayın onaysız | Özet modal (X ürün, Y atlanır) | `admin.js` |

### Siparişler / formlar
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| A14 | Y | Sipariş arama / tarih filtresi yok | Toolbar arama + tarih | `admin.html`, `admin.js`, API |
| A15 | Y | Kaydet disabled; alan bazlı hata yok | `.field.is-invalid` + mesaj | `admin.js`, `admin.css` |
| A16 | O | Modal focus trap yok | Trap + Escape + odak dönüşü | `admin.js` |
| A17 | O | Durum filtresi seçili siparişi sıfırlıyor | URL hash veya uyarı | `admin.js` |
| A18 | O | Kategori havuzu vs XML Ürünleri çakışması | Tek canonical ekran | `admin.html`, `admin.js` |

### Mobil / dark mode
| # | P | Problem | Öneri | Dosya |
|---|---|---------|-------|-------|
| A19 | Y | `<800px` sidebar yatay scroll; alt menü gizli | Drawer veya bottom tab | `admin.html`, `admin.css`, `admin.js` |
| A20 | Y | Uzun modal mobilde Kaydet altta kaybolur | Sticky footer / full-screen sheet | `admin.css`, `admin.html` |
| A21 | O | Mobilde health badge tamamen gizli | Kompakt ikon | `admin.css` |
| A22 | D | Tema toggle “Dark/Light” İngilizce | “Koyu / Açık” | `admin.html`, `admin.js` |

---

## Öncelikli sprint (Designer → Frontend)

1. **V16–V18** — Sepet/ödeme copy ve KDV dili birleştirme  
2. **V6** — Katalog arama (en az marka/ad filtre UI)  
3. **V24–V25** — Focus-visible + skip link  
4. **V11** — Detay adet stepper  
5. **A2, A15** — Admin sağlık rozeti + form validation  
6. **A14** — Sipariş arama  

---

*Sonraki tarama: büyük vitrin veya admin değişikliği öncesi Designer agent günceller.*
