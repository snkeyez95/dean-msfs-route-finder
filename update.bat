@echo off
title Dean's MSFS Route Finder - Updater
color 0A
echo.
echo  ================================================
echo   Dean's MSFS Route Finder - Auto Updater
echo  ================================================
echo.
echo  Downloading latest files from GitHub...
echo.

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { ^
    $baseUrl = 'https://raw.githubusercontent.com/snkeyez95/dean-msfs-route-finder/main'; ^
    $files = @('index.html', 'main.js', 'preload.js'); ^
    foreach ($f in $files) { ^
      Write-Host '  Updating' $f '...'; ^
      $url = $baseUrl + '/' + $f; ^
      Invoke-WebRequest -Uri $url -OutFile $f -UseBasicParsing; ^
    } ^
    Write-Host ''; ^
    Write-Host '  Update complete!' -ForegroundColor Green; ^
  } catch { ^
    Write-Host '  ERROR:' $_.Exception.Message -ForegroundColor Red; ^
    Write-Host '  Check your internet connection and try again.'; ^
  }"

echo.
echo  Press any key to launch the app...
pause > nul
call start.bat
