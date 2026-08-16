#!/usr/bin/env bash
# Yeni VPS (Ubuntu 24.04) — iki proje klasör yapısı
# Mete panel → Konsol veya: bash /root/new-server-setup.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

PATY_DIR="/var/www/patygoteknoloji.com"
FIYAT_DIR="/var/www/fiyat-karsilastirma"
PATY_PORT="5173"
FIYAT_PORT="5174"
PATY_REPO="https://github.com/metecamadan/patygoteknoloji.com.git"
FIYAT_REPO="https://github.com/metecamadan/Teklifpazar.git"
SITE_DOMAIN="patygoteknoloji.com"
OLD_HOST="${OLD_HOST:-8.229.158.154}"
OLD_APP="${OLD_APP:-/var/www/patygo}"

echo "=== Patygo + Teklifpazar kurulumu ==="

apt-get update -y
apt-get install -y curl git nginx ufw certbot python3-certbot-nginx rsync

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

mkdir -p "$PATY_DIR" "$FIYAT_DIR"

# --- Patygoteknoloji.com ---
if [ ! -d "$PATY_DIR/.git" ]; then
  git clone --branch main --single-branch "$PATY_REPO" "$PATY_DIR"
else
  git -C "$PATY_DIR" fetch origin main && git -C "$PATY_DIR" checkout main && git -C "$PATY_DIR" reset --hard origin/main
fi
cd "$PATY_DIR"
npm ci --omit=dev

# Eski GCP'den .env + sipariş verisi (SSH anahtarınız varsa)
if [ ! -f "$PATY_DIR/.env" ]; then
  copied=0
  for u in root deploy ubuntu; do
    for k in /root/.ssh/id_ed25519 /root/.ssh/id_rsa; do
      [ -f "$k" ] || continue
      if ssh -i "$k" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$u@$OLD_HOST" "test -f $OLD_APP/.env" 2>/dev/null; then
        scp -i "$k" -o StrictHostKeyChecking=no "$u@$OLD_HOST:$OLD_APP/.env" "$PATY_DIR/.env"
        rsync -az -e "ssh -i $k -o StrictHostKeyChecking=no" "$u@$OLD_HOST:$OLD_APP/.runtime/" "$PATY_DIR/.runtime/" 2>/dev/null || true
        copied=1
        echo "Eski sunucudan .env/.runtime kopyalandi ($u@$OLD_HOST)"
        break 2
      fi
    done
  done
  if [ "$copied" -eq 0 ]; then
    cp .env.example .env
    echo "UYARI: Eski .env alinamadi. AKBANK_*, ADMIN_PASSWORD ve SMTP degerlerini $PATY_DIR/.env icine yazin."
  fi
fi
sed -i "s|^SITE_BASE_URL=.*|SITE_BASE_URL=https://${SITE_DOMAIN}|" "$PATY_DIR/.env"
grep -q '^SITE_BASE_URL=' "$PATY_DIR/.env" || echo "SITE_BASE_URL=https://${SITE_DOMAIN}" >> "$PATY_DIR/.env"

# --- Fiyat karsilastirma (Teklifpazar) ---
if [ ! -d "$FIYAT_DIR/.git" ]; then
  git clone --branch master --single-branch "$FIYAT_REPO" "$FIYAT_DIR" || echo "Teklifpazar repo erisilemedi (ozel repo?)"
fi
if [ -d "$FIYAT_DIR/.git" ]; then
  git -C "$FIYAT_DIR" fetch origin master && git -C "$FIYAT_DIR" checkout master && git -C "$FIYAT_DIR" reset --hard origin/master
  cd "$FIYAT_DIR"
  npm ci
  npm run build
  [ -f .env.local ] || [ -f .env ] || echo "UYARI: Teklifpazar icin Supabase .env.local gerekebilir."
fi

# --- PM2 ---
cd "$PATY_DIR"
pm2 delete patygo 2>/dev/null || true
pm2 start server.js --name patygo

cd "$FIYAT_DIR"
pm2 delete teklifpazar 2>/dev/null || true
PORT="$FIYAT_PORT" pm2 start npm --name teklifpazar -- start

pm2 save
env PATH="$PATH" pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

# --- Nginx ---
cat > /etc/nginx/sites-available/patygoteknoloji.com <<NGX
server {
  listen 80;
  server_name patygoteknoloji.com www.patygoteknoloji.com;
  root ${PATY_DIR};
  gzip on;
  gzip_vary on;
  gzip_proxied any;
  gzip_min_length 256;
  gzip_types text/plain text/css text/xml application/json application/javascript application/xml image/svg+xml;
  location ^~ /api/ {
    proxy_pass http://127.0.0.1:${PATY_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location = /assets/data/categories.json {
    proxy_pass http://127.0.0.1:${PATY_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location ^~ /assets/data/ { return 404; }
  location ^~ /assets/ { expires 1h; add_header Cache-Control "public"; try_files \$uri @node; }
  location = / { try_files /index.html @node; }
  location / { try_files \$uri.html @node; }
  location @node {
    proxy_pass http://127.0.0.1:${PATY_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGX

cat > /etc/nginx/sites-available/fiyat-karsilastirma <<NGX
server {
  listen 80 default_server;
  server_name _;
  location / {
    proxy_pass http://127.0.0.1:${FIYAT_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGX

ln -sf /etc/nginx/sites-available/patygoteknoloji.com /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/fiyat-karsilastirma /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

ufw allow OpenSSH || true
ufw allow 80 || true
ufw allow 443 || true
ufw --force enable || true

echo ""
echo "=== Kurulum bitti ==="
echo "Patygo:    $PATY_DIR  (port $PATY_PORT, pm2 patygo)"
echo "Teklifpazar: $FIYAT_DIR (port $FIYAT_PORT, pm2 teklifpazar)"
echo ""
curl -fsS "http://127.0.0.1:${PATY_PORT}/api/payment/status" && echo "" || echo "Patygo loopback kontrol edilemedi (.env?)"
curl -fsSI "http://127.0.0.1:${FIYAT_PORT}/" | head -n 1 || echo "Teklifpazar loopback henuz hazir degil"
echo ""
echo "SONRAKI ADIMLAR:"
echo "1) DNS A kayitlari (@ ve www) -> $(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
echo "2) certbot --nginx -d patygoteknoloji.com -d www.patygoteknoloji.com"
echo "3) GitHub Secrets: DEPLOY_APP_DIR=$PATY_DIR  DEPLOY_HOST=patygoteknoloji.com  DEPLOY_USER=root"
echo "4) bash $PATY_DIR/scripts/setup-github-deploy-key.sh -> DEPLOY_SSH_KEY"
echo "5) Tedarikci XML whitelist: yeni cikis IP"
echo "6) Root sifresini degistir"
