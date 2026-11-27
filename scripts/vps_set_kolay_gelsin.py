#!/usr/bin/env python3
"""Kolay Gelsin API kullanıcı/şifresini VPS .env dosyasına yazar; değerler ekrana düşmez.

Kullanım:  python scripts/vps_set_kolay_gelsin.py
Ortam (test/live) sorulur; kullanıcı adı ve şifre gizli girilir.
--from-env: KOLAY_GELSIN_MODE / KOLAY_GELSIN_USER / KOLAY_GELSIN_PASSWORD
"""
import getpass
import os
import shlex
import sys
import time

from vps_ssh import connect

APP_DIR = "/var/www/patygoteknoloji.com"
ENV_PATH = f"{APP_DIR}/.env"
CHECK_JS = (
    "require('dotenv').config({path:'.env',quiet:true});"
    "const kg=require('./lib/kolay-gelsin');"
    "kg.pingKolayGelsin().then(p=>{"
    "console.log((p.ok?'Kolay Gelsin bağlantısı: OK':'Kolay Gelsin bağlantısı: HATA')"
    "+' ('+p.mode+') — '+p.message);"
    "if(!p.ok)process.exit(1);"
    "}).catch(e=>{console.log('Kolay Gelsin bağlantısı: HATA — '+e.message);process.exit(1);});"
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
        backup = f"{ENV_PATH}.bak-kolay-gelsin-{time.strftime('%Y%m%d-%H%M%S')}"
        with sftp.open(backup, "w") as fh:
            fh.write(current.encode("utf-8"))
        sftp.chmod(backup, 0o600)
        with sftp.open(ENV_PATH, "w") as fh:
            fh.write(merged_env(current, values).encode("utf-8"))
        sftp.chmod(ENV_PATH, mode)
        return backup
    finally:
        sftp.close()


def values_from_prompt():
    mode = input("Ortam (test / live) [live]: ").strip().lower() or "live"
    if mode not in ("test", "live"):
        raise SystemExit("Ortam test veya live olmalı; hiçbir şey yazılmadı.")
    return {
        "KOLAY_GELSIN_MODE": mode,
        "KOLAY_GELSIN_USER": checked(getpass.getpass("Kolay Gelsin API kullanıcı: ").strip(), "Kullanıcı adı"),
        "KOLAY_GELSIN_PASSWORD": checked(getpass.getpass("Kolay Gelsin API şifre: ").strip(), "Şifre"),
    }


def values_from_env():
    mode = (os.environ.get("KOLAY_GELSIN_MODE") or "").strip().lower()
    if mode not in ("test", "live"):
        raise SystemExit("KOLAY_GELSIN_MODE test veya live olmalı; hiçbir şey yazılmadı.")
    return {
        "KOLAY_GELSIN_MODE": mode,
        "KOLAY_GELSIN_USER": checked((os.environ.get("KOLAY_GELSIN_USER") or "").strip(), "Kullanıcı adı"),
        "KOLAY_GELSIN_PASSWORD": checked((os.environ.get("KOLAY_GELSIN_PASSWORD") or "").strip(), "Şifre"),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    values = values_from_env() if "--from-env" in sys.argv else values_from_prompt()
    client = connect(timeout=30)
    try:
        backup = write_env(client, values)
        # Deploy lib first so ping can require the new module before git pull.
        sftp = client.open_sftp()
        try:
            local_lib = os.path.join(os.path.dirname(__file__), "..", "lib", "kolay-gelsin.js")
            remote_lib = f"{APP_DIR}/lib/kolay-gelsin.js"
            sftp.put(os.path.abspath(local_lib), remote_lib)
        finally:
            sftp.close()
        cmd = f"cd {APP_DIR} && pm2 restart patygo --update-env >/dev/null && node -e {shlex.quote(CHECK_JS)}"
        _, out, err = client.exec_command(cmd, timeout=60)
        result = out.read().decode("utf-8", "replace").strip()
        print(result or err.read().decode("utf-8", "replace").strip()[-500:])
        print("Önceki .env yedeği (VPS):", backup)
    finally:
        client.close()


if __name__ == "__main__":
    main()
