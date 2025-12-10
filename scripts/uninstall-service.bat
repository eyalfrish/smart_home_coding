@echo off
REM Smart Home Dashboard Service Uninstall Script
REM Run this script as Administrator to remove the Windows service

echo ============================================
echo   Smart Home Dashboard Service Uninstaller
echo ============================================
echo.

REM Check for administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

echo This will stop and remove the SmartHomeDashboard service.
echo Your files will NOT be deleted.
echo.
set /p confirm="Are you sure? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo Stopping service...
nssm stop SmartHomeDashboard

echo Removing service...
nssm remove SmartHomeDashboard confirm

echo.
echo ============================================
echo   Service Removed Successfully
echo ============================================
echo.
echo Your dashboard files are still in C:\SmartHome\dashboard
echo You can still run it manually with: npm start
echo.
pause

