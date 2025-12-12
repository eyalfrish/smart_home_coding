#!/bin/bash
# Smart Home Dashboard Service Uninstall Script for macOS
# This script removes the launchd service (user agent)

echo "============================================"
echo "  Smart Home Dashboard Service Uninstaller"
echo "  (macOS launchd)"
echo "============================================"
echo ""

# Configuration
SERVICE_NAME="com.smarthome.dashboard"
PLIST_PATH="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
INSTALL_DIR="$HOME/SmartHome/dashboard"

echo "This will stop and remove the SmartHomeDashboard service."
echo "Your files will NOT be deleted."
echo ""
read -p "Are you sure? (y/N): " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""

# Check if service exists
if [ ! -f "$PLIST_PATH" ]; then
    echo "Service is not installed."
    exit 0
fi

echo "Stopping service..."
launchctl unload "$PLIST_PATH" 2>/dev/null

echo "Removing service configuration..."
rm -f "$PLIST_PATH"

echo ""
echo "============================================"
echo "  Service Removed Successfully"
echo "============================================"
echo ""
echo "Your dashboard files are still in: $INSTALL_DIR"
echo "You can still run it manually with: npm start"
echo ""

