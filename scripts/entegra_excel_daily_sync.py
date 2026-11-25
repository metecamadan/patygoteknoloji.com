#!/usr/bin/env python3
"""Daily: WinRM fetch EntegraTumUrunler.xlsx → private patygo-supplier-catalog.

No RDP. Creds: %USERPROFILE%\\.patygo\\windows-server.json
Repo: %USERPROFILE%\\.patygo\\patygo-supplier-catalog
Stamp: one successful run per local calendar day (unless --force).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

FILENAME = "EntegraTumUrunler.xlsx"
PATYGO = Path.home() / ".patygo"
CFG = PATYGO / "windows-server.json"
STAGE = PATYGO / "windows-fetch-staging"
REPO = PATYGO / "patygo-supplier-catalog"
STAMP_DIR = PATYGO / "entegra-excel-daily"
STAMP = STAMP_DIR / "last-success-day.txt"
LOG = PATYGO / "logs" / "entegra-excel-daily.log"
GIT_NAME = "metecamadan"
GIT_EMAIL = "mete.camadan@patygoteknoloji.com"


def log(msg: str) -> None:
    line = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def today_local() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d")


def already_ok_today() -> bool:
    if not STAMP.is_file():
        return False
    return STAMP.read_text(encoding="utf-8").strip() == today_local()


def mark_ok_today() -> None:
    STAMP_DIR.mkdir(parents=True, exist_ok=True)
    STAMP.write_text(today_local() + "\n", encoding="utf-8")


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def fetch_via_winrm() -> Path:
    scripts = Path(__file__).resolve().parent
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    from winrm_entegra_fetch import fetch_entegra_xlsx

    return fetch_entegra_xlsx()


def publish(src: Path) -> tuple[bool, dict]:
    """Copy into latest/ + data/YYYY-MM-DD/. Return (changed, meta)."""
    data = src.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    day = today_local()
    meta = {
        "source": "windows-desktop",
        "host": json.loads(CFG.read_text(encoding="utf-8")).get("host"),
        "hostname": "entegra-test",
        "remotePath": rf"C:\Users\Administrator\Desktop\{FILENAME}",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bytes": len(data),
        "sha256": sha,
        "fileName": FILENAME,
        "transport": "winrm",
    }
    prev_meta = REPO / "latest" / "entegra-excel-meta.json"
    if prev_meta.is_file():
        try:
            old = json.loads(prev_meta.read_text(encoding="utf-8"))
            if old.get("sha256") == sha and (REPO / "latest" / FILENAME).is_file():
                # Refresh meta timestamp only if we still want a no-op git skip
                return False, meta
        except json.JSONDecodeError:
            pass

    for folder in (REPO / "latest", REPO / "data" / day):
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, folder / FILENAME)
        (folder / "entegra-excel-meta.json").write_text(
            json.dumps(meta, indent=2) + "\n", encoding="utf-8"
        )
    return True, meta


def git_push_if_needed(changed: bool) -> int:
    if not (REPO / ".git").is_dir():
        log("error: catalog repo missing " + str(REPO))
        return 5
    if not changed:
        # Still amend README? no — stamp success without push
        log("unchanged sha — skip git")
        return 0

    # Ensure README mentions Excel (idempotent light touch only if missing)
    readme = REPO / "README.md"
    if readme.is_file():
        text = readme.read_text(encoding="utf-8")
        if "EntegraTumUrunler.xlsx" not in text:
            text += (
                "\n## Windows Entegra Excel\n\n"
                f"Günlük WinRM kopyası: [`latest/{FILENAME}`](./latest/{FILENAME})\n"
            )
            readme.write_text(text, encoding="utf-8")

    add = run(
        [
            "git",
            "add",
            f"latest/{FILENAME}",
            "latest/entegra-excel-meta.json",
            f"data/{today_local()}/{FILENAME}",
            f"data/{today_local()}/entegra-excel-meta.json",
            "README.md",
        ],
        cwd=REPO,
    )
    if add.returncode != 0:
        log("git_add_fail " + (add.stderr or add.stdout)[:300])
        return 6

    st = run(["git", "status", "--porcelain"], cwd=REPO)
    if not (st.stdout or "").strip():
        log("git nothing staged")
        return 0

    msg = f"chore: EntegraTumUrunler.xlsx daily WinRM ({today_local()})"
    commit = run(
        [
            "git",
            "-c",
            f"user.name={GIT_NAME}",
            "-c",
            f"user.email={GIT_EMAIL}",
            "commit",
            "-m",
            msg,
        ],
        cwd=REPO,
    )
    if commit.returncode != 0:
        log("git_commit_fail " + (commit.stderr or commit.stdout)[:400])
        return 7

    push = run(["git", "push", "origin", "main"], cwd=REPO)
    if push.returncode != 0:
        log("git_push_fail " + (push.stderr or push.stdout)[:400])
        return 8
    log("git_push_ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Daily Entegra Excel → GitHub (WinRM)")
    ap.add_argument("--force", action="store_true", help="Ignore once-per-day stamp")
    ap.add_argument("--fetch-only", action="store_true", help="Fetch to staging; no git")
    args = ap.parse_args(argv)

    STAMP_DIR.mkdir(parents=True, exist_ok=True)
    if not args.force and already_ok_today():
        log("skip: already succeeded today " + today_local())
        return 0

    if not CFG.is_file():
        log("error: missing " + str(CFG))
        return 1
    if not REPO.is_dir():
        log("error: missing catalog clone " + str(REPO))
        return 1

    try:
        src = fetch_via_winrm()
    except Exception as exc:
        log(f"fetch_fail {type(exc).__name__}: {exc}"[:400])
        return 2

    if not src.is_file() or src.stat().st_size < 1000:
        log("error: bad staging file")
        return 3

    log(f"fetched {src.name} {src.stat().st_size}")
    if args.fetch_only:
        mark_ok_today()
        return 0

    changed, meta = publish(src)
    log(f"publish changed={changed} sha256={meta['sha256'][:16]}… bytes={meta['bytes']}")
    code = git_push_if_needed(changed)
    if code == 0:
        mark_ok_today()
        log("done ok")
    return code


if __name__ == "__main__":
    # Scheduled tasks often have a sparse PATH
    extra = [
        r"C:\Program Files\Git\cmd",
        r"C:\Program Files\GitHub CLI",
        str(Path.home() / "AppData" / "Local" / "Python" / "bin"),
    ]
    os.environ["PATH"] = os.pathsep.join(extra + [os.environ.get("PATH", "")])
    raise SystemExit(main())
