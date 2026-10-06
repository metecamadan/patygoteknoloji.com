#!/usr/bin/env python3
"""BizimHesap API bilgilerini VPS .env dosyasına yazar; değerler ekrana veya loga düşmez.

Kullanım (proje klasöründe):  python scripts/vps_set_bizimhesap.py
Firm ID, API Key ve Token gizli girilir. .env yedeklenir, PM2 yeniden başlar ve
BizimHesap bağlantısı VPS'ten denenir; yalnızca sonuç yazdırılır.
"""
import getpass
import shlex
import sys
import time

from vps_ssh import connect

APP_DIR = "/var/www/patygoteknoloji.com"
FIELDS = [
    ("BIZIMHESAP_FIRM_ID", "Firm ID"),
    ("BIZIMHESAP_API_KEY", "API Key"),
    ("BIZIMHESAP_API_TOKEN", "Token"),
]
PING_JS = (
    "require('dotenv').config({path:'.env',quiet:true});"
    "require('./lib/bizimhesap').pingBizimHesap().then((r)=>{"
    "console.log(r.ok?'BizimHesap bağlantısı: OK':'BizimHesap bağlantısı: HATA '+(r.message||r.reason));"
    "process.exit(r.ok?0:1)})"
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


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    values = {}
    for key, label in FIELDS:
        value = getpass.getpass(f"BizimHesap {label}: ").strip()
        if not value or any(ch in value for ch in "\r\n\"' #"):
            raise SystemExit(f"{label} boş veya geçersiz karakter içeriyor; hiçbir şey yazılmadı.")
        values[key] = value

    client = connect(timeout=30)
    try:
        sftp = client.open_sftp()
        path = f"{APP_DIR}/.env"
        mode = sftp.stat(path).st_mode & 0o777
        with sftp.open(path, "r") as fh:
            current = fh.read().decode("utf-8")
        backup = f"{path}.bak-bizimhesap-{time.strftime('%Y%m%d-%H%M%S')}"
        with sftp.open(backup, "w") as fh:
            fh.write(current.encode("utf-8"))
        sftp.chmod(backup, 0o600)
        with sftp.open(path, "w") as fh:
            fh.write(merged_env(current, values).encode("utf-8"))
        sftp.chmod(path, mode)
        sftp.close()

        cmd = f"cd {APP_DIR} && pm2 restart patygo --update-env >/dev/null && node -e {shlex.quote(PING_JS)}"
        _, out, err = client.exec_command(cmd, timeout=45)
        result = out.read().decode("utf-8", "replace").strip()
        print(result or err.read().decode("utf-8", "replace").strip()[-500:])
        print("Önceki .env yedeği (VPS):", backup)
    finally:
        client.close()


if __name__ == "__main__":
    main()
