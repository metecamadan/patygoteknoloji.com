#!/usr/bin/env python3
"""Post-sync VPS verification."""
import pathlib
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"

CMD = r"""
set -e
pm2 status patygo | tail -3
echo '=== loopback ==='
curl -fsS --max-time 10 http://127.0.0.1:5173/api/payment/status | head -c 220; echo
curl -fsS --max-time 20 -o /dev/null -w 'urunler_node %{http_code}\n' http://127.0.0.1:5173/urunler
curl -fsS --max-time 15 -o /dev/null -w 'public_pay %{http_code}\n' https://patygoteknoloji.com/api/payment/status
curl -fsS --max-time 20 'http://127.0.0.1:5173/api/catalog-bootstrap' | python3 -c "import sys,json; d=json.load(sys.stdin); print('bootstrap', d.get('total'), len(d.get('products') or []))"
curl -fsS --max-time 20 'http://127.0.0.1:5173/api/catalog/bootstrap?path=/urunler' | python3 -c "import sys,json; d=json.load(sys.stdin); print('bootstrap_alias', d.get('total'), len(d.get('products') or []))"
echo '=== git ==='
cd /var/www/patygoteknoloji.com
git rev-parse --short HEAD
git status -sb | head -3
for f in server.js lib/order-mail.js assets/js/catalog.js; do
  sha256sum "$f" | awk '{print $1}' | cut -c1-16
done
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
    _i, o, _e = client.exec_command(CMD, timeout=120)
    time.sleep(12)
    print(o.read().decode("utf-8", errors="replace"))
    client.close()


if __name__ == "__main__":
    main()
