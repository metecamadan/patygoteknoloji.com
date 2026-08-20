#!/usr/bin/env python3
"""Review live SMTP configuration and send capability (no secrets printed)."""
import pathlib
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"

CMD = r"""
set -e
cd /var/www/patygoteknoloji.com
echo '=== SMTP env (masked) ==='
grep -E '^SMTP_(HOST|PORT|USER|SECURE|FROM)=' .env | sed 's/=\(.*\)/=***/'
python3 - <<'PY'
from pathlib import Path
lines = Path(".env").read_text(encoding="utf-8").splitlines()
pass_set = any(
    l.startswith("SMTP_PASS=") and len(l.split("=", 1)[1].strip()) > 3
    for l in lines
)
print("SMTP_PASS_set", pass_set)
PY
echo '=== runtime check ==='
node -e "require('dotenv').config({quiet:true}); const {smtpConfigured}=require('./lib/contact'); console.log('smtpConfigured', smtpConfigured(process.env));"
echo '=== order mail templates ==='
node -e "const t=require('./lib/order-mail').ORDER_MAIL_TEMPLATES; console.log(Object.keys(t).join(','));"
echo '=== dry send (paid template, no claim) ==='
node scripts/send-test-order-mail.js paid
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
    time.sleep(20)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    print(out)
    if err.strip():
        print("STDERR:", err[:1500])
    client.close()


if __name__ == "__main__":
    main()
