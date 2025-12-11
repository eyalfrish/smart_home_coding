@echo off
REM Smart Home Dashboard - Docker Update Script
REM Use this after pulling new code to rebuild and restart the container

echo ============================================
echo   Smart Home Dashboard - Docker Update
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

echo Stopping current container...
docker compose down

echo.
echo Rebuilding image (this may take a few minutes)...
docker compose build --no-cache

if errorlevel 1 (
    echo.
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo Starting updated container...
docker compose up -d

if errorlevel 1 (
    echo.
    echo ERROR: Failed to start the container!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Update complete!
echo   Dashboard running at: http://localhost:3000
echo ============================================
echo.

REM Optional: Clean up old images
echo Cleaning up old Docker images...
docker image prune -f

echo.
pause

