#!/bin/bash
# Smart Home Dashboard Service Installation Script for Linux
# This script installs the dashboard as a systemd service

echo "============================================"
echo "  Smart Home Dashboard Service Installer"
echo "  (Linux systemd)"
echo "============================================"
echo ""

# Configuration
SERVICE_NAME="smarthome-dashboard"
INSTALL_DIR="$HOME/SmartHome/dashboard"
LOG_DIR="$HOME/SmartHome/logs"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo!"
    echo "Usage: sudo ./install-service-linux.sh"
    echo ""
    exit 1
fi

# Get the actual user (not root)
if [ -n "$SUDO_USER" ]; then
    ACTUAL_USER="$SUDO_USER"
    ACTUAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    echo "ERROR: Could not determine the actual user."
    echo "Please run with: sudo ./install-service-linux.sh"
    exit 1
fi

# Update paths with actual user's home
INSTALL_DIR="$ACTUAL_HOME/SmartHome/dashboard"
LOG_DIR="$ACTUAL_HOME/SmartHome/logs"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm is not installed!"
    echo ""
    echo "Please install Node.js:"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  Fedora/RHEL:   sudo dnf install nodejs npm"
    echo "  Or use nvm:    https://github.com/nvm-sh/nvm"
    echo ""
    exit 1
fi

# Get the path to npm and node
NPM_PATH=$(which npm)
NODE_PATH=$(which node)
NODE_DIR=$(dirname "$NODE_PATH")

echo "Detected configuration:"
echo "  User: $ACTUAL_USER"
echo "  Home: $ACTUAL_HOME"
echo "  Install dir: $INSTALL_DIR"
echo "  Node path: $NODE_PATH"
echo "  npm path: $NPM_PATH"
echo ""

# Create directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"
chown -R "$ACTUAL_USER:$ACTUAL_USER" "$ACTUAL_HOME/SmartHome"

# Check if service already exists
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "Service is running. Stopping it first..."
    systemctl stop "$SERVICE_NAME"
fi

if [ -f "$SERVICE_FILE" ]; then
    echo "Service file exists. Removing old service..."
    systemctl disable "$SERVICE_NAME" 2>/dev/null
    rm -f "$SERVICE_FILE"
fi

echo ""
echo "Installing SmartHomeDashboard service..."
echo ""

# Create the systemd service file
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Smart Home Dashboard
Documentation=https://github.com/your-repo/smart-home-dashboard
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
Group=$ACTUAL_USER
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=$NPM_PATH run start
Restart=always
RestartSec=5
StandardOutput=append:$LOG_DIR/dashboard-output.log
StandardError=append:$LOG_DIR/dashboard-error.log

# Security hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo "Service file created at: $SERVICE_FILE"
echo ""

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable the service (auto-start on boot)
echo "Enabling service for auto-start..."
systemctl enable "$SERVICE_NAME"

# Start the service
echo "Starting service..."
systemctl start "$SERVICE_NAME"

# Check status
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "============================================"
    echo "  Installation Complete!"
    echo "============================================"
    echo ""
    echo "Service Status: Running"
    echo "Dashboard URL: http://localhost:3000"
    echo ""
    echo "Useful commands:"
    echo "  - Check status:  sudo systemctl status $SERVICE_NAME"
    echo "  - Stop service:  sudo systemctl stop $SERVICE_NAME"
    echo "  - Start service: sudo systemctl start $SERVICE_NAME"
    echo "  - View logs:     sudo journalctl -u $SERVICE_NAME -f"
    echo "  - View app logs: tail -f $LOG_DIR/dashboard-output.log"
    echo ""
else
    echo ""
    echo "WARNING: Service may not have started correctly."
    echo "Check status with: sudo systemctl status $SERVICE_NAME"
    echo "Check logs with: sudo journalctl -u $SERVICE_NAME -n 50"
    echo ""
fi

