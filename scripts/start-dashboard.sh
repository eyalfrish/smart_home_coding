#!/bin/bash
# Smart Home Dashboard Startup Script
# This script is used by launchd to start the dashboard service

# Default installation path (can be overridden by environment)
DASHBOARD_DIR="${SMART_HOME_DIR:-$HOME/SmartHome/dashboard}"

cd "$DASHBOARD_DIR" || exit 1
npm run start

