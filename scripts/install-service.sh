#!/bin/bash
# Smart Home Dashboard Service Installation Script for macOS
# This script installs the dashboard as a launchd service (user agent)

echo "============================================"
echo "  Smart Home Dashboard Service Installer"
echo "  (macOS launchd)"
echo "============================================"
echo ""

# Configuration
SERVICE_NAME="com.smarthome.dashboard"
INSTALL_DIR="$HOME/SmartHome/dashboard"
LOG_DIR="$HOME/SmartHome/logs"
PLIST_PATH="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"

# Check if running with sudo (not recommended for user agent)
if [ "$EUID" -eq 0 ]; then
    echo "WARNING: Running as root is not recommended for user agents."
    echo "The service will be installed for the current user."
    echo ""
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm is not installed!"
    echo ""
    echo "Please install Node.js:"
    echo "  1. Using Homebrew: brew install node"
    echo "  2. Or download from: https://nodejs.org"
    echo ""
    exit 1
fi

# Create directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# Check if service already exists
if launchctl list | grep -q "$SERVICE_NAME"; then
    echo "Service already exists. Removing old service..."
    launchctl unload "$PLIST_PATH" 2>/dev/null
fi

# Get the path to npm
NPM_PATH=$(which npm)
NODE_PATH=$(dirname "$NPM_PATH")

echo ""
echo "Installing SmartHomeDashboard service..."
echo ""

# Create the launchd plist file
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>${NPM_PATH}</string>
        <string>run</string>
        <string>start</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${NODE_PATH}:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/dashboard-output.log</string>
    
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/dashboard-error.log</string>
    
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
EOF

echo "Service plist created at: $PLIST_PATH"
echo ""

# Load the service
echo "Loading service..."
launchctl load "$PLIST_PATH"

# Check if service started
sleep 2
if launchctl list | grep -q "$SERVICE_NAME"; then
    echo ""
    echo "============================================"
    echo "  Installation Complete!"
    echo "============================================"
    echo ""
    echo "Service Status: Running"
    echo "Dashboard URL: http://localhost:3000"
    echo ""
    echo "Useful commands:"
    echo "  - Stop service:    launchctl unload $PLIST_PATH"
    echo "  - Start service:   launchctl load $PLIST_PATH"
    echo "  - View logs:       tail -f $LOG_DIR/dashboard-output.log"
    echo ""
else
    echo ""
    echo "WARNING: Service may not have started correctly."
    echo "Check the logs at: $LOG_DIR/"
    echo ""
fi

