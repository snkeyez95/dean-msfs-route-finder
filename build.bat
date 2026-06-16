@echo off
cd /d "%~dp0"
echo Building Windows installer (.exe)...
npm install
npx electron-builder --win --x64
echo.
echo Done! Check C:\Temp\abrp-build for the installer.
pause
