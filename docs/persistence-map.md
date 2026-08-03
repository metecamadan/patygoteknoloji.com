# Kalıcılık ve kullanıcı yönetimi haritası

Son durum (Ağustos 2026): **SQLite** (`.runtime/patygo.sqlite`) sipariş / müşteri / consent / audit; panel kullanıcıları hâlâ JSON + e-posta girişi.

Plan: `docs/plan-commerce-db-kvkk.md` · Canlı paslaşma: `/agent-ops`

## Mevcut depolar

| Veri | Konum | Not |
|------|--------|-----|
| Siparişler / kalemler / müşteri | SQLite `orders`, `order_items`, `customers` | JSON migrate bir kez |
| Onay kanıtı | SQLite `consent_events` | Checkout + iletişim |
| Audit | SQLite `audit_events` | Sipariş durum güncelleme |
| Admin kullanıcılar | `.runtime/admin-users.json` | Faz 2’de SQLite’a taşınabilir |
| Manuel ürünler | `assets/data/products.json` | — |
| Tedarikçi / takvim / analytics | `.runtime/*` | — |

## Panel

- **Siparişler** sekmesi: liste, detay, durum (preparing/shipped/…)
- **Kullanıcılar** sekmesi: panel hesapları

## Fazlar

1. ~~Panel kullanıcıları~~ · ~~Sipariş yüzeyi + SQLite + KVKK kanıtı~~ (Faz 1)
2. Retention cron, DSAR anonimleştir, lead listesi
3. Postgres adapter / yedek / e-fatura hazırlığı
