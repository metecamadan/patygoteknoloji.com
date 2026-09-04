#!/usr/bin/env bash
# Ensure live nginx proxies /sitemap.xml to Node (dynamic storefront sitemap).
set -euo pipefail

APP_PORT="${1:-5173}"
NGINX_CONF="$(grep -Rsl "server_name patygoteknoloji.com" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n 1 || true)"

if [ -z "${NGINX_CONF}" ] || [ ! -f "${NGINX_CONF}" ]; then
  echo "WARN: nginx site conf for patygoteknoloji.com not found; sitemap proxy not applied"
  exit 0
fi

python3 - "${NGINX_CONF}" "${APP_PORT}" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
port = sys.argv[2]
text = path.read_text(encoding="utf-8")

desired = (
    "  location = /sitemap.xml {\n"
    f"    proxy_pass http://127.0.0.1:{port};\n"
    "    proxy_http_version 1.1;\n"
    "    proxy_set_header Host $host;\n"
    "    proxy_set_header X-Real-IP $remote_addr;\n"
    "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
    "    proxy_set_header X-Forwarded-Proto $scheme;\n"
    "    proxy_connect_timeout 3s;\n"
    "    proxy_read_timeout 15s;\n"
    "  }\n"
)

# Drop any existing /sitemap.xml location (static try_files/=404 or stale proxy).
pattern = re.compile(
    r"\n?[ \t]*location[ \t]*=[ \t]*/sitemap\.xml[ \t]*\{.*?\n[ \t]*\}\n?",
    re.DOTALL,
)
cleaned, n = pattern.subn("\n", text)
if n:
    print(f"removed {n} existing location = /sitemap.xml block(s)")
    text = cleaned

if f"proxy_pass http://127.0.0.1:{port};" in text and "location = /sitemap.xml" in text:
    print("nginx already proxies /sitemap.xml to Node")
    sys.exit(0)

needle = "  location = /urun-detay {"
if needle in text:
    text = text.replace(needle, desired + "\n" + needle, 1)
    print("sitemap location inserted before /urun-detay")
else:
    alt = "  location / {"
    if alt not in text:
        raise SystemExit("Could not find insertion point for /sitemap.xml")
    text = text.replace(alt, desired + "\n" + alt, 1)
    print("sitemap location inserted before location /")

path.write_text(text, encoding="utf-8")
PY

nginx -t
systemctl reload nginx
echo "nginx reloaded with /sitemap.xml proxy"
