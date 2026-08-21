#!/usr/bin/env python3
from pathlib import Path
import paramiko

APP = "/var/www/patygoteknoloji.com"
ORDER = "PTY-260818-45821A"

def main():
    pw = Path.home().joinpath("Desktop", "_migrate_pass.local").read_text(encoding="utf-8").strip()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("87.76.157.41", username="root", password=pw, timeout=60)
    cmd = f"""
cd {APP}
node <<'NODE'
require('dotenv').config({{ quiet: true }});
const {{ createOrderStore }} = require('./lib/orders');
const store = createOrderStore(process.cwd());
const order = store.get('{ORDER}');
if (!order) {{ console.log('ORDER_MISSING'); process.exit(0); }}
console.log('order', JSON.stringify({{
  id: order.id,
  status: order.status,
  carrier: order.shippingCarrier,
  tracking: order.trackingCode,
  email: order.customer && order.customer.email,
}}));
console.log('statusMails', JSON.stringify(store.listStatusMails('{ORDER}')));
NODE
"""
    _i, o, _e = c.exec_command(cmd, timeout=60)
    print(o.read().decode("utf-8", "replace"))
    c.close()

if __name__ == "__main__":
    main()
