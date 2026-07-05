@echo off
REM ====================================================================
REM  ABRP Native Capture - GATE TEST (Phase 8 / v6 validation)
REM
REM  Runs the NEW native capture engine in parallel with your normal app.
REM  Writes to  ...\A Better Route Planner\Sessions_NATIVE_TEST\  only -
REM  your real flight data is never touched. MUST run as Administrator
REM  (PresentMon needs elevation to capture frames).
REM
REM  Steps: right-click this file -> "Run as administrator", then follow
REM  the on-screen prompts (load a flight, taxi a few feet, close the sim).
REM ====================================================================
title ABRP Native Capture - GATE TEST

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo   Please run this as Administrator:
    echo     right-click this file and choose "Run as administrator".
    echo   ^(PresentMon needs elevation to capture frames.^)
    echo.
    pause
    exit /b
)

node "%~dp0_arm_native.js"
echo.
pause
