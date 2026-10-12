#!/usr/bin/env bash
# The VPS also hosts other projects under their own Linux users (e.g. /var/www/acik-artirma).
# Only root (node/PM2) and nginx's group may enter the store directory; .env is root-only.
# nginx serves .runtime/media and .runtime/catalog-bootstrap directly, so the group keeps r-x.
set -euo pipefail

APP_DIR="${1:-/var/www/patygoteknoloji.com}"
WEB_GROUP="${2:-www-data}"

chown root:"${WEB_GROUP}" "${APP_DIR}"
chmod 750 "${APP_DIR}"
if [ -f "${APP_DIR}/.env" ]; then
  chown root:root "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
fi

if runuser -u nobody -- test -x "${APP_DIR}"; then
  echo "isolation FAILED: an unrelated user can enter ${APP_DIR}"
  exit 1
fi
if ! runuser -u "${WEB_GROUP}" -- test -x "${APP_DIR}"; then
  echo "isolation FAILED: nginx (${WEB_GROUP}) cannot enter ${APP_DIR}"
  exit 1
fi
echo "app dir isolated: $(stat -c '%a %U:%G' "${APP_DIR}") ${APP_DIR}"
