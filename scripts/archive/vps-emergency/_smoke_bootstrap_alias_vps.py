#!/usr/bin/env python3
"""Quick VPS loopback checks after deploy."""
import pathlib
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"

CMD = r"""
sleep 5
curl -sS --max-time 15 http://127.0.0.1:5173/api/payment/status | head -c 180; echo
curl -sS --max-time 25 -o /dev/null -w 'urunler %{http_code}\n' http://127.0.0.1:5173/urunler
curl -sS --max-time 20 'http://127.0.0.1:5173/api/catalog-bootstrap' | python3 -c "import sys,json; d=json.load(sys.stdin); print('primary', d.get('total'))"
curl -sS --max-time 20 'http://127.0.0.1:5173/api/catalog/bootstrap?path=/urunler' | python3 -c "import sys,json; d=json.load(sys.stdin); print('alias', d.get('total'))"
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
    _i, o, e = client.exec_command(CMD, timeout=120)
    time.sleep(70)
    print(o.read().decode("utf-8", errors="replace"))
    err = e.read().decode("utf-8", errors="replace")
    if err.strip():
        print("ERR", err[:1000])
    client.close()


if __name__ == "__main__":
    main()
