@echo off
REM ====================================================================
REM  ABRP Native BASELINE Flight  (auto-TLOD + capture, all native)
REM
REM  Use this for a REAL benchmark gap flight with the native engine.
REM  It (1) sets the next gap TLOD for your SimBrief aircraft, then
REM  (2) records the flight. Files to  ...\Sessions_NATIVE_TEST\  so your
REM  live 24-flight benchmark is never touched by an unproven capture -
REM  Claude verifies the flight, then merges it into the real data.
REM
REM  HOW TO RUN:
REM    1. Get MSFS to the MAIN MENU (not in a flight yet).
REM    2. Right-click this file -> "Run as administrator".
REM    3. Read the TLOD it set, then LOAD your flight in MSFS.
REM    4. Taxi to start recording; fly; land + close the sim to file.
REM ====================================================================
title ABRP Native BASELINE Flight

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo   Please run as Administrator: right-click this file, "Run as administrator".
    echo   ^(PresentMon needs elevation to capture frames.^)
    echo.
    pause
    exit /b
)

node "%~dp0_arm_native_baseline.js"
echo.
pause
