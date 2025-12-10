@echo off
REM Smart Home Dashboard Startup Script
REM This script is used by NSSM to start the dashboard service

cd /d C:\SmartHome\dashboard
npm run start

