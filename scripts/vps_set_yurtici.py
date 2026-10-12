#!/usr/bin/env python3
"""Yurtiçi Kargo web servis bilgilerini VPS .env dosyasına yazar; değerler ekrana veya loga düşmez.

Kullanım (proje klasöründe):  python scripts/vps_set_yurtici.py
Ortam (test/live) sorulur, kullanıcı adı ve şifre gizli girilir. .env yedeklenir,
PM2 yeniden başlar ve bağlantı VPS'ten denenir (Yurtiçi yalnızca kayıtlı IP'yi kabul eder).
"""
import getpass
import shlex
import sys
import time

from vps_ssh import connect

APP_DIR = "/var/www/patygoteknoloji.com"
ENV_PATH = f"{APP_DIR}/.env"
CHECK_JS = (
    "require('dotenv').config({path:'.env',quiet:true});"
    "const yk=require('./lib/yurtici-kargo');"
    "yk.pingYurtici().then(p=>{"
    "console.log((p.ok?'Yurtiçi bağlantısı: OK':'Yurtiçi bağlantısı: HATA')+' ('+p.mode+') — '+p.message);"
    "if(!p.ok)process.exit(1);"
    "}).catch(e=>{console.log('Yurtiçi bağlantısı: HATA — '+e.message);process.exit(1);});"
)


def merged_env(text, values):
    out, seen = [], set()
    for line in text.splitlines():
        key = line.split("=", 1)[0].strip()
        if key in values:
            if key not in seen:
                out.append(f"{key}={values[key]}")
                seen.add(key)
            continue
        out.append(line)
    out.extend(f"{key}={value}" for key, value in values.items() if key not in seen)
    return "\n".join(out) + "\n"


def checked(value, label):
    if not value or any(ch in value for ch in "\r\n\"' #"):
        raise SystemExit(f"{label} boş veya geçersiz karakter içeriyor; hiçbir şey yazılmadı.")
    return value


def write_env(client, values):
    sftp = client.open_sftp()
    try:
        mode = sftp.stat(ENV_PATH).st_mode & 0o777
        with sftp.open(ENV_PATH, "r") as fh:
            current = fh.read().decode("utf-8")
        backup = f"{ENV_PATH}.bak-yurtici-{time.strftime('%Y%m%d-%H%M%S')}"
        with sftp.open(backup, "w") as fh:
            fh.write(current.encode("utf-8"))
        sftp.chmod(backup, 0o600)
        with sftp.open(ENV_PATH, "w") as fh:
            fh.write(merged_env(current, values).encode("utf-8"))
        sftp.chmod(ENV_PATH, mode)
        return backup
    finally:
        sftp.close()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    mode = input("Ortam (test / live) [test]: ").strip().lower() or "test"
    if mode not in ("test", "live"):
        raise SystemExit("Ortam test veya live olmalı; hiçbir şey yazılmadı.")
    values = {
        "YURTICI_MODE": mode,
        "YURTICI_WS_USER": checked(getpass.getpass("Yurtiçi kullanıcı adı: ").strip(), "Kullanıcı adı"),
        "YURTICI_WS_PASSWORD": checked(getpass.getpass("Yurtiçi şifre: ").strip(), "Şifre"),
    }
    client = connect(timeout=30)
    try:
        backup = write_env(client, values)
        cmd = f"cd {APP_DIR} && pm2 restart patygo --update-env >/dev/null && node -e {shlex.quote(CHECK_JS)}"
        _, out, err = client.exec_command(cmd, timeout=60)
        result = out.read().decode("utf-8", "replace").strip()
        print(result or err.read().decode("utf-8", "replace").strip()[-500:])
        print("Önceki .env yedeği (VPS):", backup)
    finally:
        client.close()


if __name__ == "__main__":
    main()
