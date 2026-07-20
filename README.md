# Patygo Teknoloji — Kurumsal Web Sitesi

Patygo Teknoloji ve Bilişim Ltd. Şti. için hazırlanan kurumsal tanıtım web sitesi. Tüm elektrikli ve elektronik ürünlerde teknik servis ve BT çözümlerini tanıtan, mobil uyumlu ve statik (HTML/CSS/JS) bir sitedir.

## Özellikler

- Modern, responsive ve erişilebilir kurumsal tasarım
- Marka renkleri (mavi/gri) logodan türetilmiş tasarım sistemi
- Scroll-reveal animasyonları, sayaç, SSS akordeon, mobil menü
- Vergi levhası bazlı resmî şirket künyesi
- Kurumsal yasal sayfalar: KVKK, Gizlilik, Çerez, Kullanım Koşulları, Hizmet Sözleşmesi
- SEO: meta etiketleri, Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD

## Sayfalar

| Dosya | Açıklama |
|------|----------|
| `index.html` | Ana sayfa |
| `kurumsal.html` | Hakkımızda + şirket künyesi |
| `hizmetler.html` | Hizmet ve servis kapsamı |
| `markalar.html` | Çalışılan markalar |
| `iletisim.html` | İletişim formu, adres, harita |
| `kvkk.html` / `gizlilik.html` / `cerez.html` / `kullanim-kosullari.html` / `hizmet-sozlesmesi.html` | Yasal metinler |
| `404.html` | Hata sayfası |

## Klasör Yapısı

```
.
├── index.html
├── kurumsal.html · hizmetler.html · markalar.html · iletisim.html
├── kvkk.html · gizlilik.html · cerez.html · kullanim-kosullari.html · hizmet-sozlesmesi.html
├── 404.html · robots.txt · sitemap.xml
└── assets/
    ├── css/style.css
    ├── js/main.js
    └── img/ (logo, favicon, vergi levhası)
```

## Yerel Önizleme

Ürün kataloğu ve yönetim paneli için Node.js sunucusunu kullanın:

```bash
npm install
copy .env.example .env
npm start
```

Site: `http://localhost:5173`

Panel: `http://localhost:5173/admin` (temiz URL; `.html` uzantılı eski adresler 301 ile yönlenir)

`.env` içinde en az `ADMIN_PASSWORD` ve `SITE_BASE_URL` değerlerini canlı ortama göre değiştirin.

## XML ve Akakçe

- En fazla üç tedarikçi XML bağlantısı paneldeki **XML Yönetimi** bölümünden ayrı ayrı kaydedilir.
- Manuel ve XML ürünleri, **Ürünler** bölümündeki iki ayrı alt sekmeden yönetilir.
- XML ürünleri varsayılan olarak pasiftir. Aktif edilenler site kataloğuna ve Akakçe feed'ine eklenir.
- Akakçe adresi: `/api/feeds/akakce.xml`
- Tedarikçi IP yetkisi, canlı sunucunun çıkış IP adresine tanımlanmalıdır.

## Yayına Alma (Deploy)

Node.js çalıştırabilen bir sunucu gerekir. `.runtime/` klasörü kalıcı diskte tutulmalı; dışarıdan erişime açılmamalıdır. Alan adı: `patygoteknoloji.com`.

### Otomatik CI / Deploy

`main` branch’e her push’ta GitHub Actions:

1. `npm test` çalıştırır (fail → deploy yok)
2. Test geçerse sunucuda `git pull` + `pm2 restart patygo`

**Bir kerelik kurulum (sunucuda SSH ile):**

```bash
cd /var/www/patygo
git pull
bash scripts/setup-github-deploy-key.sh
```

Script’in yazdırdığı private key’i GitHub’da repo → **Settings → Secrets and variables → Actions** altına ekleyin:

| Secret | Değer |
|--------|--------|
| `DEPLOY_HOST` | Sunucu IP (ör. `8.229.158.154`) |
| `DEPLOY_USER` | SSH kullanıcı adı |
| `DEPLOY_SSH_KEY` | Script’in ürettiği private key (tümü) |

Sonraki yayınlar: kodu `main`’e push etmek yeterli. Durum: repo → **Actions** sekmesi.

## Yapılacaklar / Notlar

- Telefon numarası ve WhatsApp hattı gerçek numarayla güncellenmeli (`wa.me/900000000000`).
- Sosyal medya bağlantıları (`#`) güncellenmeli.
- Yasal metinler yayın öncesi bir hukuk danışmanınca gözden geçirilmelidir.
- İletişim formu şu an demo (istemci taraflı); canlıda bir form servisi/backend'e bağlanmalıdır.

## Şirket Bilgileri

- **Ünvan:** Patygo Teknoloji ve Bilişim Limited Şirketi
- **Vergi Dairesi / No:** Küçükköy / 7230922773
- **Adres:** Mevlana Mah. 911. Sk. Karadayı A.P No: 19 İç Kapı No: 8, Gaziosmanpaşa / İstanbul
