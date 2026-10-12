#!/usr/bin/env bash
# Installs deploy/nginx-*.conf on the VPS so the repo stays the single source of nginx config.
#   install-nginx-conf.sh install <app_dir>  — refuse if live was hand-edited since the last deploy,
#                                             otherwise install, nginx -t (restore on failure), reload
#   install-nginx-conf.sh record  <app_dir>  — after the ensure-*-nginx.sh helpers: remember what is live
set -euo pipefail

MODE="${1:-install}"
APP_DIR="${2:-/var/www/patygoteknoloji.com}"
STATE_DIR="/root/.patygo-nginx"
SITE_SRC="${APP_DIR}/deploy/nginx-patygoteknoloji.com.conf"
SITE_DEST="/etc/nginx/sites-available/patygoteknoloji.com"
HARDENING_SRC="${APP_DIR}/deploy/nginx-patygo-hardening.conf"
HARDENING_DEST="/etc/nginx/conf.d/00-patygo-hardening.conf"

mkdir -p "${STATE_DIR}"

pairs() {
  printf '%s %s site\n' "${SITE_SRC}" "${SITE_DEST}"
  printf '%s %s hardening\n' "${HARDENING_SRC}" "${HARDENING_DEST}"
}

if [ "${MODE}" = "record" ]; then
  while read -r _src dest name; do
    cp "${dest}" "${STATE_DIR}/${name}.deployed"
  done < <(pairs)
  echo "nginx: live config recorded"
  exit 0
fi

# A hand edit on the server would be silently lost; stop and show it so it can be moved into the repo.
drift=0
while read -r _src dest name; do
  recorded="${STATE_DIR}/${name}.deployed"
  if [ -f "${dest}" ] && [ -f "${recorded}" ] && ! cmp -s "${dest}" "${recorded}"; then
    echo "ERROR: ${dest} was edited on the server after the last deploy; copy the change into the repo first:"
    diff -u "${recorded}" "${dest}" || true
    drift=1
  fi
done < <(pairs)
[ "${drift}" = "0" ] || exit 1

BACKUP_DIR="$(mktemp -d /root/nginx-patygo-backup.XXXXXX)"
changed=0
while read -r src dest name; do
  [ -f "${src}" ] || { echo "ERROR: ${src} missing"; exit 1; }
  tmp="${BACKUP_DIR}/${name}.new"
  tr -d '\r' < "${src}" > "${tmp}"
  [ -f "${dest}" ] && cp "${dest}" "${BACKUP_DIR}/${name}.old"
  if [ -f "${dest}" ] && cmp -s "${tmp}" "${dest}"; then
    continue
  fi
  echo "nginx: ${dest} updated from repo"
  [ -f "${dest}" ] && { diff -u "${dest}" "${tmp}" || true; }
  cat "${tmp}" > "${dest}"
  changed=1
done < <(pairs)

if [ "${changed}" = "0" ]; then
  rm -rf "${BACKUP_DIR}"
  echo "nginx: live config already matches repo"
  exit 0
fi

if ! nginx -t; then
  echo "ERROR: nginx -t failed; restoring previous config"
  while read -r _src dest name; do
    if [ -f "${BACKUP_DIR}/${name}.old" ]; then
      cat "${BACKUP_DIR}/${name}.old" > "${dest}"
    fi
  done < <(pairs)
  nginx -t
  rm -rf "${BACKUP_DIR}"
  exit 1
fi
rm -rf "${BACKUP_DIR}"
systemctl reload nginx
echo "nginx: reloaded with repo config"
