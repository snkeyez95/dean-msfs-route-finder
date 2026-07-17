@echo off
REM Back up ABRP flight logs + settings to D:\Claude_ABRP_Log BU
REM Only copies what changed, so it's quick after the first run.
cd /d "%~dp0.."
node tools\backup-data.js
echo.
pause
