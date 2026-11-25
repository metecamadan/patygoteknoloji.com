#!/usr/bin/env python3
"""Install Windows Scheduled Task: daily Entegra Excel WinRM → GitHub."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PYTHON = Path(r"C:\Users\metec\AppData\Local\Python\bin\python.exe")
SCRIPT = Path(__file__).resolve().parent / "entegra_excel_daily_sync.py"
HOME = Path.home()
TASK_DIR = HOME / ".patygo" / "entegra-excel-daily"
WRAP = TASK_DIR / "run.cmd"
XML = TASK_DIR / "task.xml"
LOG_DIR = HOME / ".patygo" / "logs"
TASK_NAME = "PatygoEntegraExcelDaily"
# Local wall-clock; StartWhenAvailable catches up if PC was off
HOUR = 10
MINUTE = 0


def main() -> int:
    if not PYTHON.is_file():
        print("missing python", PYTHON)
        return 1
    if not SCRIPT.is_file():
        print("missing script", SCRIPT)
        return 1

    TASK_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    wrap_body = f"""@echo off
set PATH=C:\\Program Files\\Git\\cmd;C:\\Program Files\\GitHub CLI;{PYTHON.parent};%PATH%
"{PYTHON}" "{SCRIPT}" %*
set ERR=%ERRORLEVEL%
echo exit=%ERR%>>"{LOG_DIR}\\entegra-excel-daily.log"
exit /b %ERR%
"""
    WRAP.write_text(wrap_body, encoding="utf-8")

    # Task Scheduler XML (Unicode). InteractiveToken = only while user logged on.
    start = f"2026-11-26T{HOUR:02d}:{MINUTE:02d}:00"
    xml = f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\{TASK_NAME}</URI>
    <Description>WinRM fetch EntegraTumUrunler.xlsx → private patygo-supplier-catalog (no RDP)</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{WRAP}</Command>
    </Exec>
  </Actions>
</Task>
"""
    XML.write_text(xml, encoding="utf-16")

    subprocess.run(
        ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
        capture_output=True,
        text=True,
    )
    created = subprocess.run(
        ["schtasks", "/Create", "/TN", TASK_NAME, "/XML", str(XML), "/F"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(created.stdout or "")
    print(created.stderr or "")
    if created.returncode != 0:
        print("create_failed", created.returncode)
        return 2

    q = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for line in (q.stdout or "").splitlines():
        low = line.lower()
        if any(
            k in low
            for k in (
                "taskname",
                "status",
                "next run",
                "last run",
                "to run",
                "start when",
                "schedule type",
                "start time",
            )
        ):
            print(line)
    print("wrap", WRAP)
    print("manual", f'schtasks /Run /TN {TASK_NAME}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
