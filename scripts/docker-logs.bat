@echo off
REM Smart Home Dashboard - Docker Logs Script
REM Shows live logs from the dashboard container

echo ============================================
echo   Smart Home Dashboard - Live Logs
echo   Press Ctrl+C to exit
echo ============================================
echo.

cd /d "%~dp0.."

docker compose logs -f --tail=100

