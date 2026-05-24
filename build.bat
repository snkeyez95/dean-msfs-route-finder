@echo off
cd /d "%~dp0"
echo Building Windows installer (.exe)...
npm install
npx electron-builder --win --x64
echo.
echo Done! Check the dist\ folder for the installer.
pause
