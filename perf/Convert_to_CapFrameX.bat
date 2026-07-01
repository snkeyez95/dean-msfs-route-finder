@echo off
REM ====================================================================
REM  Convert logged flight data to CapFrameX format - DRAG & DROP
REM
REM  Drag any of these onto this file:
REM    - a single session folder (the one with frametimes.csv inside)
REM    - a whole date folder (converts every flight that day)
REM    - the whole Sessions folder (converts everything)
REM    - one or more frametimes.csv files
REM
REM  Uses the bundled perf-engine.exe sitting next to this file - no Python
REM  install needed. Converted copies are written to
REM    %APPDATA%\A Better Route Planner\Sessions\CapFrameX\
REM  (your original captures are never modified). Then point CapFrameX's
REM  observed directory at that CapFrameX folder.
REM ====================================================================
title Convert to CapFrameX

REM Point the engine's data root at ABRP's user-data folder so the CapFrameX
REM output lands in the real Sessions\CapFrameX (SESSIONS_DIR = MSFS_PERF_ROOT\Sessions).
set "MSFS_PERF_ROOT=%APPDATA%\A Better Route Planner"
set "ENGINE=%~dp0perf-engine.exe"

if "%~1"=="" (
    echo.
    echo   Drag a session folder, a date folder, the Sessions folder,
    echo   or a frametimes.csv file onto this batch file to convert it.
    echo.
    pause
    exit /b
)

if not exist "%ENGINE%" (
    echo.
    echo   Could not find perf-engine.exe next to this file:
    echo     %ENGINE%
    echo   Keep this .bat in the project's perf\ folder, beside perf-engine.exe.
    echo.
    pause
    exit /b
)

"%ENGINE%" --convert-path %*
