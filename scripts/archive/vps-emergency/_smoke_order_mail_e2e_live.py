#!/usr/bin/env python3
"""Live end-to-end order status mail smoke: paid -> preparing -> cancelled."""
import pathlib
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8")
MIGRATE = pathlib.Path.home() / "Desktop" / "_migrate_pass.local"

CMD = r"""
set -e
cd /var/www/patygoteknoloji.com
export TEST_ORDER_MAIL_TO="${TEST_ORDER_MAIL_TO:-info@patygoteknoloji.com}"
echo "=== mail e2e to $TEST_ORDER_MAIL_TO ==="
for tpl in paid preparing cancelled; do
  echo "-- $tpl --"
  node scripts/send-test-order-mail.js "$tpl"
  sleep 8
done
echo '=== admin status mail hook markers ==='
grep -n 'sendOrderStatusMail' server.js | head -5
echo '=== NOTIFY_STATUSES ==='
node -e "const s=require('fs').readFileSync('server.js','utf8'); const m=s.match(/NOTIFY_STATUSES[^;]+/); console.log(m?m[0]:'missing');"
echo 'DONE e2e mail smoke'
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
    _i, o, e = client.exec_command(CMD, timeout=180)
    time.sleep(35)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    print(out)
    if err.strip():
        print("STDERR:", err[:2000])
    code = o.channel.recv_exit_status()
    client.close()
    raise SystemExit(code)


if __name__ == "__main__":
    main()
