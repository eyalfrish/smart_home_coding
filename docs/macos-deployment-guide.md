# macOS Home Deployment Guide

This guide explains how to deploy the Smart Lighting Dashboard on a Mac at home, with automatic restart on reboot and remote management capabilities.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Building for Production](#building-for-production)
4. [Running as a launchd Service](#running-as-a-launchd-service)
5. [Docker Deployment (Alternative)](#docker-deployment-alternative)
6. [Network Configuration](#network-configuration)
7. [Updating to a Newer Version](#updating-to-a-newer-version)
8. [Remote Management](#remote-management)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, you'll need to install the following software on your Mac:

### 1. Node.js (Required)

Node.js is the runtime that powers the dashboard.

**Option A: Using Homebrew (Recommended)**
```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node
```

**Option B: Direct Download**
1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS version** (should be 18.x or higher)
3. Run the installer

**Verify installation** by opening Terminal:
```bash
node --version
npm --version
```
You should see version numbers (Node 18+ and npm 9+).

### 2. Git (Recommended for Updates)

Git is usually pre-installed on macOS. Verify:
```bash
git --version
```

If not installed, you'll be prompted to install Command Line Tools. Accept the prompt, or install via Homebrew:
```bash
brew install git
```

### 3. Docker Desktop (Optional - Alternative Deployment)

If you prefer Docker deployment:
1. Go to [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Download Docker Desktop for Mac (choose Apple Silicon or Intel based on your Mac)
3. Run the installer and follow the prompts

---

## Initial Setup

### Step 1: Choose an Installation Location

Create a dedicated folder for the dashboard. We recommend:
```
~/SmartHome/dashboard
```

Open Terminal:
```bash
mkdir -p ~/SmartHome
cd ~/SmartHome
```

### Step 2: Get the Code

**Option A: Clone with Git (Recommended)**
```bash
git clone <your-repository-url> dashboard
cd dashboard
```

**Option B: Copy Files Manually**
Copy your entire project folder to `~/SmartHome/dashboard`

### Step 3: Install Dependencies

```bash
cd ~/SmartHome/dashboard
npm install
```

This downloads all required packages. Wait for it to complete (may take 1-3 minutes).

---

## Building for Production

Development mode (`npm run dev`) is slower and uses more resources. For home deployment, always use production mode.

### Build the Application

```bash
cd ~/SmartHome/dashboard
npm run build
```

This creates an optimized production build. You should see output like:
```
✓ Compiled successfully
✓ Collecting page data
✓ Generating static pages
```

### Test the Production Build

Before setting up auto-start, verify it works:
```bash
npm run start
```

Open your browser and go to `http://localhost:3000`. If you see the dashboard, it's working!

Press `Ctrl+C` to stop the server.

---

## Running as a launchd Service

This is the key step that makes your dashboard start automatically when macOS boots. On macOS, we use **launchd** (the native service manager) instead of third-party tools.

### Method 1: Using the Install Script (Easiest)

Make the scripts executable and run the installer:
```bash
cd ~/SmartHome/dashboard

# Make scripts executable
chmod +x scripts/*.sh

# Run the installer
./scripts/install-service.sh
```

The script will:
1. Create necessary directories
2. Generate a launchd plist file
3. Load and start the service

### Method 2: Manual Installation

#### Step 1: Create the launchd plist file

Create a file at `~/Library/LaunchAgents/com.smarthome.dashboard.plist`:

```bash
nano ~/Library/LaunchAgents/com.smarthome.dashboard.plist
```

Paste the following content (adjust paths if needed):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.smarthome.dashboard</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>run</string>
        <string>start</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/SmartHome/dashboard</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/SmartHome/logs/dashboard-output.log</string>
    
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/SmartHome/logs/dashboard-error.log</string>
    
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
```

**Important:** Replace `YOUR_USERNAME` with your actual macOS username. Find it with:
```bash
whoami
```

For Apple Silicon Macs with Homebrew, use `/opt/homebrew/bin/npm` instead of `/usr/local/bin/npm`.

#### Step 2: Create the logs directory

```bash
mkdir -p ~/SmartHome/logs
```

#### Step 3: Load the service

```bash
launchctl load ~/Library/LaunchAgents/com.smarthome.dashboard.plist
```

#### Step 4: Verify it's running

```bash
launchctl list | grep smarthome
```

You should see output like:
```
-    0    com.smarthome.dashboard
```

Also check by opening `http://localhost:3000` in your browser.

### Managing the Service

```bash
# Stop the service
launchctl unload ~/Library/LaunchAgents/com.smarthome.dashboard.plist

# Start the service
launchctl load ~/Library/LaunchAgents/com.smarthome.dashboard.plist

# Check if service is loaded
launchctl list | grep smarthome

# View service info
launchctl print gui/$(id -u)/com.smarthome.dashboard

# Remove the service completely
launchctl unload ~/Library/LaunchAgents/com.smarthome.dashboard.plist
rm ~/Library/LaunchAgents/com.smarthome.dashboard.plist
```

---

## Docker Deployment (Alternative)

If you prefer Docker, this provides an isolated, consistent environment.

### Quick Start

```bash
# Navigate to the dashboard folder
cd ~/SmartHome/dashboard

# Make Docker scripts executable
chmod +x scripts/*.sh

# Build and start
./scripts/docker-start.sh
```

Open your browser: **http://localhost:3000**

### Docker Helper Scripts

| Script | Purpose |
|--------|---------|
| `scripts/docker-start.sh` | Build (if needed) and start |
| `scripts/docker-stop.sh` | Stop the container |
| `scripts/docker-update.sh` | Full rebuild with cleanup |
| `scripts/docker-logs.sh` | View live logs |
| `scripts/docker-status.sh` | Check status and health |

### Configure Docker to Start on Boot

1. Open Docker Desktop
2. Click the gear icon (Settings)
3. Under "General", ensure **"Start Docker Desktop when you log in"** is checked
4. Apply & Restart

With Docker's `restart: unless-stopped` policy, your dashboard will automatically restart after reboots.

---

## Network Configuration

To access the dashboard from other devices on your network (iPhone, iPad, other Macs), you need to configure networking.

### Step 1: Find Your Mac's IP Address

Open Terminal:
```bash
ipconfig getifaddr en0
```

Or go to System Settings → Wi-Fi → Details → TCP/IP to find your IP address.
It will look something like: `192.168.1.100`

### Step 2: Configure macOS Firewall

macOS firewall is typically off by default. If enabled, you'll need to allow incoming connections:

**Option A: Via System Settings**
1. Open System Settings → Network → Firewall
2. If Firewall is on, click "Options..."
3. Add an exception for Node.js or your Terminal app

**Option B: Disable Firewall for Local Network**
For home use, many users simply turn off the firewall:
1. System Settings → Network → Firewall
2. Turn off Firewall

### Step 3: Set a Static IP (Recommended)

To ensure your dashboard is always at the same address:

1. Open System Settings → Wi-Fi
2. Click "Details..." on your network
3. Go to TCP/IP tab
4. Change "Configure IPv4" to "Manually"
5. Enter:
   - IP Address: Your current IP (e.g., `192.168.1.100`)
   - Subnet Mask: `255.255.255.0`
   - Router: Your router's IP (usually `192.168.1.1`)
6. Go to DNS tab and add: `8.8.8.8` or your router's IP
7. Click OK

### Step 4: Access from Other Devices

From any device on your home network, open a browser and go to:
```
http://192.168.1.100:3000
```
(Replace with your actual IP address)

---

## Updating to a Newer Version

When you have new code to deploy, follow these steps:

### Method 1: Using the Update Script (Easiest)

```bash
./scripts/update-dashboard.sh
```

This script will:
1. Stop the service
2. Pull the latest code from Git
3. Install new dependencies
4. Rebuild for production
5. Restart the service

### Method 2: Manual Update

```bash
# Stop the service
launchctl unload ~/Library/LaunchAgents/com.smarthome.dashboard.plist

# Navigate to the project folder
cd ~/SmartHome/dashboard

# Pull the latest code
git pull origin main

# Install any new dependencies
npm install

# Rebuild for production
npm run build

# Restart the service
launchctl load ~/Library/LaunchAgents/com.smarthome.dashboard.plist
```

### Docker Update

If using Docker:
```bash
./scripts/docker-update.sh
```

Or manually:
```bash
cd ~/SmartHome/dashboard
git pull origin main
docker compose down
docker compose up -d --build
```

---

## Remote Management

### Option 1: Screen Sharing (Easiest)

Access your Mac from anywhere in your home network.

**On the Dashboard Mac:**
1. Open System Settings → General → Sharing
2. Enable "Screen Sharing"
3. Note the address shown (e.g., `vnc://192.168.1.100`)

**From Another Mac:**
1. Open Finder
2. Press Cmd+K
3. Enter the VNC address
4. Connect with your Mac username/password

### Option 2: SSH Access (Recommended for Developers)

**Enable SSH on Dashboard Mac:**
1. Open System Settings → General → Sharing
2. Enable "Remote Login"

**Connect from Another Computer:**
```bash
ssh username@192.168.1.100
```

Then you can run commands like:
```bash
launchctl unload ~/Library/LaunchAgents/com.smarthome.dashboard.plist
launchctl load ~/Library/LaunchAgents/com.smarthome.dashboard.plist
```

### Option 3: Remote Update via SSH

```bash
ssh username@192.168.1.100 "cd ~/SmartHome/dashboard && ./scripts/update-dashboard.sh"
```

---

## Troubleshooting

### Dashboard Won't Start

1. **Check the logs:**
   ```bash
   cat ~/SmartHome/logs/dashboard-error.log
   tail -f ~/SmartHome/logs/dashboard-output.log
   ```

2. **Try running manually:**
   ```bash
   cd ~/SmartHome/dashboard
   npm run start
   ```

3. **Check if port 3000 is in use:**
   ```bash
   lsof -i :3000
   ```

### Service Won't Load

1. **Check plist syntax:**
   ```bash
   plutil -lint ~/Library/LaunchAgents/com.smarthome.dashboard.plist
   ```

2. **Check launchd errors:**
   ```bash
   launchctl print gui/$(id -u)/com.smarthome.dashboard
   ```

3. **Check system log:**
   ```bash
   log show --predicate 'senderImagePath contains "launchd"' --last 5m
   ```

### Can't Access from Other Devices

1. **Check firewall is not blocking:**
   System Settings → Network → Firewall

2. **Test local access first:** Can you access `http://localhost:3000`?

3. **Verify IP address:**
   ```bash
   ipconfig getifaddr en0
   ```

4. **Check if devices are on the same network**

### Build Fails

1. **Clear cache and rebuild:**
   ```bash
   rm -rf .next node_modules
   npm install
   npm run build
   ```

2. **Check Node.js version:**
   ```bash
   node --version
   ```
   Should be 18.x or higher.

### Service Keeps Crashing

The `KeepAlive` option in the plist will restart the service if it crashes. Check logs for the root cause:

```bash
tail -100 ~/SmartHome/logs/dashboard-error.log
```

### npm Command Not Found in Service

If you're on Apple Silicon, Homebrew installs to `/opt/homebrew/bin`. Update your plist:

```xml
<key>ProgramArguments</key>
<array>
    <string>/opt/homebrew/bin/npm</string>
    <string>run</string>
    <string>start</string>
</array>

<key>EnvironmentVariables</key>
<dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
</dict>
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Start service | `launchctl load ~/Library/LaunchAgents/com.smarthome.dashboard.plist` |
| Stop service | `launchctl unload ~/Library/LaunchAgents/com.smarthome.dashboard.plist` |
| Check status | `launchctl list \| grep smarthome` |
| View logs | `tail -f ~/SmartHome/logs/dashboard-output.log` |
| View errors | `tail -f ~/SmartHome/logs/dashboard-error.log` |
| Manual start (test) | `cd ~/SmartHome/dashboard && npm start` |
| Build | `npm run build` |
| Update | `./scripts/update-dashboard.sh` |

---

## Summary

After completing this guide, you will have:

✅ A production-ready dashboard running on your Mac  
✅ Automatic startup when macOS boots  
✅ Access from any device on your home network  
✅ Easy update process for new versions  
✅ Remote management capabilities  

**Your dashboard URL:** `http://<your-ip>:3000`

---

*Last updated: December 2024*

