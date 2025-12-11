@echo off
REM Smart Home Dashboard - Docker Stop Script

echo ============================================
echo   Smart Home Dashboard - Docker Stop
echo ============================================
echo.

cd /d "%~dp0.."

docker compose down

if errorlevel 1 (
    echo.
    echo WARNING: There may have been an issue stopping the container.
) else (
    echo.
    echo Dashboard stopped successfully.
)

echo.
pause

