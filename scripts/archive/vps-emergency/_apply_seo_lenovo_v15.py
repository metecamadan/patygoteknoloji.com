#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

import paramiko

HOST = "87.76.157.41"
USER = "root"
CMD = r"""
set -e
cd /var/www/patygoteknoloji.com
node scripts/apply-supplier-seo-override.js scripts/content/sup-150-20-10-0738-237e44a9.json
pm2 restart patygo --update-env
sleep 6
python3 - <<'PY'
import json, urllib.request
req = urllib.request.Request(
    "https://patygoteknoloji.com/api/products?id=sup-150-20-10-0738-237e44a9",
    headers={"User-Agent": "patygo-seo-smoke"},
)
with urllib.request.urlopen(req, timeout=30) as res:
    data = json.loads(res.read().decode("utf-8"))
products = data.get("products") or []
if not products:
    raise SystemExit("product missing from public API")
item = products[0]
desc = str(item.get("description") or "")
details = str(item.get("details") or "")
print("name", (item.get("name") or "")[:72])
print("description_len", len(desc))
print("details_len", len(details))
print("has_psref", "PSREF" in details)
print("has_40gb", "40 GB" in desc or "40 GB" in details)
if len(desc) < 80 or len(details) < 400:
    raise SystemExit("description too short after override")
PY
"""


def password() -> str:
    return (Path.home() / "Desktop" / "_migrate_pass.local").read_text(encoding="utf-8").strip()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password(), timeout=30)
    stdin, stdout, stderr = client.exec_command(CMD, timeout=180)
    print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace").strip()
    if err:
        print(err, file=sys.stderr)
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
