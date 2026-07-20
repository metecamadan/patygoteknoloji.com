#!/usr/bin/env bash
# Patygo — Google Compute Engine kurulum özeti (Ubuntu 22.04/24.04)
# VM açıldıktan sonra SSH ile çalıştırın.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/patygo}"
REPO_URL="${REPO_URL:-https://github.com/metecamadan/patygoteknoloji.com.git}"
NODE_MAJOR="${NODE_MAJOR:-20}"

sudo apt-get update -y
sudo apt-get install -y curl git nginx ufw

# Node.js LTS
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Uygulama
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
  echo ">>> .env oluşturuldu. SITE_BASE_URL, ADMIN_PASSWORD ve AKBANK_* değerlerini düzenleyin."
fi

# Firewall: SSH + HTTP/HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable || true

# PM2
pm2 delete patygo 2>/dev/null || true
pm2 start server.js --name patygo
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | bash || true

# Nginx reverse proxy (80 -> 5173)
sudo tee /etc/nginx/sites-available/patygo >/dev/null <<'NGINX'
server {
  listen 80;
  server_name _;
  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/patygo /etc/nginx/sites-enabled/patygo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo
echo "Kurulum tamam."
echo "1) $APP_DIR/.env dosyasını düzenleyin (SITE_BASE_URL=https://patygoteknoloji.com)"
echo "2) Domain A kaydını bu VM'nin dış IP'sine yönlendirin"
echo "3) SSL: sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d patygoteknoloji.com -d www.patygoteknoloji.com"
echo "4) pm2 status / curl -I http://127.0.0.1:5173"
