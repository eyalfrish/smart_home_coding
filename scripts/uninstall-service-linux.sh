#!/bin/bash
# Smart Home Dashboard Service Uninstall Script for Linux
# This script removes the systemd service

echo "============================================"
echo "  Smart Home Dashboard Service Uninstaller"
echo "  (Linux systemd)"
echo "============================================"
echo ""

# Configuration
SERVICE_NAME="smarthome-dashboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo!"
    echo "Usage: sudo ./uninstall-service-linux.sh"
    echo ""
    exit 1
fi

# Get the actual user's home directory
if [ -n "$SUDO_USER" ]; then
    ACTUAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    INSTALL_DIR="$ACTUAL_HOME/SmartHome/dashboard"
else
    INSTALL_DIR="$HOME/SmartHome/dashboard"
fi

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
if [ ! -f "$SERVICE_FILE" ]; then
    echo "Service is not installed."
    exit 0
fi

# Stop the service
echo "Stopping service..."
systemctl stop "$SERVICE_NAME" 2>/dev/null

# Disable the service
echo "Disabling service..."
systemctl disable "$SERVICE_NAME" 2>/dev/null

# Remove the service file
echo "Removing service file..."
rm -f "$SERVICE_FILE"

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

echo ""
echo "============================================"
echo "  Service Removed Successfully"
echo "============================================"
echo ""
echo "Your dashboard files are still in: $INSTALL_DIR"
echo "You can still run it manually with: npm start"
echo ""

