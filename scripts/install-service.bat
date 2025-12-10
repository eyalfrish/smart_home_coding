@echo off
REM Smart Home Dashboard Service Installation Script
REM Run this script as Administrator to install the Windows service

echo ============================================
echo   Smart Home Dashboard Service Installer
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

REM Check if NSSM is available
nssm version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: NSSM is not installed or not in PATH!
    echo.
    echo Please install NSSM:
    echo 1. Download from https://nssm.cc/download
    echo 2. Extract and copy nssm.exe to C:\Windows\System32\
    echo.
    pause
    exit /b 1
)

REM Create logs directory
echo Creating logs directory...
if not exist "C:\SmartHome\logs" mkdir C:\SmartHome\logs

REM Check if service already exists
nssm status SmartHomeDashboard >nul 2>&1
if %errorlevel% equ 0 (
    echo Service already exists. Removing old service...
    nssm stop SmartHomeDashboard >nul 2>&1
    nssm remove SmartHomeDashboard confirm
)

echo.
echo Installing SmartHomeDashboard service...
echo.

REM Install the service
nssm install SmartHomeDashboard "C:\SmartHome\dashboard\start-dashboard.bat"

REM Configure the service
nssm set SmartHomeDashboard AppDirectory "C:\SmartHome\dashboard"
nssm set SmartHomeDashboard DisplayName "Smart Home Dashboard"
nssm set SmartHomeDashboard Description "Smart lighting discovery and control dashboard"
nssm set SmartHomeDashboard Start SERVICE_AUTO_START
nssm set SmartHomeDashboard AppStdout "C:\SmartHome\logs\dashboard-output.log"
nssm set SmartHomeDashboard AppStderr "C:\SmartHome\logs\dashboard-error.log"
nssm set SmartHomeDashboard AppRotateFiles 1
nssm set SmartHomeDashboard AppRotateBytes 1048576

echo.
echo Service installed successfully!
echo.
echo Starting service...
nssm start SmartHomeDashboard

echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo Service Status:
nssm status SmartHomeDashboard
echo.
echo Dashboard URL: http://localhost:3000
echo.
pause

