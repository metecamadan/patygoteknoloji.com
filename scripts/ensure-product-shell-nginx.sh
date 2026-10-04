#!/usr/bin/env bash
# Ensure live nginx serves /{kategori}/{slug} as disk urun-detay.html (no Node proxy)
# and 301s pre-fix product slugs via the Node-written exact-match location include.
set -euo pipefail

APP_PORT="${1:-5173}"
APP_DIR="${APP_DIR:-/var/www/patygoteknoloji.com}"
REDIRECTS_FILE="${APP_DIR}/.runtime/nginx/legacy-product-redirects.conf"
NGINX_CONF="$(grep -Rsl "server_name patygoteknoloji.com" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n 1 || true)"

if [ -z "${NGINX_CONF}" ] || [ ! -f "${NGINX_CONF}" ]; then
  echo "WARN: nginx site conf for patygoteknoloji.com not found; product shell not applied"
  exit 0
fi

# nginx -t fails on a missing include; Node fills the file after its first catalog warm.
mkdir -p "$(dirname "${REDIRECTS_FILE}")"
[ -f "${REDIRECTS_FILE}" ] || : > "${REDIRECTS_FILE}"
rm -f "$(dirname "${REDIRECTS_FILE}")/legacy-product-redirects.map"

BACKUP="$(mktemp /root/nginx-patygo-backup.XXXXXX)"
cp "${NGINX_CONF}" "${BACKUP}"

python3 - "${NGINX_CONF}" "${REDIRECTS_FILE}" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
redirects_file = sys.argv[2]
text = path.read_text(encoding="utf-8")
original = text

desired = (
    "  # Eski (İ → \"i-\") ürün slug'ları: Node'un yazdığı \"location = /eski { return 301 /yeni; }\" satırları.\n"
    "  # Dosya değişince patygo-nginx-legacy.path nginx'i yeniden yükler.\n"
    f"  include {redirects_file};\n"
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

# Older runs left one copy of the block comments per deploy; drop every copy, then the block.
for comment in (
    r"# /\{kategori\}/\{slug\} ",
    r"# Client urun-detay\.js pathname",
    r"# Eski \(İ → ",
    r"# Dosya değişince patygo-nginx-legacy",
):
    text = re.sub(r"\n[ \t]*" + comment + r"[^\n]*", "", text)
text = re.sub(r"\n[ \t]*include [^\n]*legacy-product-redirects\.conf;", "", text)
pattern = re.compile(
    r"\n?[ \t]*location[ \t]*~[ \t]*\^/\[a-z0-9-\]\+/\[a-z0-9-\]\+/\?\$[ \t]*\{.*?\n(?: {0,2}|\t)\}\n?",
    re.DOTALL,
)
text, n = pattern.subn("\n", text)
needle = "  location / {"
if needle not in text:
    raise SystemExit("Could not find insertion point for product SEO location")
text = re.sub(r"\n{3,}(?=  location / \{)", "\n\n", text, count=1)
text = text.replace(needle, desired + "\n" + needle, 1)

if text != original:
    path.write_text(text, encoding="utf-8")
    print(f"product SEO shell location inserted before location / (replaced {n} old block(s))")
else:
    print("nginx already serves product SEO paths from disk shell with legacy 301 include")
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
echo "nginx reloaded with product SEO disk shell and legacy 301 include"

# Node rewrites the include after catalog refreshes; reload nginx when it changes.
cat > /etc/systemd/system/patygo-nginx-legacy.service <<UNIT
[Unit]
Description=Reload nginx after Patygo legacy product redirects change

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'nginx -t -q && systemctl reload nginx'
UNIT
cat > /etc/systemd/system/patygo-nginx-legacy.path <<UNIT
[Unit]
Description=Watch Patygo legacy product redirects

[Path]
PathChanged=${REDIRECTS_FILE}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now patygo-nginx-legacy.path >/dev/null
echo "patygo-nginx-legacy.path active"
