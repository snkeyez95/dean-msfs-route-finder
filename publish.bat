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
pause
