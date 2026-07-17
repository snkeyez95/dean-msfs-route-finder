@echo off
REM Run every ABRP test suite. Double-click me, or: node tests\run_all.js
cd /d "%~dp0.."
node tests\run_all.js
echo.
pause
