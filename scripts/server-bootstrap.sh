#!/usr/bin/env bash
# Patygo — herhangi bir Ubuntu 22.04/24.04 (veya benzeri) VPS kurulumu
# Google Cloud’a özel değildir. Yeni sunucuda SSH ile bir kez çalıştırın.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/patygo}"
REPO_URL="${REPO_URL:-https://github.com/metecamadan/patygoteknoloji.com.git}"
NODE_MAJOR="${NODE_MAJOR:-20}"
APP_PORT="${APP_PORT:-5173}"
PM2_NAME="${PM2_NAME:-patygo}"
SITE_DOMAIN="${SITE_DOMAIN:-patygoteknoloji.com}"

sudo apt-get update -y
sudo apt-get install -y curl git nginx ufw

curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
cd "$APP_DIR"
npm install --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  echo ">>> .env oluşturuldu. SITE_BASE_URL=https://${SITE_DOMAIN} , ADMIN_PASSWORD ve AKBANK_* değerlerini düzenleyin."
  echo ">>> Canlıda SITE_BASE_URL asla IP veya localhost olmamalı."
fi

sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable || true

pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start server.js --name "$PM2_NAME"
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | bash || true

sudo tee /etc/nginx/sites-available/patygo >/dev/null <<NGINX
server {
  listen 80;
  server_name ${SITE_DOMAIN} www.${SITE_DOMAIN};
  root ${APP_DIR};
  location ^~ /api/ {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location = /assets/data/categories.json {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location ^~ /assets/data/ { return 404; }
  location ^~ /assets/ { try_files \$uri @node; }
  location = / { try_files /index.html @node; }
  location / { try_files \$uri.html @node; }
  location @node {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/patygo /etc/nginx/sites-enabled/patygo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo
echo "Kurulum tamam (sunucu bağımsız bootstrap)."
echo "1) $APP_DIR/.env → SITE_BASE_URL=https://${SITE_DOMAIN} (IP yok)"
echo "2) DNS A kayıtlarını (@ ve www) YENİ sunucu dış IP'sine yönlendirin"
echo "3) SSL: sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d ${SITE_DOMAIN} -d www.${SITE_DOMAIN}"
echo "4) GitHub Secrets: DEPLOY_HOST=${SITE_DOMAIN} (IP değil), DEPLOY_USER, DEPLOY_SSH_KEY"
echo "5) Tedarikçi XML whitelist’ine yeni çıkış IP’sini ekleyin"
echo "6) Doğrulama: curl -fsS https://${SITE_DOMAIN}/api/payment/status"
echo "7) Yerel süreç: curl -fsS http://127.0.0.1:${APP_PORT}/api/payment/status"
