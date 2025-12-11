@echo off
REM Smart Home Dashboard - Docker Start Script
REM This script builds (if needed) and starts the dashboard container

echo ============================================
echo   Smart Home Dashboard - Docker Start
echo ============================================
echo.

cd /d "%~dp0.."

echo Checking Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running!
    echo Please start Docker Desktop and try again.
    pause
    exit /b 1
)

echo Docker is running. Starting dashboard...
echo.

docker compose up -d --build

if errorlevel 1 (
    echo.
    echo ERROR: Failed to start the dashboard!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Dashboard started successfully!
echo   Access it at: http://localhost:3000
echo ============================================
echo.
echo The container will auto-restart after reboot.
echo.
echo Useful commands:
echo   - View logs:    docker compose logs -f
echo   - Stop:         docker compose down
echo   - Restart:      docker compose restart
echo.
pause

