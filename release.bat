@echo off
setlocal
title A Better Route Planner - Release Builder

rem ---------------------------------------------------------------------------
rem 2026-07-29: this script now LOGS. That day the 6.15.5 build packaged fine
rem but the GitHub upload failed; the window had already been closed, so the
rem reason was gone for good and the installed app sat on 6.15.4 with no clue
rem why. Everything below is teed to a log file, and after the build we ASK
rem GITHUB whether the release actually landed instead of trusting the exit code.
rem ---------------------------------------------------------------------------

for /f "delims=" %%v in ('node -p "require('./package.json').version" 2^>nul') do set "VER=%%v"
if "%VER%"=="" (
  echo Could not read the version from package.json - is Node installed and are you in the project folder?
  pause
  exit /b 1
)
for /f "delims=" %%t in ('node -p "new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)" 2^>nul') do set "STAMP=%%t"

set "LOGDIR=C:\Temp\abrp-build\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\release-%VER%-%STAMP%.log"

echo.
echo ================================================
echo   A Better Route Planner - Release Builder
echo   Version: %VER%
echo ================================================
echo.
echo This will build the installer AND publish a
echo new GitHub Release that installed apps can
echo auto-update from.
echo.
echo Full output is saved to:
echo   %LOG%
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

rem Run the build through PowerShell so the output goes to the screen AND the log
rem at the same time. cmd has no 'tee', and a plain pipe would swallow the exit code.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& cmd /c 'npm run release' 2>&1 | Tee-Object -FilePath '%LOG%'; exit $LASTEXITCODE"
set "BUILDERR=%ERRORLEVEL%"

if not "%BUILDERR%"=="0" (
  echo.
  echo ================================================
  echo   BUILD FAILED  ^(exit code %BUILDERR%^)
  echo ================================================
  echo.
  echo The full output is saved here - the reason is in it:
  echo   %LOG%
  echo.
  echo Last 25 lines:
  echo ------------------------------------------------
  powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 25"
  echo ------------------------------------------------
  echo.
  pause
  exit /b 1
)

rem --- PUBLISH VERIFICATION -------------------------------------------------
rem electron-builder can package successfully and still fail to upload. The app
rem only auto-updates when the release carries latest.yml, so check for it.
echo.
echo Verifying the release actually published...
where gh >nul 2>&1
if errorlevel 1 (
  echo   [skipped] GitHub CLI ^(gh^) not found - could not verify.
  echo   Check manually: https://github.com/snkeyez95/dean-msfs-route-finder/releases
  goto :done
)

gh release view v%VER% --json assets -q ".assets[].name" > "%TEMP%\abrp_assets.txt" 2>>"%LOG%"
if errorlevel 1 (
  echo.
  echo ================================================
  echo   PUBLISH FAILED - no release v%VER% on GitHub
  echo ================================================
  echo.
  echo The installer built fine, but nothing was published, so your app
  echo will NOT see an update. The installer is here:
  echo   C:\Temp\abrp-build\
  echo Details are in the log:
  echo   %LOG%
  echo.
  pause
  exit /b 2
)

findstr /c:"latest.yml" "%TEMP%\abrp_assets.txt" >nul
if errorlevel 1 (
  echo.
  echo ================================================
  echo   PUBLISH INCOMPLETE - latest.yml is missing
  echo ================================================
  echo.
  echo Release v%VER% exists but has no latest.yml, so the auto-updater
  echo cannot see it. Assets currently attached:
  type "%TEMP%\abrp_assets.txt"
  echo.
  echo Log: %LOG%
  echo.
  pause
  exit /b 3
)

:done
echo.
echo ================================================
echo   Release v%VER% published successfully!
echo   Installer: C:\Temp\abrp-build\
echo   Log:       %LOG%
echo ================================================
echo.
echo Open ABRP - it should update itself to v%VER%.
echo.
pause
endlocal
