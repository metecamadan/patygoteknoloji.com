#!/usr/bin/env bash
# Installs tools/image-bg (ONNX background removal, ~800 MB) on the VPS.
# Reinstalls only when its package-lock.json changes; the app keeps working without it.
set -euo pipefail

APP_DIR="${1:-/var/www/patygoteknoloji.com}"
TOOL_DIR="$APP_DIR/tools/image-bg"
LOCK="$TOOL_DIR/package-lock.json"
STAMP="$TOOL_DIR/node_modules/.patygo-lock-sha"

[ -f "$LOCK" ] || { echo "image-bg: no lockfile, skipped"; exit 0; }
WANT="$(sha256sum "$LOCK" | cut -d' ' -f1)"
HAVE="$(cat "$STAMP" 2>/dev/null || true)"
if [ "$WANT" = "$HAVE" ] && [ -f "$TOOL_DIR/node_modules/@imgly/background-removal-node/package.json" ]; then
  echo "image-bg: up to date"
  exit 0
fi
echo "image-bg: installing"
cd "$TOOL_DIR"
npm ci --omit=dev --no-audit --no-fund
printf '%s' "$WANT" > "$STAMP"
echo "image-bg: installed"
