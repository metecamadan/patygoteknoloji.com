#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

import paramiko

HOST = "87.76.157.41"
USER = "root"
CMD = r"""
set -e
cd /var/www/patygoteknoloji.com
git fetch origin main
git reset --hard origin/main
pm2 restart patygo --update-env
sleep 10
python3 - <<'PY'
import json
import time
import urllib.request

UA = {"User-Agent": "patygo-smoke"}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as res:
        return json.loads(res.read().decode("utf-8"))


for i in range(6):
    try:
        get_json("https://patygoteknoloji.com/api/payment/status")
        break
    except Exception as err:
        print("warmup", i, type(err).__name__)
        time.sleep(3)

listing = get_json("https://patygoteknoloji.com/api/products?limit=48&page=1")
products = listing.get("products") or []
missing_desc = []
missing_details = []
for prod in products:
    desc = str(prod.get("description") or "").strip()
    details = str(prod.get("details") or "").strip()
    name = str(prod.get("name") or "").strip()
    if not desc or desc == name:
        missing_desc.append(prod.get("id"))
    if not details or details == name:
        missing_details.append(prod.get("id"))

print("listing_count", len(products))
print("missing_description", len(missing_desc))
print("missing_details", len(missing_details))
if products:
    sample = products[0]
    print("sample_id", sample.get("id"))
    print("sample_desc", (sample.get("description") or "")[:120])
    print("sample_details_prefix", (sample.get("details") or "")[:40])

lenovo = get_json(
    "https://patygoteknoloji.com/api/products?path=notebook/lenovo-v15-83a100kxtr-i7-1355u-40gb"
)
lp = (lenovo.get("products") or [{}])[0]
print("lenovo_has_psref_note", "PSREF" in str(lp.get("description") or "") or "doğrulanmış" in str(lp.get("description") or ""))
print("lenovo_spec_table", str(lp.get("details") or "").startswith("__SPEC_TABLE__"))
PY
"""


def password() -> str:
    return (Path.home() / "Desktop" / "_migrate_pass.local").read_text(encoding="utf-8").strip()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password(), timeout=30)
    stdin, stdout, stderr = client.exec_command(CMD, timeout=240)
    print(stdout.read().decode("utf-8", "replace"))
    err = stderr.read().decode("utf-8", "replace").strip()
    if err:
        print(err[:3000])
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
