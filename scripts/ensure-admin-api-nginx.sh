#!/usr/bin/env bash
# Ensure live nginx accepts admin uploads (product images, lead reply attachments up to 10 MB
# as base64 JSON). Only /api/admin/ gets the larger body limit; public /api/ keeps nginx's 1 MB.
set -euo pipefail

APP_PORT="${1:-5173}"
NGINX_CONF="$(grep -Rsl "server_name patygoteknoloji.com" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n 1 || true)"

if [ -z "${NGINX_CONF}" ] || [ ! -f "${NGINX_CONF}" ]; then
  echo "WARN: nginx site conf for patygoteknoloji.com not found; admin API body limit not applied"
  exit 0
fi

BACKUP="$(mktemp /root/nginx-patygo-backup.XXXXXX)"
cp "${NGINX_CONF}" "${BACKUP}"

python3 - "${NGINX_CONF}" "${APP_PORT}" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
port = sys.argv[2]
text = path.read_text(encoding="utf-8")
original = text

desired = (
    "  # Admin yüklemeleri (ürün görseli, talep yanıtı ekleri) base64 JSON gelir; yalnızca /api/admin/ büyük gövde alır.\n"
    "  location ^~ /api/admin/ {\n"
    "    client_max_body_size 16m;\n"
    f"    proxy_pass http://127.0.0.1:{port};\n"
    "    proxy_http_version 1.1;\n"
    "    proxy_set_header Host $host;\n"
    "    proxy_set_header X-Real-IP $remote_addr;\n"
    "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
    "    proxy_set_header X-Forwarded-Proto $scheme;\n"
    "    proxy_connect_timeout 5s;\n"
    "    proxy_read_timeout 120s;\n"
    "  }\n"
)

text = re.sub(r"\n[ \t]*# Admin yüklemeleri[^\n]*", "", text)
text = re.sub(
    r"\n?[ \t]*location[ \t]+\^~[ \t]+/api/admin/[ \t]*\{.*?\n(?: {0,2}|\t)\}\n?",
    "\n",
    text,
    flags=re.DOTALL,
)
needle = "  location ^~ /api/ {"
if needle not in text:
    raise SystemExit("Could not find location ^~ /api/ to insert admin API block before")
text = re.sub(r"\n{3,}", "\n\n", text)
text = text.replace(needle, desired + "\n" + needle, 1)

if text != original:
    path.write_text(text, encoding="utf-8")
    print("admin API location (client_max_body_size 16m) written before /api/")
else:
    print("nginx already has admin API body limit")
PY

if ! nginx -t; then
  echo "ERROR: nginx -t failed; restoring previous site conf"
  cat "${BACKUP}" > "${NGINX_CONF}"
  rm -f "${BACKUP}"
  nginx -t
  exit 1
fi
rm -f "${BACKUP}"
systemctl reload nginx
echo "nginx reloaded with admin API body limit"
