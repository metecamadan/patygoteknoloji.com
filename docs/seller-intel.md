# Satıcı keşif — patygoteknoloji.com

Yalnızca bu proje. Açık artırma ile karışmaz. Mağazanın Akakçe ürün feed’i bu dosyanın konusu değildir.

## Faz

- Faz 1, açık: akakce.com elektronik satıcıları ve Türkiye harita kayıtları (Google / Yandex, resmi API). Çıktı iletişim özeti.
- Faz 2, kapalı: otomatik teklif. Kullanıcı açmadan ve İYS onayı olmadan ileti gönderilmez.

## Kayıt alanları

| Alan | Anlamı |
|---|---|
| ad | Satıcı veya ticari unvan |
| sehir | İl |
| kanal | Kendi sitesi veya pazaryeri |
| site | Web sitesi veya mağaza adresi |
| telefon | Sayfada yayınlanan telefon |
| eposta | Sayfada yayınlanan e-posta |
| kategori | Elektronik alt dal |
| kaynak | Hangi sayfadan görüldü |
| gorulme | Tarih |
| doluluk | Telefon, e-posta, site var mı |

Ham liste `.runtime` içindedir ve commit edilmez.

## Tur

Canlı sunucuda, tek elektronik kategori:

`node scripts/seller-intel-tour.js`

Ham kayıt `.runtime/seller-intel/` altındadır ve commit edilmez. Harita anahtarı yoksa Google ve Yandex atlanır; sayfa HTML’i kazınmaz. Faz 2 kapalıdır.

## Özet

İlk tur kodu bu depoda. Sayılar sunucudaki turdan sonra yazılır; kısmi liste “tümü” diye yazılmaz.
