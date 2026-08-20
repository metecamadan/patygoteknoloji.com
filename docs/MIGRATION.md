# Canlı sunucu taşıma — Patygo + Teklifpazar

## Sunucu yapısı (yeni VPS: 87.76.157.41)

| Proje | Klasör | Port | PM2 | Domain |
|-------|--------|------|-----|--------|
| Patygoteknoloji.com | `/var/www/patygoteknoloji.com` | 5173 | `patygo` | patygoteknoloji.com |
| Fiyat karşılaştırma | `/var/www/fiyat-karsilastirma` | 5174 | `teklifpazar` | (henüz domain belirlenince nginx güncelle) |

## Otomatik kurulum

**Seçenek A — Windows:** `Desktop\TASIMA_BASLAT.bat` (çift tık)

**Seçenek B — Mete panel konsolu:**
```bash
curl -fsSL https://raw.githubusercontent.com/metecamadan/patygoteknoloji.com/main/scripts/new-server-setup.sh -o /root/setup.sh
bash /root/setup.sh
```
*(Script henüz push edilmediyse dosyayı SCP ile `/root/` altına kopyalayın.)*

## Kesim öncesi kontrol (yeni sunucuda)

```bash
curl http://127.0.0.1:5173/api/payment/status
pm2 list
nginx -t
```

Beklenen: `"paymentModel":"3D_PAY_HOSTING"`, `"enabled":true`

## DNS kesimi (Squarespace)

| Kayıt | Eski | Yeni |
|-------|------|------|
| `@` A | 8.229.158.154 | **87.76.157.41** |
| `www` A | 8.229.158.154 | **87.76.157.41** |

TTL düşük tutun; propagasyon 5–60 dk.

## SSL

DNS yayıldıktan sonra:
```bash
certbot --nginx -d patygoteknoloji.com -d www.patygoteknoloji.com
```

## GitHub Actions (deploy yeni sunucuya)

```bash
ssh root@87.76.157.41
cd /var/www/patygoteknoloji.com
bash scripts/setup-github-deploy-key.sh
```

Secrets güncelle:
- `DEPLOY_HOST` = `patygoteknoloji.com`
- `DEPLOY_USER` = `root`
- `DEPLOY_APP_DIR` = `/var/www/patygoteknoloji.com`
- `DEPLOY_SSH_KEY` = script çıktısı

## Eski GCP verisi (kritik)

Taşınması gerekenler:
- `/var/www/patygo/.env` → AKBANK, ADMIN_PASSWORD, SMTP
- `/var/www/patygo/.runtime/` → siparişler, admin verisi

Eski sunucuya erişiminiz varsa:
```bash
scp root@8.229.158.154:/var/www/patygo/.env /var/www/patygoteknoloji.com/.env
rsync -az root@8.229.158.154:/var/www/patygo/.runtime/ /var/www/patygoteknoloji.com/.runtime/
```

## Dış servisler

1. **Tedarikçi XML** — whitelist: `87.76.157.41` (VPS) ve `195.155.129.41` (entegratör Windows). Yerel PC’den çekim yok.
2. **Akbank** — callback URL domain tabanlı; DNS kesimi yeterli (IP değişmez URL)
3. **Teklifpazar** — Supabase `.env.local` yeni sunucuya kopyalanmalı

## Güvenlik

- Root şifresini taşıma sonrası değiştirin
- `Desktop\_migrate_pass.local` dosyasını silin
- Eski GCP VM’yi 1 hafta sonra kapatın (yedek alındıktan sonra)
