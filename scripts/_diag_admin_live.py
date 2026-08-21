#!/usr/bin/env python3
from pathlib import Path
import paramiko

HOST = "87.76.157.41"
APP = "/var/www/patygoteknoloji.com"

def main():
    pw = Path.home().joinpath("Desktop", "_migrate_pass.local").read_text(encoding="utf-8").strip()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=pw, timeout=60)
    cmd = rf"""
echo '=== pm2 ==='
pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{{const j=JSON.parse(d||'[]');for(const p of j)console.log(p.name,p.pm2_env.status,p.pm2_env.restart_time,p.pid);}});"
echo '=== curl local health ==='
curl -sS --max-time 8 -w '\nHTTP:%{{http_code}} time:%{{time_total}}\n' http://127.0.0.1:5173/api/payment/status || echo curl_fail
echo '=== curl local login wrong ==='
curl -sS --max-time 8 -X POST http://127.0.0.1:5173/api/admin/login -H 'Content-Type: application/json' -d '{{"password":"wrong"}}' -w '\nHTTP:%{{http_code}}\n' || echo login_fail
echo '=== nginx error tail ==='
tail -n 5 /var/log/nginx/error.log 2>/dev/null
echo '=== pm2 logs tail ==='
pm2 logs patygo --nostream --lines 15 2>/dev/null | tail -n 20
echo '=== git head ==='
cd {APP} && git rev-parse --short HEAD && git log -1 --oneline
echo '=== env admin hints ==='
grep -E '^ADMIN_PASSWORD=|^PATYGO_' {APP}/.env 2>/dev/null | sed 's/=.*$/=***/'
"""
    _i, o, e = c.exec_command(cmd, timeout=120)
    print(o.read().decode("utf-8", "replace"))
    err = e.read().decode("utf-8", "replace")
    if err.strip():
        print("ERR:", err)
    c.close()

if __name__ == "__main__":
    main()
