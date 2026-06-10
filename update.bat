@echo off
title A Better Route Planner - Updater
color 0A
echo.
echo  ================================================
echo   A Better Route Planner - Auto Updater
echo  ================================================
echo.

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_updater.ps1"

echo.
echo  Press any key to launch the app...
pause > nul
call start.bat
