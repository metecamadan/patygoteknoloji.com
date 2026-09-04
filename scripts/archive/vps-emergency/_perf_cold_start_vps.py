#!/usr/bin/env python3
"""Cold-start perf: restart PM2 then measure first requests."""
import pathlib
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"

CMD = r"""
pm2 restart patygo --update-env
sleep 2
python3 - <<'PY'
import json, time, urllib.request

def hit(url, timeout=30):
    t0 = time.perf_counter()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "cold-perf"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            res.read(4096)
            ms = round((time.perf_counter() - t0) * 1000, 1)
            return {"url": url, "status": res.status, "ms": ms}
    except Exception as e:
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"url": url, "error": type(e).__name__, "ms": ms}

urls = [
    "http://127.0.0.1:5173/api/payment/status",
    "http://127.0.0.1:5173/listing/categories.json",
    "https://patygoteknoloji.com/listing/categories.json",
    "https://patygoteknoloji.com/urunler",
]
for u in urls:
    print(json.dumps(hit(u), ensure_ascii=False))
PY
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
    time.sleep(35)
    print(o.read().decode("utf-8", errors="replace"))
    client.close()


if __name__ == "__main__":
    main()
