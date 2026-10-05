# Akbank banka iadesi / iptal (void & refund)

Tahsilat (3D Pay Hosting satış + callback) akışından **bağımsız** admin işlemidir. Ödeme başlatma ve callback koduna dokunulmaz.

## Para nasıl döner

| İşlem | txnCode | Ne zaman | Müşteriye etkisi |
|-------|---------|----------|------------------|
| **İptal (void)** | `1003` | Gün sonu (batch) kapanmadan, tam tutar | Satış silinir, para hiç çekilmez; kredi kartında limit hemen açılır (banka kartında bloke kalkışı kartı veren bankaya bağlı) |
| **İade (refund)** | `1002` | Gün sonu sonrası, kısmi veya kargolanmış sipariş | Kart şebekesi üzerinden aynı karta alacak; Akbank’a göre 2–3 iş günü |
| **İşlem sorgulama** | `1010` | Banka cevabı alınamadığında / mutabakat | `txnDetailList[].txnStatus`: N tamamlandı, V iptal, R iade, S hata |

- İade **her zaman ödemenin yapıldığı karta** yapılır (Akbank kuralı; havale/EFT veya başka kart yok).
- Üye işyeri hesabında bakiye olmaması müşterinin iadesini değiştirmez: banka tutarı POS alacaklarından mahsup eder / hesabı borçlandırır. Sanal POS’ta bakiye yetersizliğinde API’nin reddedip reddetmediği, valörlü alacaktan düşülüp düşülmediği ve komisyon iadesi **sözleşmeye bağlıdır**; Akbank’a yazılı sorulmalıdır (`akbanksanalposdestek@akbank.com`).

## Panel akışı

- **Kargoya verilmemiş ödenmiş sipariş:** “İptal et ve parayı iade et” → kalan tutarın tamamı. Ödeme bugün alındıysa önce void, banka reddederse refund. Başarılıysa durum `cancelled`, ödeme `refunded`; kupon kullanım hakkı geri verilir.
- **Kargodaki / teslim edilmiş sipariş:** ürün + adet seçilerek kısmi iade (refund). Tutar = kalem KDV dahil × kupon oranı × taksit farkı oranı; kargo ücreti isteğe bağlı. Aynı adet iki kez iade edilemez. Tamamı iade edilince durum `refunded`.
- Ödenmiş sipariş `PATCH status=cancelled` ile **iptal edilemez** (409); para iade edilmeden “İptal” yok.
- Manuel `PATCH status=refunded` reddedilir.

## Güvenlik kapıları

- Sipariş başına kilit: aynı siparişe eşzamanlı iade/sorgu → 409.
- Banka cevabı kesin değilse (zaman aşımı, ağ hatası, 5xx, okunamayan gövde) olay `unknown: true` yazılır, void sonrası refund **denenmez**, otomatik 1010 sorgusu yapılır. Sonuç netleşmeden yeni iade engellenir (`reversal_pending_inquiry`).
- “Bankadan sorgula”: bankadaki iade/iptal toplamı yereldekinden büyükse fark kaydedilir (Akbank İnternet/Mobil’den yapılan iadeler de böyle işlenir). Bankada satış kaydı görünmüyorsa sonuç güvenilir sayılmaz (`inconclusive`), belirsiz işlem çözülmez.
- İade/iptal olayları ödeme olayı kırpmasında silinmez (iade edilen toplamın tek kaynağı).

## API uçları

- `GET /api/payment/status` → `bankReversal` public durumu (secret yok)
- `GET /api/admin/orders/:id` → `bankReversal` önizleme (+ `refundedQty`, `pending`, `shippingRefunded`), `bankInquiryAvailable`
- `POST /api/admin/orders/:id/bank-reversal` (owner)
  - `{ dryRun: true, mode: "cancel" }` veya `{ dryRun: true, mode: "items", items: [{ index, qty }], includeShipping }` → plan, banka çağrısı yok
  - `{ confirm: true, mode, items?, includeShipping?, amount? }` → gerçek banka API (kapılar açıksa)
  - 200 başarılı · 202 sonuç belirsiz · 400 uygun değil · 409 kilit · 502 banka reddi · 503 API kapalı
- `POST /api/admin/orders/:id/bank-inquiry` (owner) → 1010 sorgu + yerel kayıt eşitleme

## Ortam değişkenleri

```env
AKBANK_BANK_REVERSAL_ENABLED=false   # master switch
AKBANK_BANK_REVERSAL_LIVE=false      # canlı POS’ta ek kapı
```

| enabled | testMode | live | canCallBank |
|---------|----------|------|-------------|
| false | * | * | hayır |
| true | true | * | evet (test API) |
| true | false | false | hayır (blocked_live) |
| true | false | true | evet (live API) |

POS kimlik bilgileri (`AKBANK_*`) tanımlı olmalıdır. İşlem sorgulama (salt okunur) yalnızca POS kimliği ister.

## Canlı deneme planı (kullanıcı onayıyla)

Sunucuda test POS kimliği yok; POS canlı modda. Gerçek deneme kullanıcının kendi kartıyla küçük tutarla yapılır:

1. `AKBANK_BANK_REVERSAL_ENABLED=true` + `AKBANK_BANK_REVERSAL_LIVE=true` — **ayrı ve açık onay**.
2. Küçük tutarlı sipariş → aynı gün “İptal et ve parayı iade et” → void beklenir; kartta provizyon kalkmalı.
3. İkinci sipariş → kargo kaydı → ertesi gün ürün bazlı kısmi iade → refund; 2–3 iş günü içinde kartta alacak.
4. Her adımdan sonra “Bankadan sorgula” → `in_sync` beklenir; audit `order.bank_inquiry` kaydında `txnDetailList` özetinin beklenen kodlarla eşleştiği doğrulanır.

## Go-live checklist

- [x] `npm test` yeşil
- [ ] GitHub Actions deploy yeşil
- [ ] Canlı küçük tutarlı void denemesi başarılı
- [ ] Canlı ertesi gün refund (kısmi) denemesi başarılı
- [ ] 1010 sorgu çıktısı gerçek veride doğrulandı
- [ ] Müşteri iade maili (SMTP) geldi
- [ ] Akbank’tan bakiye/komisyon kuralları yazılı teyit

## Dosyalar

- `lib/akbank-reversal.js` — uygunluk, plan, kalem tutarı, belirsiz durum, sorgu eşitleme
- `lib/akbank-pos.js` — void/refund/1010 HTTP + hash, cevap sınıflandırma
- `lib/orders.js` — `recordBankReversal`, olay kırpma
- `lib/coupons.js` — `release` (tam iadede kupon hakkı)
- `lib/order-mail.js` — void/refund/kısmi iade mail metinleri
- `server.js` — admin uçları, kilit
- `assets/js/admin-panel.js` — panel UI
