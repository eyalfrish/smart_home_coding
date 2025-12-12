#!/bin/bash
# Smart Home Dashboard Update Script for macOS
# This script updates the dashboard to the latest version

echo "============================================"
echo "  Smart Home Dashboard Update Script"
echo "============================================"
echo ""

# Configuration
SERVICE_NAME="com.smarthome.dashboard"
PLIST_PATH="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
INSTALL_DIR="$HOME/SmartHome/dashboard"

echo "[1/5] Stopping dashboard service..."
if launchctl list | grep -q "$SERVICE_NAME"; then
    launchctl unload "$PLIST_PATH" 2>/dev/null
    echo "Service stopped."
else
    echo "Service was not running."
fi
echo ""

echo "[2/5] Navigating to project folder..."
if ! cd "$INSTALL_DIR"; then
    echo "ERROR: Could not find $INSTALL_DIR"
    exit 1
fi
echo "Working directory: $(pwd)"
echo ""

echo "[3/5] Pulling latest code from Git..."
if ! git pull origin main; then
    echo "Warning: Git pull failed. You may need to update files manually."
fi
echo ""

echo "[4/5] Installing dependencies..."
if ! npm install; then
    echo "ERROR: npm install failed"
    exit 1
fi
echo ""

echo "[5/5] Building for production..."
if ! npm run build; then
    echo "ERROR: Build failed. Check the error messages above."
    exit 1
fi
echo ""

echo "Starting dashboard service..."
if [ -f "$PLIST_PATH" ]; then
    launchctl load "$PLIST_PATH"
    if launchctl list | grep -q "$SERVICE_NAME"; then
        echo "Service started successfully."
    else
        echo "Warning: Could not start service automatically."
        echo "You may need to start it manually: launchctl load $PLIST_PATH"
    fi
else
    echo "Note: Service not installed. Run install-service.sh to install."
fi
echo ""

echo "============================================"
echo "  Update Complete!"
echo "============================================"
echo ""
echo "Dashboard should now be running at http://localhost:3000"
echo ""

