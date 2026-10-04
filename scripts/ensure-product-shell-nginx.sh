#!/usr/bin/env bash
# Ensure live nginx serves /{kategori}/{slug} as disk urun-detay.html (no Node proxy)
# and 301s pre-fix product slugs listed in the Node-written legacy redirect map.
set -euo pipefail

APP_PORT="${1:-5173}"
APP_DIR="${APP_DIR:-/var/www/patygoteknoloji.com}"
MAP_FILE="${APP_DIR}/.runtime/nginx/legacy-product-redirects.map"
NGINX_CONF="$(grep -Rsl "server_name patygoteknoloji.com" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n 1 || true)"

if [ -z "${NGINX_CONF}" ] || [ ! -f "${NGINX_CONF}" ]; then
  echo "WARN: nginx site conf for patygoteknoloji.com not found; product shell not applied"
  exit 0
fi

# nginx -t fails on a missing include; Node fills the map after its first catalog warm.
mkdir -p "$(dirname "${MAP_FILE}")"
[ -f "${MAP_FILE}" ] || : > "${MAP_FILE}"

# map_hash_* may only be set once per http block.
HASH_DIRECTIVES=1
if grep -Rqs --exclude="$(basename "${NGINX_CONF}")" "map_hash_bucket_size\|map_hash_max_size" /etc/nginx; then
  HASH_DIRECTIVES=0
fi

BACKUP="$(mktemp /root/nginx-patygo-backup.XXXXXX)"
cp "${NGINX_CONF}" "${BACKUP}"

python3 - "${NGINX_CONF}" "${MAP_FILE}" "${HASH_DIRECTIVES}" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
map_file = sys.argv[2]
hash_directives = sys.argv[3] == "1"
text = path.read_text(encoding="utf-8")
original = text

desired = (
    "  # /{kategori}/{slug} ürün SEO — statik HTML shell; Node meşgul/restart iken 504 olmasın.\n"
    "  # Client urun-detay.js pathname'den ürünü çözer (/listing/*.json). ^~ /urunler/ ve /api/ önceliklidir.\n"
    "  location ~ ^/[a-z0-9-]+/[a-z0-9-]+/?$ {\n"
    "    if ($patygo_legacy_product) {\n"
    "      return 301 $patygo_legacy_product$is_args$args;\n"
    "    }\n"
    "    expires 60s;\n"
    "    add_header Cache-Control \"public\" always;\n"
    "    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;\n"
    "    add_header X-Frame-Options \"DENY\" always;\n"
    "    add_header X-Content-Type-Options \"nosniff\" always;\n"
    "    try_files /urun-detay.html =404;\n"
    "  }\n"
)

# Older runs left one copy of the block comments per deploy; drop every copy, then the block.
text = re.sub(r"\n[ \t]*# /\{kategori\}/\{slug\} [^\n]*", "", text)
text = re.sub(r"\n[ \t]*# Client urun-detay\.js pathname[^\n]*", "", text)
# The closing brace is matched at location indent so the nested if-block stays inside.
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

if "map $uri $patygo_legacy_product" not in text:
    block = ""
    if hash_directives and "map_hash_bucket_size" not in text:
        block += "map_hash_max_size 262144;\nmap_hash_bucket_size 256;\n"
    block += (
        "map $uri $patygo_legacy_product {\n"
        "  default \"\";\n"
        f"  include {map_file};\n"
        "}\n\n"
    )
    match = re.search(r"^server\s*\{", text, re.MULTILINE)
    if not match:
        raise SystemExit("Could not find server block for legacy redirect map")
    text = text[: match.start()] + block + text[match.start():]
    print("legacy product redirect map inserted before first server block")

if text != original:
    path.write_text(text, encoding="utf-8")
    print(f"product SEO shell location inserted before location / (replaced {n} old block(s))")
else:
    print("nginx already serves product SEO paths from disk shell with legacy 301")
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
echo "nginx reloaded with product SEO disk shell and legacy 301 map"

# Node rewrites the map after catalog refreshes; reload nginx when it changes.
cat > /etc/systemd/system/patygo-nginx-legacy.service <<UNIT
[Unit]
Description=Reload nginx after Patygo legacy product redirect map changes

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'nginx -t -q && systemctl reload nginx'
UNIT
cat > /etc/systemd/system/patygo-nginx-legacy.path <<UNIT
[Unit]
Description=Watch Patygo legacy product redirect map

[Path]
PathChanged=${MAP_FILE}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now patygo-nginx-legacy.path >/dev/null
echo "patygo-nginx-legacy.path active"
