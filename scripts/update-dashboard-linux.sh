#!/bin/bash
# Smart Home Dashboard Update Script for Linux
# This script updates the dashboard to the latest version

echo "============================================"
echo "  Smart Home Dashboard Update Script"
echo "  (Linux)"
echo "============================================"
echo ""

# Configuration
SERVICE_NAME="smarthome-dashboard"

# Determine install directory
if [ -n "$SUDO_USER" ]; then
    ACTUAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    ACTUAL_HOME="$HOME"
fi
INSTALL_DIR="$ACTUAL_HOME/SmartHome/dashboard"

# Check if we need sudo for service commands
NEED_SUDO=""
if [ "$EUID" -ne 0 ]; then
    NEED_SUDO="sudo"
    echo "Note: You may be prompted for sudo password for service commands."
    echo ""
fi

echo "[1/5] Stopping dashboard service..."
if systemctl is-active --quiet "$SERVICE_NAME"; then
    $NEED_SUDO systemctl stop "$SERVICE_NAME"
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
if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    $NEED_SUDO systemctl start "$SERVICE_NAME"
    sleep 2
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        echo "Service started successfully."
    else
        echo "Warning: Could not start service automatically."
        echo "Check status with: sudo systemctl status $SERVICE_NAME"
    fi
else
    echo "Note: Service not installed. Run install-service-linux.sh to install."
fi
echo ""

echo "============================================"
echo "  Update Complete!"
echo "============================================"
echo ""
echo "Dashboard should now be running at http://localhost:3000"
echo ""

