#!/usr/bin/env python3
"""Ensure /assets/data/categories.json rewrites to listing snapshot on live nginx."""
import pathlib
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"
CONF = "/etc/nginx/sites-enabled/patygoteknoloji.com"
BLOCK = """
  location = /assets/data/categories.json {
    rewrite ^ /listing/categories.json last;
  }
""".strip()

REMOTE = f"""
python3 - <<'PY'
from pathlib import Path
import re
conf = Path({CONF!r})
text = conf.read_text(encoding="utf-8")
block = {BLOCK!r}
if "location = /assets/data/categories.json" in text:
    pat = r"  location = /assets/data/categories.json {{[\\s\\S]*?\\n  }}\\n"
    text2, n = re.subn(pat, block + "\\n\\n", text, count=1)
    if n == 1:
        conf.write_text(text2, encoding="utf-8")
        print("updated categories rewrite block")
    else:
        print("categories block unchanged")
else:
    pat = r"  location \\^~ /assets/data/ {{\\n    return 404;\\n  }}"
    if not re.search(pat, text):
        raise SystemExit("assets/data block not found")
    text = re.sub(
        pat,
        block + "\\n\\n  location ^~ /assets/data/ {{\\n    return 404;\\n  }}",
        text,
        count=1,
    )
    conf.write_text(text, encoding="utf-8")
    print("patched categories rewrite block")
PY
nginx -t
systemctl reload nginx
curl -sS -o /dev/null -w 'categories_public %{{http_code}} %{{time_total}}s\\n' https://patygoteknoloji.com/assets/data/categories.json
curl -sS https://patygoteknoloji.com/assets/data/categories.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('parents', len(d.get('categories') or []))"
curl -sS -o /dev/null -w 'products_json %{{http_code}}\\n' https://patygoteknoloji.com/assets/data/products.json
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
    time.sleep(10)
    print(o.read().decode("utf-8", errors="replace"))
    err = e.read().decode("utf-8", errors="replace").strip()
    if err:
        print("STDERR:", err[:2000])
    code = o.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
