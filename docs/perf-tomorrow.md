# Yarın — hız (yeşile çek)

Ölçüm: 19 Ağu 2026 ~01:19 TRT, `https://patygoteknoloji.com`.
Pazarlama copy yok. Cluster / workaround bu geceden karar değil; birlikte seçilir.

Hedef: kırmızı/turuncu üçlü **yeşil** (listing/all.json zaten 39–83 ms, nginx disk).

| Şimdi | Hedef | Ne |
|--------|--------|-----|
| `listing/categories.json` 1.1–14.7 s (Node) | nginx disk, `all.json` mertebesi | Nav her sayfada; `publicList()` vitrin tarıyor. Snapshot yaz, nginx `location =` proxy kalksın. |
| `homeFeatured` 1.3–1.9 s (Node) | snapshot / listing mertebesi | Ana sayfa her seferinde tam katalog. `all.json` benzeri bootstrap. |
| `admin.js` 189 KB, `defer` yok | login kartı küçük parse | Panel login 4854 satır bekliyor. `defer` + login/panel ayır. |
| `/urunler` Node proxy (soğuk start ~30 sn) | nginx statik + `/listing/*.json` | 20 Ağu 2026: uygulandı (`try_files /urunler.html`). |
| Startup warm restart'ta event loop | snapshot varken 45 sn ertele | 20 Ağu 2026: `scheduleStartupCatalogWarm`. |

Tek PM2 fork: categories uzayınca `/api/payment/status` de ~1.2 s kuyruğa giriyor.

Detay tarama: sohbet canvas `speed-performance-scan`.
