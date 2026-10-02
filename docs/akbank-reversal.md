# Akbank banka iadesi / iptal (void & refund)

Tahsilat (3D Pay Hosting satış + callback) akışından **bağımsız** admin işlemidir. Ödeme başlatma ve callback koduna dokunulmaz.

## İşlem türleri

| Kod | txnCode | Ne zaman |
|-----|---------|----------|
| **Void (iptal)** | `1003` | Aynı gün, settlement öncesi, tam tutar |
| **Refund (iade)** | `1002` | Ertesi gün / kısmi / kargoya verilmiş sipariş |

Panel varsayılan plan: **auto** — aynı gün tam tutar ve kargo yoksa önce void, başarısız olursa refund; kargoda yalnızca refund.

## API uçları

- `GET /api/payment/status` → `bankReversal` public durumu (secret yok)
- `GET /api/admin/orders/:id` → `bankReversal` önizleme
- `POST /api/admin/orders/:id/bank-reversal` (owner)
  - `{ dryRun: true }` veya `{ preview: true }` → plan doğrulama, banka çağrısı yok
  - `{ confirm: true, action: "auto"|"void"|"refund", amount?: "10.00" }` → gerçek banka API (kapılar açıksa)

Manuel `PATCH { status: "refunded" }` **reddedilir**; iade durumu yalnızca başarılı bank reversal sonrası yazılır.

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

POS kimlik bilgileri (`AKBANK_*`) tanımlı olmalıdır.

## Test planı (canlıya almadan önce)

1. `npm test` — tüm suite yeşil (`tests/akbank-reversal.test.js`, `tests/admin-orders-bank-reversal.test.js`, mevcut ödeme testleri).
2. Yerel panel: ödenmiş test siparişinde **Planı doğrula** → dryRun 200, banka çağrısı yok.
3. `AKBANK_BANK_REVERSAL_ENABLED=true` + `AKBANK_TEST_MODE=true` ile test POS’ta küçük tutarlı **gerçek test iadesi** (kullanıcı onayı ile).
4. Tahsilat smoke: yeni sipariş → 3D → callback → `paid` değişmediğini doğrula.
5. Canlı: `AKBANK_BANK_REVERSAL_LIVE=true` yalnızca test adımları başarılıysa ve bilinçli onayla.

## Go-live checklist

- [ ] `npm test` yeşil
- [ ] GitHub Actions deploy yeşil
- [ ] Test modunda en az bir void/refund denemesi başarılı
- [ ] Audit log’da `order.bank_reversal_ok` kaydı
- [ ] Müşteri `refunded` maili (SMTP varsa)
- [ ] Canlı LIVE bayrağı ayrı onay

## Dosyalar

- `lib/akbank-reversal.js` — uygunluk, plan, event
- `lib/akbank-pos.js` — void/refund HTTP + hash
- `lib/orders.js` — `recordBankReversal`
- `server.js` — admin endpoint
- `assets/js/admin.js` — panel UI
