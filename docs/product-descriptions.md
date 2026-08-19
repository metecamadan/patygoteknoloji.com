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

- notebook, cpu, ram, storage, monitor, printer, toner, gpu, motherboard, …
- Her şablon ad içinden regex ile alan çıkarır (işlemci, soket, GB, Hz, renk, vb.)

## Entegrasyon noktaları

1. **`lib/supplier.js`** — `hydrateListedProduct`: override yoksa zenginleştir
2. **`lib/catalog.js`** — `toPublicProduct`: manuel + API çıktısı için aynı mantık
3. **`assets/js/urun-detay.js`** — mevcut tab sekmesi + `__SPEC_TABLE__` render (değişmedi)

## Manuel içerik ekleme

```bash
node scripts/apply-supplier-seo-override.js scripts/content/<urun-id>.json
```

JSON şeması: `supplierSku`, `description`, `details` (ve isteğe bağlı `urlSlug`).

## İleride (isteğe bağlı)

- Kategori başına PSREF / üretici API ile doğrulanmış batch override
- Panelde “açıklama üret” önizlemesi
- Otomatik üretilmiş satırları admin’de “doğrulandı” bayrağı ile kalıcı override’a çevirme
