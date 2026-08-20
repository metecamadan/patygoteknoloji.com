#!/usr/bin/env python3
"""Compare live VPS vs local for key deploy markers."""
import hashlib
import pathlib
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"

FILES = [
    "server.js",
    "lib/order-mail.js",
    "assets/js/catalog.js",
    "assets/js/admin.js",
]

def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        "87.76.157.41",
        username="root",
        password=MIGRATE.read_text(encoding="utf-8").strip(),
        timeout=60,
        banner_timeout=60,
    )
    checks = [
        "grep -c injectCatalogBootstrapHtml /var/www/patygoteknoloji.com/server.js || true",
        "grep -c NOTIFY_STATUSES /var/www/patygoteknoloji.com/server.js || true",
        "test -f /var/www/patygoteknoloji.com/lib/order-mail.js && echo order_mail_yes || echo order_mail_no",
        "grep -c 'cancelled' /var/www/patygoteknoloji.com/lib/order-mail.js || true",
        "grep '^SMTP_HOST=' /var/www/patygoteknoloji.com/.env | sed 's/=.*/=***/'",
        "grep '^SMTP_USER=' /var/www/patygoteknoloji.com/.env | sed 's/=.*/=***/'",
        "python3 -c \"import os; p='/var/www/patygoteknoloji.com/.env'; t=open(p).read(); print('SMTP_PASS_set', bool([l for l in t.splitlines() if l.startswith('SMTP_PASS=') and len(l.split('=',1)[1].strip())>3]))\"",
        "grep -n 'location = /urunler' /etc/nginx/sites-enabled/patygoteknoloji.com | head -1",
        "gh run list --repo $(cd /var/www/patygoteknoloji.com && git remote get-url origin 2>/dev/null | sed 's/.*github.com[:/]//;s/.git$//') --limit 3 2>/dev/null || echo gh_unavailable",
        "cd /var/www/patygoteknoloji.com && git rev-parse --short HEAD && git status -sb | head -3",
    ]
    for cmd in FILES:
        local = ROOT / cmd.replace("/", pathlib.os.sep)
        remote_cmd = f"sha256sum /var/www/patygoteknoloji.com/{cmd} 2>/dev/null | cut -c1-16"
        _i, o, _e = client.exec_command(remote_cmd, timeout=30)
        time.sleep(0.5)
        remote_hash = o.read().decode().strip().split()[0] if o.read else ""
        # re-exec because o.read consumed - fix
    client.close()

    # simpler: one remote script
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        "87.76.157.41",
        username="root",
        password=MIGRATE.read_text(encoding="utf-8").strip(),
        timeout=60,
        banner_timeout=60,
    )
    remote = r"""cd /var/www/patygoteknoloji.com
echo '=== VPS git ==='
git rev-parse --short HEAD 2>/dev/null || echo no_git
git status -sb 2>/dev/null | head -2
echo '=== markers ==='
grep -c injectCatalogBootstrapHtml server.js 2>/dev/null || echo 0 bootstrap
grep -c 'function invalidateStorefrontCatalog' server.js
test -f lib/order-mail.js && grep -c cancelled lib/order-mail.js || echo no_order_mail
echo '=== smtp env ==='
grep -E '^SMTP_(HOST|USER|PORT)=' .env | sed 's/=.*/=***/'
python3 -c "t=open('.env').read().splitlines(); print('SMTP_PASS_set', any(l.startswith('SMTP_PASS=') and len(l.split('=',1)[1].strip())>3 for l in t))"
echo '=== nginx urunler ==='
grep -A2 'location = /urunler' /etc/nginx/sites-enabled/patygoteknoloji.com | head -3
echo '=== file hashes ==='
for f in server.js lib/order-mail.js assets/js/catalog.js; do sha256sum $f 2>/dev/null | awk '{print $1}' | cut -c1-16; done
"""
    _i, o, _e = client.exec_command(remote, timeout=60)
    time.sleep(3)
    print(o.read().decode("utf-8", errors="replace"))
    print("=== local hashes ===")
    for f in ["server.js", "lib/order-mail.js", "assets/js/catalog.js"]:
        p = ROOT / f
        print(f, sha(p) if p.exists() else "missing")
    client.close()


if __name__ == "__main__":
    main()
