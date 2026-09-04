#!/usr/bin/env python3
"""Restart hung patygo, verify admin login, bootstrap owner if needed."""
from __future__ import annotations

import json
import secrets
import string
import sys
import time
from pathlib import Path

import paramiko

HOST = "87.76.157.41"
APP = "/var/www/patygoteknoloji.com"
EMAIL = "mete.camadan@patygoteknoloji.com"


def migrate_pass() -> str:
    return Path.home().joinpath("Desktop", "_migrate_pass.local").read_text(encoding="utf-8").strip()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    alphabet = string.ascii_letters + string.digits + "!@#%+-"
    new_pass = "".join(secrets.choice(alphabet) for _ in range(16))

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=migrate_pass(), timeout=60, banner_timeout=60)

    remote = f"""
cd {APP}
echo '=== restart ==='
pm2 restart patygo --update-env
sleep 4
echo '=== health ==='
curl -sS --max-time 6 -w ' status:%{{http_code}} time:%{{time_total}}\\n' http://127.0.0.1:5173/api/payment/status | head -c 120
echo
echo '=== admin json users ==='
node -e "const s=require('./lib/admin-users').createAdminUserStore(process.cwd()); console.log('count', s.count()); console.log(JSON.stringify(s.list()));"
node <<'NODE'
require('dotenv').config({{ quiet: true }});
const fs = require('fs');
const {{ createAdminUserStore }} = require('./lib/admin-users');
const store = createAdminUserStore(process.cwd());
const email = '{EMAIL}';
const newPassword = process.env.NEW_PASS;
let user = store.findByEmail(email);
if (!user) {{
  user = store.create({{
    firstName: 'Mete',
    lastName: 'Camadan',
    email,
    password: newPassword,
  }}, {{ role: 'owner' }});
  console.log('created_owner', user.email);
}} else {{
  store.update(user.id, {{ password: newPassword }});
  console.log('updated_owner', user.email);
}}
let envText = fs.readFileSync('.env', 'utf8');
if (/^ADMIN_PASSWORD=/m.test(envText)) {{
  envText = envText.replace(/^ADMIN_PASSWORD=.*/m, 'ADMIN_PASSWORD=' + newPassword);
}} else {{
  envText += '\\nADMIN_PASSWORD=' + newPassword + '\\n';
}}
fs.writeFileSync('.env', envText, {{ mode: 0o600 }});
console.log('auth', store.authenticate(email, newPassword) ? 'ok' : 'fail');
NODE
pm2 restart patygo --update-env
sleep 4
curl -sS --max-time 8 -X POST http://127.0.0.1:5173/api/admin/login \\
  -H 'Content-Type: application/json' \\
  -d '{{"email":"{EMAIL}","password":"'"$NEW_PASS"'"}}' \\
  -w '\\nlogin_http:%{{http_code}}\\n'
"""

    cmd = f"export NEW_PASS='{new_pass}'\n" + remote
    _i, o, e = client.exec_command(cmd, timeout=180)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    client.close()

    print(out)
    if err.strip():
        print("ERR:", err[:500])

    cred = Path.home() / "Desktop" / "_admin_panel_pass.local"
    cred.write_text(
        "Patygo admin panel\n\n"
        "URL: https://patygoteknoloji.com/admin\n"
        f"E-posta: {EMAIL}\n"
        f"Sifre: {new_pass}\n\n"
        "Node yeniden baslatildi; bu sifre simdi gecerli.\n",
        encoding="utf-8",
    )
    print("wrote", cred)

    ok = "login_http:200" in out and '"ok":true' in out.replace(" ", "")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
