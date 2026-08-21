import paramiko
from pathlib import Path

ROOT = Path(r"C:\Users\mcamadan\Desktop\Patygoteknoloji.com")
REMOTE = "/var/www/patygoteknoloji.com"
FILES = ["server.js", "assets/js/admin.js", "assets/css/admin.css"]

pw = Path.home().joinpath("Desktop", "_migrate_pass.local").read_text(encoding="utf-8").strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("87.76.157.41", username="root", password=pw, timeout=60)
s = c.open_sftp()
for rel in FILES:
    s.put(str(ROOT / rel.replace("/", "\\")), f"{REMOTE}/{rel}")
s.close()
_i, o, _e = c.exec_command("pm2 restart patygo", timeout=30)
print(o.read().decode("utf-8", "replace")[:400])
c.close()
