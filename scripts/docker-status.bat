@echo off
REM Smart Home Dashboard - Docker Status Script

echo ============================================
echo   Smart Home Dashboard - Status
echo ============================================
echo.

cd /d "%~dp0.."

echo Container Status:
echo -----------------
docker compose ps

echo.
echo Container Health:
echo -----------------
docker inspect --format="{{.State.Health.Status}}" smart-home-dashboard 2>nul || echo Container not running

echo.
echo Resource Usage:
echo ---------------
docker stats smart-home-dashboard --no-stream 2>nul || echo Container not running

echo.
pause

