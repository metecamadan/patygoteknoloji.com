#!/usr/bin/env bash
# Append deploy/agent-laptop.pub to root authorized_keys if missing (idempotent).
set -euo pipefail

APP_DIR="${1:-/var/www/patygoteknoloji.com}"
PUB_FILE="${APP_DIR}/deploy/agent-laptop.pub"
AUTH_KEYS="/root/.ssh/authorized_keys"

if [ ! -f "${PUB_FILE}" ]; then
  echo "WARN: ${PUB_FILE} missing; agent laptop key not installed"
  exit 0
fi

# Strip CR so Windows-committed pub files still match.
PUB_LINE="$(tr -d '\r' < "${PUB_FILE}" | head -n 1 | sed 's/[[:space:]]*$//')"
if [ -z "${PUB_LINE}" ] || ! printf '%s' "${PUB_LINE}" | grep -Eq '^ssh-(ed25519|rsa|ecdsa) '; then
  echo "WARN: ${PUB_FILE} has no usable OpenSSH public key line"
  exit 0
fi

mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"

if grep -Fqx "${PUB_LINE}" "${AUTH_KEYS}" 2>/dev/null; then
  echo "agent laptop key already in authorized_keys"
  exit 0
fi

# Also skip if the same key material (first two fields) already exists with another comment.
KEY_CORE="$(printf '%s' "${PUB_LINE}" | awk '{print $1" "$2}')"
if grep -Fq "${KEY_CORE}" "${AUTH_KEYS}" 2>/dev/null; then
  echo "agent laptop key material already in authorized_keys"
  exit 0
fi

printf '\n%s\n' "${PUB_LINE}" >> "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"
echo "agent laptop key appended to authorized_keys"
