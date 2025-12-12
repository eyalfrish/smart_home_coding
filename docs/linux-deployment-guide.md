# Linux Home Deployment Guide

This guide explains how to deploy the Smart Lighting Dashboard on a Linux machine at home, with automatic restart on reboot and remote management capabilities.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Building for Production](#building-for-production)
4. [Running as a systemd Service](#running-as-a-systemd-service)
5. [Docker Deployment (Alternative)](#docker-deployment-alternative)
6. [Network Configuration](#network-configuration)
7. [Updating to a Newer Version](#updating-to-a-newer-version)
8. [Remote Management](#remote-management)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, you'll need to install the following software on your Linux machine:

### 1. Node.js (Required)

Node.js is the runtime that powers the dashboard.

**Ubuntu/Debian:**
```bash
# Using NodeSource (recommended for latest LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or using apt (may be older version)
sudo apt update
sudo apt install nodejs npm
```

**Fedora/RHEL/CentOS:**
```bash
# Using NodeSource
curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
sudo dnf install nodejs

# Or using dnf
sudo dnf install nodejs npm
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm
```

**Using nvm (any distro):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install --lts
```

**Verify installation:**
```bash
node --version
npm --version
```
You should see version numbers (Node 18+ and npm 9+).

### 2. Git (Recommended for Updates)

**Ubuntu/Debian:**
```bash
sudo apt install git
```

**Fedora/RHEL:**
```bash
sudo dnf install git
```

**Verify installation:**
```bash
git --version
```

### 3. Docker (Optional - Alternative Deployment)

If you prefer Docker deployment:

**Ubuntu/Debian:**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (logout/login required)
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install docker-compose-plugin
```

**Fedora:**
```bash
sudo dnf install docker docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

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

## Running as a systemd Service

This is the key step that makes your dashboard start automatically when Linux boots. On Linux, we use **systemd** — the standard service manager on most modern distributions.

### Method 1: Using the Install Script (Easiest)

Make the scripts executable and run the installer:
```bash
cd ~/SmartHome/dashboard

# Make scripts executable
chmod +x scripts/*.sh

# Run the installer (requires sudo)
sudo ./scripts/install-service-linux.sh
```

The script will:
1. Detect your user and paths automatically
2. Create the systemd service file
3. Enable auto-start on boot
4. Start the service

### Method 2: Manual Installation

#### Step 1: Create the systemd service file

Create a file at `/etc/systemd/system/smarthome-dashboard.service`:

```bash
sudo nano /etc/systemd/system/smarthome-dashboard.service
```

Paste the following content (adjust paths and username):

```ini
[Unit]
Description=Smart Home Dashboard
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
Group=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/SmartHome/dashboard
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
StandardOutput=append:/home/YOUR_USERNAME/SmartHome/logs/dashboard-output.log
StandardError=append:/home/YOUR_USERNAME/SmartHome/logs/dashboard-error.log

[Install]
WantedBy=multi-user.target
```

**Important:** Replace `YOUR_USERNAME` with your actual Linux username. Find it with:
```bash
whoami
```

#### Step 2: Create the logs directory

```bash
mkdir -p ~/SmartHome/logs
```

#### Step 3: Enable and start the service

```bash
# Reload systemd to recognize the new service
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable smarthome-dashboard

# Start the service now
sudo systemctl start smarthome-dashboard
```

#### Step 4: Verify it's running

```bash
sudo systemctl status smarthome-dashboard
```

You should see output like:
```
● smarthome-dashboard.service - Smart Home Dashboard
     Loaded: loaded (/etc/systemd/system/smarthome-dashboard.service; enabled)
     Active: active (running) since ...
```

Also check by opening `http://localhost:3000` in your browser.

### Managing the Service

```bash
# Check status
sudo systemctl status smarthome-dashboard

# Stop the service
sudo systemctl stop smarthome-dashboard

# Start the service
sudo systemctl start smarthome-dashboard

# Restart the service
sudo systemctl restart smarthome-dashboard

# Disable auto-start
sudo systemctl disable smarthome-dashboard

# View logs (systemd journal)
sudo journalctl -u smarthome-dashboard -f

# View application logs
tail -f ~/SmartHome/logs/dashboard-output.log
tail -f ~/SmartHome/logs/dashboard-error.log
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

```bash
# Enable Docker service
sudo systemctl enable docker

# The container will auto-restart due to restart: unless-stopped policy
```

---

## Network Configuration

To access the dashboard from other devices on your network (phone, tablet, other computers), you need to configure networking.

### Step 1: Find Your Machine's IP Address

```bash
# Method 1: ip command
ip addr show | grep "inet " | grep -v 127.0.0.1

# Method 2: hostname command
hostname -I

# Method 3: Check specific interface (e.g., eth0, wlan0)
ip addr show eth0
```

Look for an address like `192.168.1.100`.

### Step 2: Configure Firewall

**Ubuntu/Debian (UFW):**
```bash
# Check if UFW is active
sudo ufw status

# Allow port 3000
sudo ufw allow 3000/tcp
```

**Fedora/RHEL (firewalld):**
```bash
# Check if firewalld is active
sudo firewall-cmd --state

# Allow port 3000
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

**iptables (manual):**
```bash
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

### Step 3: Set a Static IP (Recommended)

To ensure your dashboard is always at the same address, configure a static IP. The method varies by distribution and network manager:

**Using NetworkManager (most distros):**
```bash
# List connections
nmcli connection show

# Set static IP (replace 'Wired connection 1' with your connection name)
nmcli connection modify "Wired connection 1" \
    ipv4.method manual \
    ipv4.addresses 192.168.1.100/24 \
    ipv4.gateway 192.168.1.1 \
    ipv4.dns "8.8.8.8,8.8.4.4"

# Restart connection
nmcli connection up "Wired connection 1"
```

**Using netplan (Ubuntu Server):**
Edit `/etc/netplan/01-netcfg.yaml`:
```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```
Then apply: `sudo netplan apply`

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
# May need sudo for service restart
./scripts/update-dashboard-linux.sh
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
sudo systemctl stop smarthome-dashboard

# Navigate to the project folder
cd ~/SmartHome/dashboard

# Pull the latest code
git pull origin main

# Install any new dependencies
npm install

# Rebuild for production
npm run build

# Restart the service
sudo systemctl start smarthome-dashboard
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

### Option 1: SSH Access (Standard)

SSH is typically enabled by default on most Linux distributions.

**If SSH is not installed:**
```bash
# Ubuntu/Debian
sudo apt install openssh-server
sudo systemctl enable ssh
sudo systemctl start ssh

# Fedora/RHEL
sudo dnf install openssh-server
sudo systemctl enable sshd
sudo systemctl start sshd
```

**Connect from another computer:**
```bash
ssh username@192.168.1.100
```

Then you can run commands like:
```bash
sudo systemctl restart smarthome-dashboard
```

### Option 2: Remote Update via SSH

```bash
ssh username@192.168.1.100 "cd ~/SmartHome/dashboard && ./scripts/update-dashboard-linux.sh"
```

### Option 3: Web-based Terminal (Cockpit)

Cockpit provides a web interface for managing Linux servers.

**Install Cockpit:**
```bash
# Ubuntu/Debian
sudo apt install cockpit
sudo systemctl enable --now cockpit.socket

# Fedora/RHEL
sudo dnf install cockpit
sudo systemctl enable --now cockpit.socket
```

**Access via browser:** `https://192.168.1.100:9090`

---

## Troubleshooting

### Dashboard Won't Start

1. **Check the service status:**
   ```bash
   sudo systemctl status smarthome-dashboard
   ```

2. **Check systemd journal:**
   ```bash
   sudo journalctl -u smarthome-dashboard -n 50 --no-pager
   ```

3. **Check application logs:**
   ```bash
   cat ~/SmartHome/logs/dashboard-error.log
   ```

4. **Try running manually:**
   ```bash
   cd ~/SmartHome/dashboard
   npm run start
   ```

5. **Check if port 3000 is in use:**
   ```bash
   sudo ss -tulpn | grep :3000
   # or
   sudo netstat -tulpn | grep :3000
   ```

### Service Won't Install

1. **Check if systemd is available:**
   ```bash
   systemctl --version
   ```

2. **Verify paths in service file:**
   ```bash
   which npm
   which node
   echo $HOME
   ```

3. **Check service file syntax:**
   ```bash
   sudo systemd-analyze verify /etc/systemd/system/smarthome-dashboard.service
   ```

### Can't Access from Other Devices

1. **Check firewall:**
   ```bash
   sudo ufw status          # Ubuntu
   sudo firewall-cmd --list-all  # Fedora
   ```

2. **Test local access first:** Can you access `http://localhost:3000`?

3. **Verify IP address:**
   ```bash
   hostname -I
   ```

4. **Check if service is listening on all interfaces:**
   ```bash
   sudo ss -tulpn | grep :3000
   ```
   Should show `0.0.0.0:3000` or `*:3000`, not `127.0.0.1:3000`.

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

3. **Check disk space:**
   ```bash
   df -h
   ```

### Service Keeps Crashing

The `Restart=always` option in systemd will restart the service automatically. Check logs for the root cause:

```bash
sudo journalctl -u smarthome-dashboard --since "1 hour ago"
```

### Permission Issues

If you see permission errors:
```bash
# Fix ownership
sudo chown -R $USER:$USER ~/SmartHome

# Fix permissions
chmod -R 755 ~/SmartHome/dashboard
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Start service | `sudo systemctl start smarthome-dashboard` |
| Stop service | `sudo systemctl stop smarthome-dashboard` |
| Restart service | `sudo systemctl restart smarthome-dashboard` |
| Check status | `sudo systemctl status smarthome-dashboard` |
| Enable auto-start | `sudo systemctl enable smarthome-dashboard` |
| Disable auto-start | `sudo systemctl disable smarthome-dashboard` |
| View journal logs | `sudo journalctl -u smarthome-dashboard -f` |
| View app logs | `tail -f ~/SmartHome/logs/dashboard-output.log` |
| View errors | `tail -f ~/SmartHome/logs/dashboard-error.log` |
| Manual start (test) | `cd ~/SmartHome/dashboard && npm start` |
| Build | `npm run build` |
| Update | `./scripts/update-dashboard-linux.sh` |

---

## Summary

After completing this guide, you will have:

✅ A production-ready dashboard running on your Linux machine  
✅ Automatic startup when the system boots  
✅ Access from any device on your home network  
✅ Easy update process for new versions  
✅ Remote management via SSH  

**Your dashboard URL:** `http://<your-ip>:3000`

---

## Supported Distributions

This guide has been tested on:
- Ubuntu 20.04, 22.04, 24.04
- Debian 11, 12
- Fedora 38, 39, 40
- Rocky Linux / AlmaLinux 8, 9
- Raspberry Pi OS (Debian-based)

Other systemd-based distributions should work with minor adjustments.

---

*Last updated: December 2024*

