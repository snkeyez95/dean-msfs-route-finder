@echo off
title Dean's MSFS Route Finder - First Time Setup
color 0A
echo.
echo  ================================================
echo   Dean's MSFS Route Finder - First Time Setup
echo  ================================================
echo.
echo  This will download the latest app files from GitHub.
echo.
echo  Make sure you're running this from your DeanMSFS_v2 folder.
echo  (The folder that contains node_modules and package.json)
echo.
pause

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { ^
    $baseUrl = 'https://raw.githubusercontent.com/snkeyez95/dean-msfs-route-finder/main'; ^
    $files = @('index.html', 'main.js', 'preload.js', 'update.bat'); ^
    foreach ($f in $files) { ^
      Write-Host '  Downloading' $f '...'; ^
      $url = $baseUrl + '/' + $f; ^
      Invoke-WebRequest -Uri $url -OutFile $f -UseBasicParsing; ^
    } ^
    Write-Host ''; ^
    Write-Host '  Setup complete! Use update.bat for future updates.' -ForegroundColor Green; ^
  } catch { ^
    Write-Host '  ERROR:' $_.Exception.Message -ForegroundColor Red; ^
  }"

echo.
echo  Press any key to launch the app...
pause > nul
call start.bat
