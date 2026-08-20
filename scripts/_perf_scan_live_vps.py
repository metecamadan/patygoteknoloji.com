#!/usr/bin/env python3
"""Live performance scan — storefront + admin (gzip-aware on VPS loopback)."""
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"
PUBLIC = "https://patygoteknoloji.com"

REMOTE = r"""
python3 - <<'PY'
import json, time, urllib.request, os

def fetch(url, headers=None, timeout=30):
    h = {"User-Agent": "patygo-perf-scan", "Accept-Encoding": "gzip"}
    if headers:
        h.update(headers)
    t0 = time.perf_counter()
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        body = res.read()
        elapsed = (time.perf_counter() - t0) * 1000
        enc = res.headers.get("Content-Encoding", "")
        ctype = res.headers.get("Content-Type", "")
        clen = len(body)
        return {
            "status": res.status,
            "ms": round(elapsed, 1),
            "bytes": clen,
            "encoding": enc or "identity",
            "ctype": ctype.split(";")[0],
        }

def seq_round(base, paths, label):
    print(f"=== {label} ===")
    for p in paths:
        url = base + p
        try:
            r = fetch(url)
            print(json.dumps({"path": p, **r}, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"path": p, "error": type(e).__name__, "msg": str(e)[:120]}))

paths = [
    "/listing/all.json",
    "/listing/categories.json",
    "/listing/home-featured.json",
    "/api/catalog-bootstrap",
    "/api/products?homeFeatured=1&limit=12",
    "/api/payment/status",
    "/urunler",
    "/admin",
    "/assets/js/admin.js",
    "/assets/js/catalog.js",
]

seq_round("http://127.0.0.1:5173", paths, "Node loopback (1. tur)")
seq_round("http://127.0.0.1:5173", [
    "/listing/categories.json",
    "/api/payment/status",
], "Node loopback (2. tur — kuyruk)")
seq_round("https://patygoteknoloji.com", [
    "/listing/all.json",
    "/listing/categories.json",
    "/listing/home-featured.json",
    "/api/payment/status",
    "/urunler",
    "/admin",
], "Public HTTPS (gzip)")
PY
ls -la /var/www/patygoteknoloji.com/.runtime/catalog-bootstrap/categories.json \
      /var/www/patygoteknoloji.com/.runtime/catalog-bootstrap/home-featured.json \
      /var/www/patygoteknoloji.com/.runtime/catalog-bootstrap/all.json 2>/dev/null | awk '{print $5,$9}'
wc -c /var/www/patygoteknoloji.com/assets/js/admin.js | awk '{print "admin_js_bytes", $1}'
grep -n 'script.*admin.js' /var/www/patygoteknoloji.com/admin.html | head -1
pm2 jlist 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); p=d[0] if d else {}; print('pm2_instances', len(d), 'mem_mb', round((p.get('monit') or {}).get('memory',0)/1024/1024,1), 'cpu', (p.get('monit') or {}).get('cpu'))"
"""


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        "87.76.157.41",
        username="root",
        password=MIGRATE.read_text(encoding="utf-8").strip(),
        timeout=60,
    )
    _i, o, _e = client.exec_command(REMOTE, timeout=180)
    time.sleep(45)
    print(o.read().decode("utf-8", errors="replace"))
    client.close()


if __name__ == "__main__":
    main()
