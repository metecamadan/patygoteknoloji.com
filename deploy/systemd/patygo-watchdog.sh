#!/usr/bin/env bash
# Node event loop kilitlenmesini tespit eder; PM2'yi yalnizca gercek cevapsizlikta yeniden baslatir.
# Disk I/O bozuksa restart tetiklemez (onceki unclean shutdown gurultusunu onler).
set -euo pipefail

export PM2_HOME="${PM2_HOME:-/root/.pm2}"
PROBE="${PATYGO_WATCHDOG_PROBE:-http://127.0.0.1:5173/api/payment/status}"
TIMEOUT="${PATYGO_WATCHDOG_TIMEOUT:-8}"
NEED_FAILS="${PATYGO_WATCHDOG_FAILS:-2}"
MIN_INTERVAL="${PATYGO_WATCHDOG_COOLDOWN:-300}"
STATE="/run/patygo-wd.fail"
COOL="/run/patygo-wd.cool"
LOG="/var/log/patygo-watchdog.log"

log() {
  echo "$(date '+%F %T') $*" >>"$LOG"
}

if ! touch /run/patygo-wd.ping 2>/dev/null; then
  log "DISK IO - watchdog atlandi"
  exit 0
fi
rm -f /run/patygo-wd.ping

PM2BIN=""
for c in /usr/bin/pm2 /usr/local/bin/pm2 /usr/lib/node_modules/pm2/bin/pm2 /root/.npm-global/bin/pm2; do
  if [ -x "$c" ]; then
    PM2BIN="$c"
    break
  fi
done
if [ -z "$PM2BIN" ]; then
  log "HATA: pm2 bulunamadi"
  exit 1
fi

if curl -fsS -o /dev/null --max-time "$TIMEOUT" "$PROBE" 2>/dev/null; then
  if [ -f "$STATE" ]; then
    rm -f "$STATE"
    log "TOPARLANDI - saglikli"
  fi
  exit 0
fi

N=0
if [ -f "$STATE" ]; then
  N="$(cat "$STATE" 2>/dev/null || echo 0)"
fi
N=$((N + 1))
echo "$N" >"$STATE"
log "CEVAP YOK ($N/$NEED_FAILS) - ${TIMEOUT}sn icinde yanit alinamadi"

if [ "$N" -lt "$NEED_FAILS" ]; then
  exit 0
fi

NOW="$(date +%s)"
LAST=0
if [ -f "$COOL" ]; then
  LAST="$(cat "$COOL" 2>/dev/null || echo 0)"
fi
if [ $((NOW - LAST)) -lt "$MIN_INTERVAL" ]; then
  log "BEKLEME - son restart $((NOW - LAST))sn once (min ${MIN_INTERVAL}sn)"
  exit 0
fi

echo "$NOW" >"$COOL"
log "RESTART tetikleniyor (kilitlenme)"
"$PM2BIN" restart patygo --update-env >>"$LOG" 2>&1
rm -f "$STATE"
log "RESTART tamamlandi"
