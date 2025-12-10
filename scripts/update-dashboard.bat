@echo off
REM Smart Home Dashboard Update Script
REM Run this script as Administrator to update to the latest version

echo ============================================
echo   Smart Home Dashboard Update Script
echo ============================================
echo.

echo [1/5] Stopping dashboard service...
nssm stop SmartHomeDashboard
if %errorlevel% neq 0 (
    echo Warning: Could not stop service. It may not be running.
)
echo.

echo [2/5] Navigating to project folder...
cd /d C:\SmartHome\dashboard
if %errorlevel% neq 0 (
    echo ERROR: Could not find C:\SmartHome\dashboard
    pause
    exit /b 1
)
echo.

echo [3/5] Pulling latest code from Git...
git pull origin main
if %errorlevel% neq 0 (
    echo Warning: Git pull failed. You may need to update files manually.
)
echo.

echo [4/5] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [5/5] Building for production...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Build failed. Check the error messages above.
    pause
    exit /b 1
)
echo.

echo Starting dashboard service...
nssm start SmartHomeDashboard
if %errorlevel% neq 0 (
    echo Warning: Could not start service automatically.
    echo You may need to start it manually: nssm start SmartHomeDashboard
)
echo.

echo ============================================
echo   Update Complete!
echo ============================================
echo.
echo Dashboard should now be running at http://localhost:3000
echo.
pause

