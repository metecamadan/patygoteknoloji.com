# Patygo Teknoloji — Agent Mimarisi

Bu proje web (şu an) ve ileride mobil için çoklu agent ile yürütülür. Her agent kendi görev listesini oluşturur, iş bitince test kapısından geçirir, başarılı akışta GitHub'ı günceller.

## Kaç agent gerekli?

| # | Agent | Rol |
|---|--------|-----|
| 1 | **Orchestrator** | İşi parçalar, sırayı belirler, agentlar arası el değişimini yönetir |
| 2 | **Web Frontend** | HTML/CSS/JS, admin UI, sepet/ödeme arayüzü, erişilebilirlik |
| 3 | **Backend & Integrations** | `server.js`, `lib/*`, ödeme (Akbank), tedarikçi XML, Akakçe, sipariş |
| 4 | **QA & Test** | `npm test`, regression, coverage, link kontrolü |
| 5 | **Dijital Pazarlama & SEO** | teknik SEO kontrolleri, içerik/meta denetimi, uyarı ve öneri üretimi |
| 6 | **Release & DevOps** | commit/push, GitHub Actions, deploy doğrulama, secret kontrolü |

**Mobil fazında 7. agent eklenir:** Mobile (React Native / Expo veya native).

Toplam: **6 agent** (mobil ile **7**).

---

## Agent yetenekleri

### 1) Orchestrator
- Kullanıcı isteğini alt görevlere böler (kendi içinde todo/task listesi).
- Hangi dosyaların hangi agent'a ait olduğunu belirler.
- Çakışan değişiklikleri önler; sıra: backend sözleşmesi → frontend → test → release.
- **Öğrenmesi gerekenler:** proje README, `docs/`, mevcut test dosyaları, deploy akışı.

### 2) Web Frontend
- `*.html`, `assets/css/`, `assets/js/` (admin hariç ortak UI).
- Clean URL, responsive, SEO meta, JSON-LD.
- Admin paneli (`admin.html`, `assets/js/admin.js`, `assets/css/admin.css`).
- **Öğrenmesi gerekenler:** mevcut tasarım sistemi, `assets/data/`, API endpoint sözleşmeleri, `tests/*-ui.test.js` ve `tests/site-links.test.js`.

### 3) Backend & Integrations
- `server.js`, `lib/*`, `.env.example` şeması.
- Ödeme (Akbank 3D), sipariş, katalog, tedarikçi XML, iletişim formu, analytics.
- **Öğrenmesi gerekenler:** `tests/server-api.test.js`, `payment-api.test.js`, `supplier*.test.js`, `akbank-pos.test.js`, KVKK/veri güvenliği sınırları.

### 4) QA & Test
- Her değişiklikten sonra `npm test` (zorunlu).
- Gerekirse `npm run test:links`, `npm run test:coverage`.
- Yeni özellik = yeni/ güncellenmiş test; kırmızı test ile iş bitmiş sayılmaz.
- **Öğrenmesi gerekenler:** Node.js `node --test`, mevcut `tests/` yapısı, TDD notları (`docs/testing/`).

### 5) Dijital Pazarlama & SEO
- Teknik SEO checklist: title/description, canonical, robots, sitemap, structured data (JSON-LD).
- İçerik ve landing sayfalarında anahtar kelime, heading hiyerarşisi ve iç linkleme kontrolü.
- Kırık link, yönlendirme ve indekslenebilirlik risklerinde ilgili agentları proaktif uyarma.
- Yayın öncesi SEO risk raporu üretip Orchestrator ve Release'e aksiyon listesi verme.
- **Öğrenmesi gerekenler:** `*.html`, `assets/js/`, `assets/css/`, sitemap/robots ayarları, `tests/site-links.test.js`.

### 6) Release & DevOps
- Başarılı test sonrası: `git add` → `git commit` → `git push origin main`.
- GitHub Actions (`CI and Deploy`) yeşil olana kadar takip; kırmızıysa log + düzeltme.
- Canlı smoke: `https://patygoteknoloji.com` (IP değil).
- **Öğrenmesi gerekenler:** `.github/workflows/ci-deploy.yml`, deploy secret'ları, `scripts/setup-github-deploy-key.sh`.

### 7) Mobile (gelecek)
- API-first; mevcut backend sözleşmelerini bozmaz.
- **Öğrenmesi gerekenler:** public API'ler, auth modeli, mobil UX, store gereksinimleri.

---

## İş akışı (her görev)

```
Kullanıcı isteği
    → Orchestrator: alt görevler oluştur
    → İlgili agent: kod değişikliği
    → Dijital Pazarlama & SEO: SEO checklist + risk uyarıları
    → QA: npm test (+ gerekirse test:links)
    → Başarısız → düzelt, tekrar test
    → Başarılı → Release: commit + push + CI kontrolü
    → Orchestrator: kullanıcıya özet
```

## Test ortamı

```bash
cd /Users/camadan/Patygoteknoloji
npm install          # veya npm ci
cp .env.example .env # ilk kurulum
npm test             # 55 test — her işten sonra
npm start            # http://localhost:5173
```

Cursor hook: agent durduğunda `.cursor/hooks/run-tests-on-stop.js` otomatik `npm test` çalıştırır.

## Dosya sahipliği (kısa)

| Alan | Agent |
|------|--------|
| `*.html`, `assets/css`, `assets/js` (UI) | Web Frontend |
| `server.js`, `lib/`, API | Backend |
| `*.html`, `assets/css`, `assets/js`, sitemap/robots | Dijital Pazarlama & SEO |
| `tests/` | QA (diğerleri test yazar, QA doğrular) |
| `.github/`, deploy scriptleri | Release & DevOps |
| `AGENTS.md`, görev planı | Orchestrator |

## Kurallar

- `.cursor/rules/real-storefront.mdc` — gerçek vitrin, test XML yok, Agent Ops yok
- `.cursor/rules/test-and-deploy.mdc` — test kapısı, alan adı, canlı doğrulama
- `.cursor/rules/github-sync-after-success.mdc` — başarılı akışta GitHub güncelleme
- `.cursor/rules/github-deploy-fallback.mdc` — Deploy SSH kırmızıysa sahte yeşil yok
- `.cursor/rules/no-cover-up.mdc` — hatayı örtme; geleceği düşün
- `.cursor/rules/supplier-xml-ip.mdc` — tedarikçi XML yalnızca kayıtlı IP
- `.cursor/rules/smtp-homework.mdc` — SMTP ödevi (ertelendi)
- `.cursor/rules/agent-task-breakdown.mdc` — agent içi görev parçalama
