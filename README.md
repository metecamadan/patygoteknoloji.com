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

`.env` içinde en az `ADMIN_PASSWORD` ve `SITE_BASE_URL=https://patygoteknoloji.com` değerlerini canlıya göre ayarlayın. Canlıda IP veya `localhost` kullanmayın; ödeme callback ve Akakçe adresleri alan adından üretilir.

## XML ve Akakçe

- En fazla üç tedarikçi XML bağlantısı paneldeki **XML Yönetimi** bölümünden ayrı ayrı kaydedilir.
- Manuel ve XML ürünleri, **Ürünler** bölümündeki iki ayrı alt sekmeden yönetilir.
- XML ürünleri varsayılan olarak pasiftir. Aktif edilenler site kataloğuna ve Akakçe feed'ine eklenir.
- Akakçe adresi: `/api/feeds/akakce.xml`
- Tedarikçi IP yetkisi, canlı sunucunun çıkış IP adresine tanımlanmalıdır.

## Yayına Alma (Deploy)

Node.js çalıştırabilen **herhangi bir** VPS yeterlidir (Google Cloud zorunlu değil). `.runtime/` kalıcı diskte tutulmalı; dışarıdan erişime açılmamalıdır. Genel adres her zaman alan adı: `https://patygoteknoloji.com` (IP ile site doğrulanmaz).

### Yeni sunucu (bir kerelik)

```bash
# İsteğe bağlı: APP_DIR=/var/www/patygo SITE_DOMAIN=patygoteknoloji.com
bash scripts/server-bootstrap.sh
```

(`scripts/gcp-bootstrap.sh` aynı kuruluma yönlendirir; ad tarihseldir.)

`.env` içinde zorunlu:

- `SITE_BASE_URL=https://patygoteknoloji.com` — canlıda IP / localhost yasak (ödeme callback + Akakçe)
- `ADMIN_PASSWORD=...`
- `AKBANK_*` anahtarları

DNS: `@` ve `www` A kayıtlarını **yeni** sunucunun dış IP’sine alın. SSL: certbot. Tedarikçi XML whitelist’ine **yeni çıkış IP’sini** ekleyin.

### Otomatik CI / Deploy

`main` push → `npm test` → SSH ile `git pull` + `pm2 restart`.

**Bir kerelik deploy anahtarı (sunucuda):**

```bash
cd /var/www/patygo   # veya APP_DIR
bash scripts/setup-github-deploy-key.sh
```

| Secret | Değer |
|--------|--------|
| `DEPLOY_HOST` | **Alan adı** (`patygoteknoloji.com`) — ham IP reddedilir |
| `DEPLOY_USER` | SSH kullanıcı |
| `DEPLOY_SSH_KEY` | OpenSSH private key |
| `DEPLOY_APP_DIR` | (opsiyonel) varsayılan `/var/www/patygo` |
| `DEPLOY_PM2_NAME` | (opsiyonel) varsayılan `patygo` |
| `DEPLOY_APP_PORT` | (opsiyonel) varsayılan `5173` |
| `DEPLOY_PUBLIC_URL` | (opsiyonel) varsayılan `https://patygoteknoloji.com` |

Deploy sonrası smoke hem `127.0.0.1` (süreç) hem alan adı (kamu) üzerinden `/api/payment/status` kontrol eder; yanıttaki IPv4 kaçakları fail eder.

## Yapılacaklar / Notlar

- Sosyal medya bağlantıları gerektiğinde güncellenecek.
- Yasal metinler yayın öncesi bir hukuk danışmanınca gözden geçirilmelidir.
- İletişim formu `/api/contact` üzerinden `info@patygoteknoloji.com` adresine iletilir (SMTP veya FormSubmit yedek kanalı).

## Şirket Bilgileri

- **Ünvan:** Patygo Teknoloji ve Bilişim Limited Şirketi
- **Vergi Dairesi / No:** Küçükköy / 7230922773
- **Adres:** Mevlana Mah. 911. Sk. Karadayı A.P No: 19 İç Kapı No: 8, Gaziosmanpaşa / İstanbul
