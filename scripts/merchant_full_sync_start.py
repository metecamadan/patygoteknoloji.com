#!/usr/bin/env python3
"""Kill prior merchant_sync and start unbuffered full sync."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG = Path.home() / ".patygo" / "merchant-sync.log"
EXPORT = Path.home() / ".patygo" / "merchant-export.json"


def kill_prior() -> None:
    try:
        out = subprocess.check_output(
            ["wmic", "process", "where", "CommandLine like '%merchant_sync.py%'", "get", "ProcessId"],
            text=True,
            errors="replace",
        )
    except Exception as e:
        print("wmic_err", type(e).__name__)
        out = ""
    for line in out.splitlines():
        line = line.strip()
        if line.isdigit():
            subprocess.run(["taskkill", "/PID", line, "/T", "/F"], capture_output=True)
            print("killed", line)
    # Also kill any cmd that redirected to merchant-sync.log
    try:
        out2 = subprocess.check_output(
            ["wmic", "process", "where", "CommandLine like '%merchant-sync.log%'", "get", "ProcessId"],
            text=True,
            errors="replace",
        )
        for line in out2.splitlines():
            line = line.strip()
            if line.isdigit():
                subprocess.run(["taskkill", "/PID", line, "/T", "/F"], capture_output=True)
                print("killed_log_holder", line)
    except Exception:
        pass


def main() -> int:
    kill_prior()
    time.sleep(2)
    log_path = LOG
    if log_path.exists():
        try:
            log_path.unlink()
        except OSError:
            log_path = Path.home() / ".patygo" / f"merchant-sync-{int(time.time())}.log"
            print("log_fallback", log_path)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    cmd = [
        sys.executable,
        "-u",
        str(ROOT / "scripts" / "merchant_sync.py"),
        "--from-file",
        str(EXPORT),
        "--sleep-ms",
        "15",
    ]
    # Detached on Windows
    log_f = open(log_path, "w", encoding="utf-8", buffering=1)
    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdout=log_f,
        stderr=subprocess.STDOUT,
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
        close_fds=False,
    )
    print("started_pid", proc.pid)
    print("log", log_path)
    (Path.home() / ".patygo" / "merchant-sync-active.log").write_text(
        str(log_path), encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
