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

Canlı süreç her gün, İstanbul saati 08:00’dan sonra bir kez, bir elektronik kategori okur ve özeti `mete.camadan@patygoteknoloji.com` adresine yollar. Elle deneme: `node scripts/seller-intel-tour.js`.

Ham kayıt `.runtime/seller-intel/` altındadır ve commit edilmez. Harita anahtarı yoksa Google ve Yandex atlanır. Hepsiburada’da yalnızca mağaza sayfasında yazan işletme telefonu ve e-postası aranır. LinkedIn ve firma yetkilisinin kişisel profili okunmaz. Faz 2 kapalıdır.

## Özet

Sayılar o günkü tur mailindedir. Kısmi liste “tümü” diye yazılmaz.
