@echo off
chcp 65001 >nul
title Patygo Teknoloji - Yerel Sunucu
cd /d "%~dp0"
echo.
echo   Patygo Teknoloji yerel sunucusu baslatiliyor...
echo   Tarayici birazdan acilacak: http://localhost:5173
echo.
start "" http://localhost:5173
node server.js 5173
pause
