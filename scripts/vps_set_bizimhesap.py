#!/usr/bin/env python3
"""BizimHesap API bilgilerini VPS .env dosyasına yazar; değerler ekrana veya loga düşmez.

Kullanım (proje klasöründe):  python scripts/vps_set_bizimhesap.py
Firm ID gizli girilir; Token boş bırakılırsa Firm ID, Key boş bırakılırsa B2B
dokümanındaki genel anahtar kullanılır. .env yedeklenir, PM2 yeniden başlar,
bağlantı VPS'ten denenir, kasalar listelenir ve seçilen Kasa ID kaydedilir.
"""
import getpass
import shlex
import sys
import time

from vps_ssh import connect

APP_DIR = "/var/www/patygoteknoloji.com"
ENV_PATH = f"{APP_DIR}/.env"
PUBLIC_B2B_KEY = "BZMHB2B724018943908D0B82491F203F"
CHECK_JS = (
    "require('dotenv').config({path:'.env',quiet:true});"
    "const bh=require('./lib/bizimhesap');"
    "(async()=>{const p=await bh.pingBizimHesap();"
    "console.log(p.ok?'BizimHesap bağlantısı: OK':'BizimHesap bağlantısı: HATA '+(p.message||p.reason));"
    "if(!p.ok)process.exit(1);"
    "const c=await bh.listCashiers();"
    "console.log(c.ok?'Kasalar: '+JSON.stringify(c.data).slice(0,3000):'Kasalar alınamadı: '+(c.message||c.reason));"
    "})()"
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


def write_env(client, values, backup_first):
    sftp = client.open_sftp()
    try:
        mode = sftp.stat(ENV_PATH).st_mode & 0o777
        with sftp.open(ENV_PATH, "r") as fh:
            current = fh.read().decode("utf-8")
        backup = None
        if backup_first:
            backup = f"{ENV_PATH}.bak-bizimhesap-{time.strftime('%Y%m%d-%H%M%S')}"
            with sftp.open(backup, "w") as fh:
                fh.write(current.encode("utf-8"))
            sftp.chmod(backup, 0o600)
        with sftp.open(ENV_PATH, "w") as fh:
            fh.write(merged_env(current, values).encode("utf-8"))
        sftp.chmod(ENV_PATH, mode)
        return backup
    finally:
        sftp.close()


def run(client, cmd):
    _, out, err = client.exec_command(cmd, timeout=45)
    result = out.read().decode("utf-8", "replace").strip()
    return result or err.read().decode("utf-8", "replace").strip()[-500:]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    firm_id = checked(getpass.getpass("BizimHesap Firm ID: ").strip(), "Firm ID")
    token = getpass.getpass("Token (boş = Firm ID ile aynı): ").strip() or firm_id
    key = getpass.getpass("API Key (boş = dokümandaki genel B2B anahtarı): ").strip() or PUBLIC_B2B_KEY
    values = {
        "BIZIMHESAP_FIRM_ID": firm_id,
        "BIZIMHESAP_API_TOKEN": checked(token, "Token"),
        "BIZIMHESAP_API_KEY": checked(key, "API Key"),
    }

    client = connect(timeout=30)
    try:
        backup = write_env(client, values, backup_first=True)
        restart = f"cd {APP_DIR} && pm2 restart patygo --update-env >/dev/null"
        print(run(client, f"{restart} && node -e {shlex.quote(CHECK_JS)}"))
        print("Önceki .env yedeği (VPS):", backup)

        cash_id = input("Tahsilatın işleneceği Kasa ID (boş = şimdilik geç): ").strip()
        if cash_id:
            write_env(client, {"BIZIMHESAP_CASH_ID": checked(cash_id, "Kasa ID")}, backup_first=False)
            run(client, restart)
            print("Kasa ID kaydedildi; uygulama yeniden başlatıldı.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
