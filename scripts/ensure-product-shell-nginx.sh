#!/usr/bin/env bash
# Ensure live nginx sends /{kategori}/{slug} and /urunler/* to Node (server-rendered head/h1/price)
# with a disk-shell fallback when Node is down or busy, 301s pre-fix product slugs via the
# Node-written exact-match include, redirects www → apex and keeps security headers on every location.
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

python3 - "${NGINX_CONF}" "${REDIRECTS_FILE}" "${APP_PORT}" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
redirects_file = sys.argv[2]
app_port = sys.argv[3]
text = path.read_text(encoding="utf-8")
original = text

REFERRER = 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;'
PERMISSIONS = 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;'
CSP = (
    "add_header Content-Security-Policy \"default-src 'self'; base-uri 'self'; object-src 'none'; "
    "frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https:; "
    "img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self'; "
    "form-action 'self' https://virtualpospaymentgatewaypre.akbank.com https://virtualpospaymentgateway.akbank.com\" always;"
)
SHELL_HEADERS = (
    "    expires 60s;\n"
    "    add_header Cache-Control \"public\" always;\n"
    "    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;\n"
    "    add_header X-Frame-Options \"DENY\" always;\n"
    "    add_header X-Content-Type-Options \"nosniff\" always;\n"
    f"    {REFERRER}\n"
    f"    {PERMISSIONS}\n"
    f"    {CSP}\n"
)


def node_proxy(fallback):
    # Node sends its own security headers; hide them so the server-level copies are not doubled.
    return (
        f"    proxy_pass http://127.0.0.1:{app_port};\n"
        "    proxy_http_version 1.1;\n"
        "    proxy_set_header Host $host;\n"
        "    proxy_set_header X-Real-IP $remote_addr;\n"
        "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "    proxy_set_header X-Forwarded-Proto $scheme;\n"
        "    proxy_connect_timeout 2s;\n"
        "    proxy_read_timeout 3s;\n"
        "    proxy_hide_header Strict-Transport-Security;\n"
        "    proxy_hide_header X-Frame-Options;\n"
        "    proxy_hide_header X-Content-Type-Options;\n"
        "    proxy_hide_header Referrer-Policy;\n"
        "    proxy_hide_header Permissions-Policy;\n"
        f"    error_page 502 503 504 = {fallback};\n"
    )


desired = (
    "  # Eski (İ → \"i-\") ürün slug'ları: Node'un yazdığı \"location = /eski { return 301 /yeni; }\" satırları.\n"
    "  # Dosya değişince patygo-nginx-legacy.path nginx'i yeniden yükler.\n"
    f"  include {redirects_file};\n"
    "  # /{kategori}/{slug} ürün SEO — Node başlık/açıklama/h1/fiyatı sunucuda yazar.\n"
    "  # Client urun-detay.js pathname'den ürünü çözer; Node kapalı/meşgulse @product_shell disk HTML'i (504 yok).\n"
    "  location ~ ^/[a-z0-9-]+/[a-z0-9-]+/?$ {\n"
    + node_proxy("@product_shell")
    + "  }\n"
    "\n"
    "  location @product_shell {\n"
    + SHELL_HEADERS
    + "    try_files /urun-detay.html =404;\n"
    "  }\n"
    "\n"
    "  # Kategori path URL'leri: Node başlık/h1/kanonik yazar; Node kapalı/meşgulse @catalog_shell.\n"
    "  location ^~ /urunler/ {\n"
    + node_proxy("@catalog_shell")
    + "  }\n"
    "\n"
    "  location @catalog_shell {\n"
    + SHELL_HEADERS
    + "    try_files /urunler.html =404;\n"
    "  }\n"
    "\n"
    "  location = /.well-known/security.txt {\n"
    "    default_type text/plain;\n"
    "    charset utf-8;\n"
    "    try_files $uri =404;\n"
    "  }\n"
)

# Older runs left one copy of the block comments per deploy; drop every copy, then the blocks.
for comment in (
    r"# /\{kategori\}/\{slug\} ",
    r"# Client urun-detay\.js pathname",
    r"# Eski \(İ → ",
    r"# Dosya değişince patygo-nginx-legacy",
    r"# Kategori path URL'leri",
    r"# Client pathname'den ANA",
):
    text = re.sub(r"\n[ \t]*" + comment + r"[^\n]*", "", text)
text = re.sub(r"\n[ \t]*include [^\n]*legacy-product-redirects\.conf;", "", text)
removed = 0
for head in (
    r"location[ \t]*~[ \t]*\^/\[a-z0-9-\]\+/\[a-z0-9-\]\+/\?\$",
    r"location[ \t]+\^~[ \t]+/urunler/",
    r"location[ \t]+@product_shell",
    r"location[ \t]+@catalog_shell",
    r"location[ \t]*=[ \t]*/\.well-known/security\.txt",
):
    block = re.compile(r"\n?[ \t]*" + head + r"[ \t]*\{.*?\n(?: {0,2}|\t)\}\n?", re.DOTALL)
    text, n = block.subn("\n", text)
    removed += n
needle = "  location / {"
if needle not in text:
    raise SystemExit("Could not find insertion point for product SEO location")
text = re.sub(r"\n{3,}", "\n\n", text)
text = text.replace(needle, desired + "\n" + needle, 1)

# www → apex inside the TLS server (the port-80 block stays as certbot wrote it).
WWW_MARK = "# patygo-www-apex"
if WWW_MARK not in text:
    root_line = re.search(r"\n([ \t]*)root /var/www/patygoteknoloji\.com;\n", text)
    if not root_line:
        raise SystemExit("Could not find root line for www redirect")
    indent = root_line.group(1)
    text = (
        text[: root_line.end()]
        + f"{indent}{WWW_MARK}: tek kanonik host\n"
        + f"{indent}if ($host = www.patygoteknoloji.com) {{ return 301 https://patygoteknoloji.com$request_uri; }}\n"
        + text[root_line.end():]
    )

# Any location with its own add_header drops the server-level set; keep Referrer/Permissions everywhere.
text = re.sub(
    r'(\n([ \t]{4,})add_header X-Content-Type-Options "nosniff" always;)(?!\n[ \t]*add_header Referrer-Policy)',
    lambda m: m.group(1) + "\n" + m.group(2) + REFERRER + "\n" + m.group(2) + PERMISSIONS,
    text,
)

# Disk-served storefront HTML gets the same CSP Node sends (admin keeps its inline bootstrap).
for head in ("  location = / {", "  location = /urunler {", "  location / {"):
    start = text.find("\n" + head)
    if start < 0:
        continue
    end = text.find("\n  }", start + 1)
    block = text[start:end]
    if "Content-Security-Policy" in block:
        continue
    anchor = "\n    " + PERMISSIONS
    if anchor not in block:
        continue
    block = block.replace(anchor, anchor + "\n    " + CSP, 1)
    text = text[:start] + block + text[end:]

if text != original:
    path.write_text(text, encoding="utf-8")
    print(f"product SEO proxy + shell fallback inserted before location / (replaced {removed} old block(s))")
else:
    print("nginx already proxies product/category SEO paths with disk shell fallback")
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
echo "nginx reloaded with product SEO proxy, shell fallback and legacy 301 include"

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
