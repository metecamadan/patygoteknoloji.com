#!/usr/bin/env python3
"""Apply static /urunler nginx block on live VPS (preserve SSL lines)."""
import pathlib
import re
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"
CONF = "/etc/nginx/sites-enabled/patygoteknoloji.com"
STATIC_BLOCK = """
  location = /urunler {
    expires 60s;
    add_header Cache-Control "public" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    try_files /urunler.html =404;
  }
""".strip(
    "\n"
)

REMOTE = rf"""
python3 - <<'PY'
from pathlib import Path
import re
conf = Path("{CONF}")
text = conf.read_text(encoding="utf-8")
new_block = {repr(STATIC_BLOCK)}
pat = r"  location = /urunler \{{[\s\S]*?\n  \}}\n"
if not re.search(pat, text):
    raise SystemExit("urunler location block not found")
text2, n = re.subn(pat, new_block + "\n\n", text, count=1)
if n != 1:
    raise SystemExit(f"replace count {{n}}")
conf.write_text(text2, encoding="utf-8")
print("patched urunler block")
PY
nginx -t
systemctl reload nginx
grep -A6 'location = /urunler' {CONF}
curl -sS -o /dev/null -w 'urunler_public %{{http_code}} %{{time_total}}s\\n' https://patygoteknoloji.com/urunler
curl -sS https://patygoteknoloji.com/urunler | grep -c data-catalog-infinite || true
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        "87.76.157.41",
        username="root",
        password=MIGRATE.read_text(encoding="utf-8").strip(),
        timeout=60,
    )
    _i, o, e = client.exec_command(REMOTE, timeout=120)
    time.sleep(8)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    print(out)
    if err.strip():
        print("STDERR:", err[:2000])
    code = o.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
