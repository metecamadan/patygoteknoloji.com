# Ürün açıklama sistemi

## Amaç

Vitrindeki tüm ürünlerde Lenovo V15 örneğindeki gibi:

1. **Kısa açıklama** (`description`) — SEO ve liste kartları için
2. **Detay tablosu** (`details`) — `__SPEC_TABLE__` + `Etiket|Değer` satırları; ürün detay sayfasında iki sütunlu özellik tablosu

## Yaklaşım (dürüstlük kuralı)

| Katman | Kaynak | Not |
|--------|--------|-----|
| **Manuel override** | `scripts/content/*.json` + panel | PSREF / üretici doğrulaması (Lenovo V15). Asla ezilmez. |
| **XML metni** | Tedarikçi feed | Ad ile aynı değilse ve anlamlıysa olduğu gibi kullanılır. |
| **Otomatik üretim** | `lib/product-description.js` | Yalnızca boş veya ad ile aynı metinlerde devreye girer. Özellikler **ürün adı + katalog alanlarından** parse edilir; uydurma PSREF satırı yok. |

Otomatik kısa açıklama sonuna şu cümle eklenir: *"Teknik satırlar ürün adı ve katalog bilgisinden derlenmiştir."*  
`(Upg)` / yükseltme geçen başlıklarda RAM-depolama montajı uyarısı eklenir.

## Kategori algılama

`detectProductKind()` site kategorisi (`siteChild`, `siteMid`) ve ürün adına göre şablon seçer:

- notebook, cpu, ram, storage, monitor, printer, toner, gpu, motherboard, psu, case, cooler, network, ups, peripheral, generic
- Her şablon ad içinden regex ile alan çıkarır (işlemci, soket, GB, Hz, watt, dpi, vb.)
- İnce otomatik tablolar API okuma anında (`enrichProductCopy`) yeniden üretilir; `Kaynak|`, `Detay|`, `PSREF` satırlı manuel override’lar korunur.

## Entegrasyon noktaları

1. **`lib/supplier.js`** — `hydrateListedProduct`: override yoksa zenginleştir
2. **`lib/catalog.js`** — `toPublicProduct`: manuel + API çıktısı için aynı mantık
3. **`assets/js/urun-detay.js`** — mevcut tab sekmesi + `__SPEC_TABLE__` render (değişmedi)

## Manuel içerik ekleme

```bash
node scripts/apply-supplier-seo-override.js scripts/content/<urun-id>.json
```

JSON şeması: `supplierSku`, `description`, `details` (ve isteğe bağlı `urlSlug`).

## İleride (doğrulanmış kaynak)

1. **`node scripts/verify-all-product-specs.js`** — tüm aktif vitrin ürünlerinde genişletilmiş `__SPEC_TABLE__` (≥4 içerik satırı) doğrular; VPS `.env` ile çalışır.
2. **`node scripts/audit-product-specs.js`** — başlıktan daha fazla satır çıkarılabilecek ürünleri listeler (VPS/.env gerekir).
2. **Manuel override** — üretici sayfası / PSREF ile doğrulanmış satırlar: `scripts/content/<id>.json` + `apply-supplier-seo-override.js`.
3. Otomatik üretim **uydurma spec yazmaz**; marka sitesi taraması yalnızca doğrulanmış override veya onaylı batch ile eklenir.
