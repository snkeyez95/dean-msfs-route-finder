@echo off
title A Better Route Planner - Release Builder
echo.
echo ================================================
echo   A Better Route Planner - Release Builder
echo ================================================
echo.
echo This will build the installer AND publish a
echo new GitHub Release that installed apps can
echo auto-update from.
echo.
pause

echo.
echo Clearing previous build output...
if exist "C:\Temp\abrp-build\win-unpacked" rd /s /q "C:\Temp\abrp-build\win-unpacked"
if exist "C:\Temp\abrp-build\*.exe" del /f /q "C:\Temp\abrp-build\*.exe"

echo.
echo Building and publishing release...
echo.
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run release
if errorlevel 1 (
  echo.
  echo Build failed. Check output above.
  pause
  exit /b 1
)

echo.
echo ================================================
echo   Release published successfully!
echo   Installer: C:\Temp\abrp-build\
echo ================================================
echo.
pause
