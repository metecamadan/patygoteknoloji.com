#!/usr/bin/env bash
# Ensure live nginx serves /{kategori}/{slug} as disk urun-detay.html (no Node proxy).
set -euo pipefail

APP_PORT="${1:-5173}"
NGINX_CONF="$(grep -Rsl "server_name patygoteknoloji.com" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n 1 || true)"

if [ -z "${NGINX_CONF}" ] || [ ! -f "${NGINX_CONF}" ]; then
  echo "WARN: nginx site conf for patygoteknoloji.com not found; product shell not applied"
  exit 0
fi

python3 - "${NGINX_CONF}" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

desired = (
    "  # /{kategori}/{slug} ürün SEO — statik HTML shell; Node meşgul/restart iken 504 olmasın.\n"
    "  # Client urun-detay.js pathname'den ürünü çözer (/listing/*.json). ^~ /urunler/ ve /api/ önceliklidir.\n"
    "  location ~ ^/[a-z0-9-]+/[a-z0-9-]+/?$ {\n"
    "    expires 60s;\n"
    "    add_header Cache-Control \"public\" always;\n"
    "    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;\n"
    "    add_header X-Frame-Options \"DENY\" always;\n"
    "    add_header X-Content-Type-Options \"nosniff\" always;\n"
    "    try_files /urun-detay.html =404;\n"
    "  }\n"
)

# Drop any existing product SEO regex location (stale proxy or older shell).
pattern = re.compile(
    r"\n?[ \t]*location[ \t]*~[ \t]*\^/\[a-z0-9-\]\+/\[a-z0-9-\]\+/\?\$[ \t]*\{.*?\n[ \t]*\}\n?",
    re.DOTALL,
)
cleaned, n = pattern.subn("\n", text)
if n:
    print(f"removed {n} existing product SEO location block(s)")
    text = cleaned

if (
    "location ~ ^/[a-z0-9-]+/[a-z0-9-]+/?$" in text
    and "try_files /urun-detay.html =404;" in text
):
    print("nginx already serves product SEO paths from disk shell")
    sys.exit(0)

needle = "  location / {"
if needle not in text:
    raise SystemExit("Could not find insertion point for product SEO location")
text = text.replace(needle, desired + "\n" + needle, 1)
print("product SEO shell location inserted before location /")

path.write_text(text, encoding="utf-8")
PY

nginx -t
systemctl reload nginx
echo "nginx reloaded with product SEO disk shell"
