@echo off
REM Install / update daily WinRM sync task (runs when this user is logged on).
setlocal
set PYTHON=C:\Users\metec\AppData\Local\Python\bin\python.exe
set SCRIPT=C:\Users\metec\OneDrive\Desktop\patygoteknoloji.com\scripts\entegra_excel_daily_sync.py
set WRAP=%USERPROFILE%\.patygo\entegra-excel-daily\run.cmd
set XML=%USERPROFILE%\.patygo\entegra-excel-daily\task.xml
set LOGDIR=%USERPROFILE%\.patygo\logs

if not exist "%PYTHON%" (
  echo missing python: %PYTHON%
  exit /b 1
)
if not exist "%SCRIPT%" (
  echo missing script: %SCRIPT%
  exit /b 1
)

mkdir "%USERPROFILE%\.patygo\entegra-excel-daily" 2>nul
mkdir "%LOGDIR%" 2>nul

> "%WRAP%" (
  echo @echo off
  echo set PATH=C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;C:\Users\metec\AppData\Local\Python\bin;%%PATH%%
  echo "%PYTHON%" "%SCRIPT%" %%*
  echo set ERR=%%ERRORLEVEL%%
  echo echo exit=%%ERR%%^>^>"%LOGDIR%\entegra-excel-daily.log"
  echo exit /b %%ERR%%
)

REM 10:00 local daily; StartWhenAvailable = catch up if PC was off
> "%XML%" (
  echo ^<?xml version="1.0" encoding="UTF-16"?^>
  echo ^<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"^>
  echo   ^<RegistrationInfo^>
  echo     ^<URI^>\PatygoEntegraExcelDaily^</URI^>
  echo     ^<Description^>WinRM fetch EntegraTumUrunler.xlsx and push private catalog repo^</Description^>
  echo   ^</RegistrationInfo^>
  echo   ^<Triggers^>
  echo     ^<CalendarTrigger^>
  echo       ^<StartBoundary^>2026-11-26T10:00:00^</StartBoundary^>
  echo       ^<Enabled^>true^</Enabled^>
  echo       ^<ScheduleByDay^>
  echo         ^<DaysInterval^>1^</DaysInterval^>
  echo       ^</ScheduleByDay^>
  echo     ^</CalendarTrigger^>
  echo   ^</Triggers^>
  echo   ^<Principals^>
  echo     ^<Principal id="Author"^>
  echo       ^<LogonType^>InteractiveToken^</LogonType^>
  echo       ^<RunLevel^>LeastPrivilege^</RunLevel^>
  echo     ^</Principal^>
  echo   ^</Principals^>
  echo   ^<Settings^>
  echo     ^<MultipleInstancesPolicy^>IgnoreNew^</MultipleInstancesPolicy^>
  echo     ^<DisallowStartIfOnBatteries^>false^</DisallowStartIfOnBatteries^>
  echo     ^<StopIfGoingOnBatteries^>false^</StopIfGoingOnBatteries^>
  echo     ^<AllowHardTerminate^>true^</AllowHardTerminate^>
  echo     ^<StartWhenAvailable^>true^</StartWhenAvailable^>
  echo     ^<RunOnlyIfNetworkAvailable^>true^</RunOnlyIfNetworkAvailable^>
  echo     ^<AllowStartOnDemand^>true^</AllowStartOnDemand^>
  echo     ^<Enabled^>true^</Enabled^>
  echo     ^<Hidden^>false^</Hidden^>
  echo     ^<RunOnlyIfIdle^>false^</RunOnlyIfIdle^>
  echo     ^<WakeToRun^>false^</WakeToRun^>
  echo     ^<ExecutionTimeLimit^>PT30M^</ExecutionTimeLimit^>
  echo     ^<Priority^>7^</Priority^>
  echo   ^</Settings^>
  echo   ^<Actions Context="Author"^>
  echo     ^<Exec^>
  echo       ^<Command^>%WRAP%^</Command^>
  echo     ^</Exec^>
  echo   ^</Actions^>
  echo ^</Task^>
)

schtasks /Delete /TN "PatygoEntegraExcelDaily" /F >nul 2>&1
schtasks /Create /TN "PatygoEntegraExcelDaily" /XML "%XML%" /F
if errorlevel 1 (
  echo schtasks create failed
  exit /b 1
)
schtasks /Query /TN "PatygoEntegraExcelDaily" /V /FO LIST | findstr /i "TaskName Status Next Run To Run Start When"
echo.
echo Installed. Manual run: schtasks /Run /TN PatygoEntegraExcelDaily
echo Or: "%WRAP%"
endlocal
