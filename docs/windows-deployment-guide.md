# Windows Home Deployment Guide

This guide explains how to deploy the Smart Lighting Dashboard on a Windows desktop computer at home, with automatic restart on reboot and remote management capabilities.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Building for Production](#building-for-production)
4. [Running as a Windows Service](#running-as-a-windows-service)
5. [Network Configuration](#network-configuration)
6. [Updating to a Newer Version](#updating-to-a-newer-version)
7. [Remote Management](#remote-management)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, you'll need to install the following software on your Windows machine:

### 1. Node.js (Required)

Node.js is the runtime that powers the dashboard.

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS version** (should be 18.x or higher)
3. Run the installer with default options
4. **Important**: Check the box that says "Automatically install necessary tools" if prompted

**Verify installation** by opening Command Prompt (Win+R, type `cmd`, press Enter):
```cmd
node --version
npm --version
```
You should see version numbers (Node 18+ and npm 9+).

### 2. Git (Recommended for Updates)

Git makes it easy to download and update the code.

1. Go to [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Download and run the installer
3. Use default options (click "Next" through the wizard)

**Verify installation**:
```cmd
git --version
```

### 3. NSSM - Non-Sucking Service Manager (Required for Auto-Start)

NSSM lets you run the dashboard as a Windows Service that auto-starts on boot.

1. Go to [https://nssm.cc/download](https://nssm.cc/download)
2. Download the latest release (zip file)
3. Extract the zip file
4. Copy `nssm.exe` from the `win64` folder to `C:\Windows\System32\`
   - Or add the folder containing `nssm.exe` to your system PATH

**Verify installation**:
```cmd
nssm version
```

---

## Initial Setup

### Step 1: Choose an Installation Location

Create a dedicated folder for the dashboard. We recommend:
```
C:\SmartHome\dashboard
```

Open Command Prompt **as Administrator** (right-click Command Prompt → Run as administrator):
```cmd
mkdir C:\SmartHome
cd C:\SmartHome
```

### Step 2: Get the Code

**Option A: Clone with Git (Recommended)**
```cmd
git clone <your-repository-url> dashboard
cd dashboard
```

**Option B: Copy Files Manually**
Copy your entire project folder to `C:\SmartHome\dashboard`

### Step 3: Install Dependencies

```cmd
cd C:\SmartHome\dashboard
npm install
```

This downloads all required packages. Wait for it to complete (may take 1-3 minutes).

---

## Building for Production

Development mode (`npm run dev`) is slower and uses more resources. For home deployment, always use production mode.

### Build the Application

```cmd
cd C:\SmartHome\dashboard
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
```cmd
npm run start
```

Open your browser and go to `http://localhost:3000`. If you see the dashboard, it's working!

Press `Ctrl+C` to stop the server.

---

## Running as a Windows Service

This is the key step that makes your dashboard start automatically when Windows boots.

### Step 1: Create a Startup Script

Create a file called `start-dashboard.bat` in your dashboard folder:

**Location**: `C:\SmartHome\dashboard\start-dashboard.bat`

**Contents**:
```batch
@echo off
cd /d C:\SmartHome\dashboard
npm run start
```

### Step 2: Install the Service with NSSM

Open Command Prompt **as Administrator**:

```cmd
nssm install SmartHomeDashboard
```

A GUI window will appear. Fill in these settings:

**Application tab:**
- **Path**: `C:\SmartHome\dashboard\start-dashboard.bat`
- **Startup directory**: `C:\SmartHome\dashboard`

**Details tab:**
- **Display name**: `Smart Home Dashboard`
- **Description**: `Smart lighting discovery and control dashboard`
- **Startup type**: `Automatic`

**I/O tab (for logging):**
- **Output (stdout)**: `C:\SmartHome\logs\dashboard-output.log`
- **Error (stderr)**: `C:\SmartHome\logs\dashboard-error.log`

Create the logs folder first:
```cmd
mkdir C:\SmartHome\logs
```

Click **"Install service"**.

### Step 3: Start the Service

```cmd
nssm start SmartHomeDashboard
```

### Step 4: Verify It's Running

```cmd
nssm status SmartHomeDashboard
```

Should show: `SERVICE_RUNNING`

Also check by opening `http://localhost:3000` in your browser.

### Managing the Service

```cmd
:: Stop the service
nssm stop SmartHomeDashboard

:: Restart the service
nssm restart SmartHomeDashboard

:: Check status
nssm status SmartHomeDashboard

:: View/edit service configuration
nssm edit SmartHomeDashboard

:: Remove the service (if needed)
nssm remove SmartHomeDashboard confirm
```

---

## Network Configuration

To access the dashboard from other devices on your network (phone, other computer), you need to configure networking.

### Step 1: Find Your Computer's IP Address

Open Command Prompt:
```cmd
ipconfig
```

Look for "IPv4 Address" under your active network adapter. It will look something like:
```
IPv4 Address. . . . . . . . . . . : 192.168.1.100
```

### Step 2: Configure Windows Firewall

Allow incoming connections on port 3000:

1. Open Windows Defender Firewall (search "Firewall" in Start menu)
2. Click "Advanced settings" on the left
3. Click "Inbound Rules" on the left
4. Click "New Rule..." on the right
5. Select "Port" → Next
6. Select "TCP" and enter "3000" → Next
7. Select "Allow the connection" → Next
8. Check all profiles (Domain, Private, Public) → Next
9. Name it "Smart Home Dashboard" → Finish

**Or via Command Prompt (as Administrator):**
```cmd
netsh advfirewall firewall add rule name="Smart Home Dashboard" dir=in action=allow protocol=TCP localport=3000
```

### Step 3: Set a Static IP (Recommended)

To ensure your dashboard is always at the same address:

1. Open Settings → Network & Internet → Change adapter options
2. Right-click your network adapter → Properties
3. Select "Internet Protocol Version 4 (TCP/IPv4)" → Properties
4. Select "Use the following IP address"
5. Enter:
   - IP address: Your current IP (e.g., `192.168.1.100`)
   - Subnet mask: `255.255.255.0`
   - Default gateway: Your router's IP (usually `192.168.1.1`)
   - Preferred DNS: `8.8.8.8` or your router's IP

### Step 4: Access from Other Devices

From any device on your home network, open a browser and go to:
```
http://192.168.1.100:3000
```
(Replace with your actual IP address)

---

## Updating to a Newer Version

When you have new code to deploy, follow these steps:

### Method 1: Using Git (Recommended)

```cmd
:: Stop the service
nssm stop SmartHomeDashboard

:: Navigate to the project folder
cd C:\SmartHome\dashboard

:: Pull the latest code
git pull origin main

:: Install any new dependencies
npm install

:: Rebuild for production
npm run build

:: Restart the service
nssm start SmartHomeDashboard
```

### Method 2: Manual File Update

1. Stop the service:
   ```cmd
   nssm stop SmartHomeDashboard
   ```

2. Backup your current installation:
   ```cmd
   xcopy C:\SmartHome\dashboard C:\SmartHome\dashboard-backup /E /I
   ```

3. Copy new files to `C:\SmartHome\dashboard` (replace existing files)

4. Reinstall dependencies and rebuild:
   ```cmd
   cd C:\SmartHome\dashboard
   npm install
   npm run build
   ```

5. Restart the service:
   ```cmd
   nssm start SmartHomeDashboard
   ```

### Quick Update Script

Create `C:\SmartHome\update-dashboard.bat`:

```batch
@echo off
echo Stopping dashboard service...
nssm stop SmartHomeDashboard

echo Updating code...
cd /d C:\SmartHome\dashboard
git pull origin main

echo Installing dependencies...
npm install

echo Building for production...
npm run build

echo Starting service...
nssm start SmartHomeDashboard

echo Update complete!
pause
```

Run this script **as Administrator** whenever you need to update.

---

## Remote Management

### Option 1: Windows Remote Desktop (Easiest)

Access your dashboard computer from anywhere in your home network.

**On the Dashboard Computer:**
1. Open Settings → System → Remote Desktop
2. Enable "Enable Remote Desktop"
3. Note the PC name shown

**From Another Windows Computer:**
1. Search "Remote Desktop Connection" in Start menu
2. Enter the dashboard computer's name or IP
3. Connect with your Windows username/password

### Option 2: SSH Access (Advanced)

Windows 10/11 has built-in OpenSSH. This lets you run commands remotely.

**Enable OpenSSH Server on Dashboard Computer:**
1. Open Settings → Apps → Optional Features
2. Click "Add a feature"
3. Find and install "OpenSSH Server"
4. Open Services (search "services.msc")
5. Find "OpenSSH SSH Server" → right-click → Properties
6. Set Startup type to "Automatic" → Start → OK

**Add Firewall Rule:**
```cmd
netsh advfirewall firewall add rule name="OpenSSH Server" dir=in action=allow protocol=TCP localport=22
```

**Connect from Another Computer:**
```cmd
ssh username@192.168.1.100
```

Then you can run commands like:
```cmd
nssm restart SmartHomeDashboard
```

### Option 3: Create a Remote Update Script

You can update the dashboard remotely via SSH:

```cmd
ssh username@192.168.1.100 "C:\SmartHome\update-dashboard.bat"
```

---

## Troubleshooting

### Dashboard Won't Start

1. **Check the logs:**
   ```cmd
   type C:\SmartHome\logs\dashboard-error.log
   ```

2. **Try running manually:**
   ```cmd
   cd C:\SmartHome\dashboard
   npm run start
   ```

3. **Check if port 3000 is in use:**
   ```cmd
   netstat -ano | findstr :3000
   ```

### Service Won't Install

- Make sure you're running Command Prompt **as Administrator**
- Verify `nssm.exe` is in your PATH or `C:\Windows\System32`

### Can't Access from Other Devices

1. **Check firewall rule is active:**
   ```cmd
   netsh advfirewall firewall show rule name="Smart Home Dashboard"
   ```

2. **Test local access first:** Can you access `http://localhost:3000`?

3. **Verify IP address:** Run `ipconfig` and confirm the IP

4. **Check if devices are on same network**

### Build Fails

1. **Clear cache and rebuild:**
   ```cmd
   rmdir /s /q .next
   rmdir /s /q node_modules
   npm install
   npm run build
   ```

2. **Check Node.js version:**
   ```cmd
   node --version
   ```
   Should be 18.x or higher.

### Service Crashes Repeatedly

Check the NSSM recovery settings:
```cmd
nssm edit SmartHomeDashboard
```

Go to the "Exit actions" tab and set:
- Restart delay: 5000 (milliseconds)
- Action on exit: Restart application

---

## Quick Reference

| Task | Command |
|------|---------|
| Start service | `nssm start SmartHomeDashboard` |
| Stop service | `nssm stop SmartHomeDashboard` |
| Restart service | `nssm restart SmartHomeDashboard` |
| Check status | `nssm status SmartHomeDashboard` |
| View logs | `type C:\SmartHome\logs\dashboard-output.log` |
| View errors | `type C:\SmartHome\logs\dashboard-error.log` |
| Manual start (test) | `cd C:\SmartHome\dashboard && npm start` |
| Build | `npm run build` |
| Update & rebuild | Run `C:\SmartHome\update-dashboard.bat` |

---

## Summary

After completing this guide, you will have:

✅ A production-ready dashboard running on your Windows PC  
✅ Automatic startup when Windows boots  
✅ Access from any device on your home network  
✅ Easy update process for new versions  
✅ Remote management capabilities  

**Your dashboard URL:** `http://<your-ip>:3000`

---

*Last updated: December 2024*

