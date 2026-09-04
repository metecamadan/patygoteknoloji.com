#!/usr/bin/env python3
"""Deploy shipping notify UX fix + resend mail for PTY-260818-45821A."""
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parents[1]
MIGRATE = Path.home() / "Desktop" / "_migrate_pass.local"
REMOTE = "/var/www/patygoteknoloji.com"
ORDER_ID = "PTY-260818-45821A"

FILES = [
    "server.js",
    "lib/orders.js",
    "assets/js/admin.js",
    "assets/css/admin.css",
]


def main():
    password = MIGRATE.read_text(encoding="utf-8").strip()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("87.76.157.41", username="root", password=password, timeout=60)
    sftp = client.open_sftp()
    for rel in FILES:
        local = ROOT / rel.replace("/", "\\") if "\\" not in rel else ROOT / rel
        remote = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        sftp.put(str(local), remote)
        print("uploaded", rel)
    sftp.close()

    resend_py = f"""
import json, urllib.request
from pathlib import Path
from dotenv import dotenv_values
env = dotenv_values('{REMOTE}/.env')
import os
os.chdir('{REMOTE}')
# admin login via env password not available; use node one-liner for resend
"""
    cmd = f"""
cd {REMOTE} && pm2 restart patygo && sleep 3
node - <<'NODE'
require('dotenv').config({{ quiet: true }});
const {{ createOrderStore }} = require('./lib/orders');
const {{ sendOrderStatusMail }} = require('./lib/order-mail');
const path = require('path');
const dataRoot = path.join(process.cwd(), '.runtime');
const store = createOrderStore(dataRoot);
const orderId = '{ORDER_ID}';
const order = store.get(orderId);
if (!order) {{ console.log('order missing'); process.exit(1); }}
console.log('order', order.id, order.status, order.shippingCarrier, order.trackingCode);
const mails = store.listStatusMails(orderId);
console.log('mails_before', JSON.stringify(mails));
store.releaseStatusMail(orderId, 'shipped');
(async () => {{
  const result = await sendOrderStatusMail(order, 'shipped', {{ store, env: process.env }});
  console.log('resend_result', JSON.stringify(result));
  console.log('mails_after', JSON.stringify(store.listStatusMails(orderId)));
}})().catch((e) => {{ console.error(e); process.exit(1); }});
NODE
curl -sS -o /dev/null -w "payment_status:%{{http_code}}\\n" https://patygoteknoloji.com/api/payment/status
"""
    _i, o, e = client.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(out)
    if err.strip():
        print("stderr:", err)
    client.close()


if __name__ == "__main__":
    main()
