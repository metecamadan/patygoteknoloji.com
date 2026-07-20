# Admin XML Kataloğu — TDD Kanıtı

## Kaynak ve kullanıcı yolculukları

Kaynak plan: `admin_xml_kataloğu_08cea1dd.plan.md` (plan dosyası değiştirilmedi).

- Yönetici, üç izinli tedarikçi XML kaynağını birbirinden bağımsız kaydedip yenileyebilir.
- XML ürünleri varsayılan pasif gelir; fiyat ve kâr override’ları sunucuda kalıcı tutulur.
- Aktif manuel ve tedarikçi ürünleri tek web kataloğunda birleşir.
- Yönetici ürünleri kaynak, kategori ve durumla filtreleyebilir; XML ürünlerini topluca açıp kapatabilir.
- Akakçe feed’i yalnızca aktif, stokta ve zorunlu alanları tamamlanmış ürünleri içerir.

## RED kanıtı

Komut: `npm test`

Yeni testler ilk çalıştırmada 7 beklenen hata üretti:

- Güvenli fetch ve atomik yazma yardımcıları dışa aktarılmamıştı.
- IPv4-mapped özel IPv6 adresleri engellenmiyordu.
- Tedarikçi allowlist’i boşken fail-closed davranmıyordu.
- Birleşik katalog modülü ve feed uygunluk analizi yoktu.

## GREEN kanıtı

Komut: `npm run test:coverage`

- 20 test geçti, hata veya atlanan test yok.
- Satır kapsamı: `%88.76`
- Fonksiyon kapsamı: `%83.78`
- Dal kapsamı: `%58.30`

Testlerin garanti ettiği davranışlar:

1. XML alanları, Türkçe sayı formatı ve görsel URL’leri normalize edilir.
2. Allowlist, private IP, mapped IPv6, boyut limiti ve timeout kontrolleri çalışır.
3. Runtime JSON yazımı atomiktir; geçici dosya bırakmaz.
4. Ürünler pasif staging’e alınır; genel/ürün kârı ve özel fiyat kuralları uygulanır.
5. Manuel ve aktif tedarikçi ürünleri çakışma olmadan birleşir.
6. Akakçe XML değerleri escape edilir, KDV eklenir ve uygunsuz ürünler nedenleriyle dışlanır.
7. Admin tedarikçi API’leri yetkilendirme ister; gizli veri dosyaları statik sunulmaz.
8. CSP, HSTS ve temel güvenlik başlıkları yanıtlarda bulunur.
9. Admin HTML kimlikleri benzersizdir; kaynak filtresi ve ürün bazlı kâr alanı mevcuttur.
10. Üç XML kaynağının ayarları, ürünleri ve override’ları birbirinden izole kalır.
11. Ürünler bölümü manuel ve XML ürünlerini iki erişilebilir alt sekmede ayırır.

## Ek doğrulamalar

- `node --check`: Sunucu, katalog, XML ve admin JavaScript dosyaları geçerli.
- `html-validate`: Admin HTML semantik kontrolü geçti.
- `npm audit --omit=dev`: Bilinen güvenlik açığı yok.
- `npm audit signatures`: 9 paket imzası ve 1 provenance doğrulaması başarılı.
- İzole tarayıcı testi: Masaüstü/mobil panel, sekmeler, filtreler, XML tablosu, console ve ağ kontrolleri geçti.

## Bilinen canlı öncesi doğrulama

Akakçe’nin mağazaya özel teknik örneği geldiğinde alan adları ve zorunlu alan seti son kez karşılaştırılmalıdır. Feed adresi Akakçe paneline tanımlanmadan ürünler platformda otomatik yayına girmez.
