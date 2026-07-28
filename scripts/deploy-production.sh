#!/usr/bin/env bash
# GitHub Actions deploy adımından çağrılır (sunucuda /var/www/patygo).
set -euo pipefail

APP_DIR="/var/www/patygo"
cd "$APP_DIR"

echo "Deploying $(git rev-parse --short HEAD) -> origin/main"
git fetch origin main
git checkout main
git pull --ff-only origin main

if [ -n "${ADMIN_PASSWORD:-}" ]; then
  if [ -f .env ] && grep -q '^ADMIN_PASSWORD=' .env; then
    sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASSWORD}/" .env
  else
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> .env
  fi
  echo "ADMIN_PASSWORD synced from GitHub secret."
fi

npm ci --omit=dev
pm2 restart patygo --update-env
sleep 2
curl -fsS "http://127.0.0.1:5173/api/payment/status" >/dev/null
echo "Deploy OK: $(git rev-parse --short HEAD)"
