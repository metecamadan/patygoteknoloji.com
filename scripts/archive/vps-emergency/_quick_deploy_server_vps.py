import paramiko
from pathlib import Path

p = Path.home() / "Desktop" / "_migrate_pass.local"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("87.76.157.41", username="root", password=p.read_text().strip(), timeout=60)
s = c.open_sftp()
s.put(r"C:\Users\mcamadan\Desktop\Patygoteknoloji.com\server.js", "/var/www/patygoteknoloji.com/server.js")
s.close()
_i, o, _e = c.exec_command(
    "pm2 restart patygo && sleep 3 && curl -sS --max-time 5 -w ' ok:%{http_code}' http://127.0.0.1:5173/api/payment/status",
    timeout=30,
)
print(o.read().decode())
c.close()
