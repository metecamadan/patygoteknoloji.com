"""Fetch Desktop Excel via WinRM. Creds from ~/.patygo/windows-server.json."""
from __future__ import annotations

import base64
import json
from pathlib import Path

CFG = Path.home() / ".patygo" / "windows-server.json"
STAGE = Path.home() / ".patygo" / "windows-fetch-staging"
FILENAME = "EntegraTumUrunler.xlsx"


def _session():
    import winrm

    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    host, user, password = cfg["host"], cfg["user"], cfg["password"]
    endpoints = [
        f"http://{host}:5985/wsman",
        f"https://{host}:5986/wsman",
    ]
    last_err = None
    for ep in endpoints:
        try:
            s = winrm.Session(
                ep,
                auth=(user, password),
                transport="ntlm",
                server_cert_validation="ignore",
            )
            r = s.run_cmd("hostname")
            print("winrm_ok", ep, r.std_out.decode("utf-8", "replace").strip())
            return s
        except Exception as exc:
            last_err = f"{ep} {type(exc).__name__} {str(exc)[:120]}"
            print("winrm_try_fail", last_err)
    raise RuntimeError(f"winrm_failed {last_err}")


def _find_remote_path(session) -> str:
    ps = r"""
$ErrorActionPreference='Stop'
$paths = @(
  [Environment]::GetFolderPath('Desktop'),
  "$env:USERPROFILE\Desktop",
  'C:\Users\Administrator\Desktop',
  'C:\Users\Public\Desktop'
)
Write-Output '---LIST---'
foreach ($p in $paths) {
  if (Test-Path -LiteralPath $p) {
    Write-Output ("DIR=" + $p)
    Get-ChildItem -LiteralPath $p -File | ForEach-Object { Write-Output $_.Name }
  }
}
Write-Output '---FIND---'
Get-ChildItem -Path $paths -Filter '*Entegra*.xlsx' -File -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Output $_.FullName }
"""
    r = session.run_ps(ps)
    out = r.std_out.decode("utf-8", "replace")
    err = r.std_err.decode("utf-8", "replace")
    print(out[:2000])
    if r.status_code != 0:
        print("ps_status", r.status_code, err[:400])

    for line in out.splitlines():
        if line.lower().endswith(".xlsx") and ("\\" in line or "/" in line):
            return line.strip()

    desk = None
    for line in out.splitlines():
        if line.startswith("DIR="):
            desk = line[4:].strip()
            break
    if desk:
        return desk.rstrip("\\") + "\\" + FILENAME
    raise FileNotFoundError("Entegra*.xlsx not found on remote desktop")


def fetch_entegra_xlsx(dest: Path | None = None) -> Path:
    """Pull EntegraTumUrunler.xlsx over WinRM into staging (or dest)."""
    if not CFG.is_file():
        raise FileNotFoundError(CFG)
    STAGE.mkdir(parents=True, exist_ok=True)
    session = _session()
    remote = _find_remote_path(session)
    print("remote_path", remote)

    ps_b64 = f"""
$ErrorActionPreference='Stop'
$p = '{remote.replace("'", "''")}'
if (-not (Test-Path -LiteralPath $p)) {{ throw "missing $p" }}
$bytes = [System.IO.File]::ReadAllBytes($p)
Write-Output ([Convert]::ToBase64String($bytes))
"""
    r2 = session.run_ps(ps_b64)
    if r2.status_code != 0:
        raise RuntimeError(
            "read_failed " + r2.std_err.decode("utf-8", "replace")[:400]
        )
    b64 = (
        r2.std_out.decode("ascii", "ignore")
        .strip()
        .replace("\r", "")
        .replace("\n", "")
    )
    data = base64.b64decode(b64)
    out = dest or (STAGE / Path(remote).name)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print("copied", out.name, len(data))
    return out


def main() -> int:
    try:
        import winrm  # noqa: F401
    except ImportError:
        print("need_pywinrm")
        return 1
    try:
        fetch_entegra_xlsx()
    except Exception as exc:
        print(type(exc).__name__, str(exc)[:300])
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
