@echo off
cd /d "%~dp0"
git add community_routes.json
git commit -m "auto: update community routes %date% %time%"
git push
if %errorlevel% equ 0 (
    echo Community routes published successfully.
) else (
    echo Publish failed. Check your git credentials or internet connection.
)
REM "auto" = spawned hidden by ABRP (no console, no stdin) — pausing there leaves a zombie cmd.
if /i "%1"=="auto" exit /b %errorlevel%
pause
