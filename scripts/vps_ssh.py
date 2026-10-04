#!/usr/bin/env python3
"""Patygo VPS'e anahtarla SSH bağlantısı (yerel bakım scriptleri için).

Anahtar: ~/.ssh/patygo_vps (PATYGO_VPS_KEY ile değiştirilebilir).
Parolayla bağlanma yok; anahtar yoksa açık hata verir.
Tedarikçi XML'ine bu bağlantı üzerinden VPS'te istek atılır, bu PC'den değil.
"""
import os
from pathlib import Path

import paramiko

HOST = os.environ.get("PATYGO_VPS_HOST", "87.76.157.41")
USER = os.environ.get("PATYGO_VPS_USER", "root")
KEY_PATH = Path(os.environ.get("PATYGO_VPS_KEY", Path.home() / ".ssh" / "patygo_vps"))


def connect(timeout: int = 60) -> paramiko.SSHClient:
    if not KEY_PATH.is_file():
        raise SystemExit(f"SSH anahtarı bulunamadı: {KEY_PATH}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username=USER,
        key_filename=str(KEY_PATH),
        look_for_keys=False,
        allow_agent=False,
        timeout=timeout,
        banner_timeout=timeout,
        auth_timeout=timeout,
    )
    return client


if __name__ == "__main__":
    c = connect(timeout=30)
    _, out, _ = c.exec_command("whoami && hostname", timeout=20)
    print(out.read().decode("utf-8", "replace").strip())
    c.close()
