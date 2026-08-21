#!/usr/bin/env python3
from pathlib import Path
import paramiko

MIGRATE = Path.home() / "Desktop" / "_migrate_pass.local"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("87.76.157.41", username="root", password=MIGRATE.read_text(encoding="utf-8").strip(), timeout=60)
cmd = r"""node - <<'NODE'
const { createOrderStore } = require('/var/www/patygoteknoloji.com/lib/orders');
const store = createOrderStore('/var/www/patygoteknoloji.com');
const orders = store.list({ limit: 20 });
for (const o of orders) {
  console.log(JSON.stringify({ id: o.id, status: o.status, carrier: o.shippingCarrier, tracking: o.trackingCode, email: (o.customer&&o.customer.email)||'' }));
}
NODE
"""
_i, o, e = client.exec_command(cmd, timeout=30)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("ERR:", err)
client.close()
