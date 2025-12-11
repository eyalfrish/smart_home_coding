# Docker Deployment Guide

This guide explains how to deploy the Smart Lighting Dashboard using Docker on Windows. This is the **recommended method** for home deployment as it requires minimal setup and handles updates cleanly.

---

## Table of Contents

1. [Why Docker?](#why-docker)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Detailed Setup](#detailed-setup)
5. [Automatic Restart on Boot](#automatic-restart-on-boot)
6. [Updating the Dashboard](#updating-the-dashboard)
7. [Network Configuration](#network-configuration)
8. [Management Commands](#management-commands)
9. [Troubleshooting](#troubleshooting)

---

## Why Docker?

| Traditional Deployment | Docker Deployment |
|----------------------|-------------------|
| Requires Node.js installation | Only requires Docker Desktop |
| Requires NSSM for auto-start | Built-in restart policy |
| Manual dependency management | Dependencies bundled in image |
| Complex updates | Simple rebuild & restart |
| Environment conflicts possible | Isolated container |

**Docker advantages:**
- ✅ Single prerequisite (Docker Desktop)
- ✅ Automatic restart after reboot
- ✅ Clean updates without leftover files
- ✅ Consistent environment
- ✅ Easy to completely remove
- ✅ Log management included

---

## Prerequisites

### Docker Desktop for Windows

1. Go to [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Download "Docker Desktop for Windows"
3. Run the installer
4. **Important**: During setup, ensure "Use WSL 2 instead of Hyper-V" is selected (recommended)
5. Restart your computer if prompted
6. After restart, Docker Desktop will start automatically
7. Accept the license agreement

**Verify installation** by opening Command Prompt or PowerShell:
```cmd
docker --version
docker compose version
```

### Configure Docker to Start on Boot

This ensures Docker (and thus your dashboard) starts after a system reboot:

1. Open Docker Desktop
2. Click the gear icon (Settings)
3. Under "General", ensure **"Start Docker Desktop when you sign in"** is checked
4. Click "Apply & Restart"

---

## Quick Start

If you already have Docker Desktop running, here's the fastest way to get started:

```cmd
:: Navigate to the dashboard folder
cd C:\path\to\smart_home_coding

:: Build and start (first time takes a few minutes)
docker compose up -d --build

:: Check it's running
docker compose ps
```

Open your browser: **http://localhost:3000**

That's it! The dashboard is running and will auto-restart after reboots.

---

## Detailed Setup

### Step 1: Get the Code

**Option A: Clone with Git**
```cmd
mkdir C:\SmartHome
cd C:\SmartHome
git clone <your-repository-url> dashboard
cd dashboard
```

**Option B: Copy Files**
Copy your project folder to `C:\SmartHome\dashboard`

### Step 2: Build and Start

Navigate to the project folder:
```cmd
cd C:\SmartHome\dashboard
```

Build the Docker image and start the container:
```cmd
docker compose up -d --build
```

The first build takes 2-5 minutes as it:
- Downloads the Node.js base image
- Installs dependencies
- Builds the Next.js application
- Creates the final minimal image

Subsequent starts are nearly instant.

### Step 3: Verify It's Running

Check container status:
```cmd
docker compose ps
```

You should see:
```
NAME                    STATUS              PORTS
smart-home-dashboard    Up X minutes        0.0.0.0:3000->3000/tcp
```

Open your browser and go to: **http://localhost:3000**

---

## Automatic Restart on Boot

The Docker Compose configuration includes `restart: unless-stopped`, which means:

- ✅ Container restarts automatically if it crashes
- ✅ Container starts automatically when Docker starts
- ✅ Docker Desktop starts automatically when Windows boots (if configured)
- ❌ Container won't restart if you manually stopped it with `docker compose down`

**To ensure full auto-start after reboot:**

1. Docker Desktop must be set to start on login (see Prerequisites)
2. The container must be running (not manually stopped)

**Test it:**
1. Restart your computer
2. Wait ~30-60 seconds after login for Docker to fully start
3. Open http://localhost:3000

---

## Updating the Dashboard

### Method 1: Using Helper Scripts (Easiest)

Double-click `scripts\docker-update.bat` or run:
```cmd
cd C:\SmartHome\dashboard
scripts\docker-update.bat
```

This script:
1. Stops the current container
2. Rebuilds with `--no-cache` for a fresh build
3. Starts the updated container
4. Cleans up old images

### Method 2: Manual Commands

```cmd
:: Navigate to the project
cd C:\SmartHome\dashboard

:: Pull latest code (if using git)
git pull origin main

:: Stop, rebuild, and restart
docker compose down
docker compose up -d --build

:: Optional: Clean up old images
docker image prune -f
```

### Method 3: Simple Rebuild

If you've made local changes or pulled new code:
```cmd
docker compose up -d --build
```

Docker Compose is smart enough to detect changes and rebuild only what's needed.

---

## Network Configuration

### Accessing from Other Devices

By default, the dashboard is accessible from any device on your local network.

**Find your computer's IP address:**
```cmd
ipconfig
```
Look for "IPv4 Address" (e.g., `192.168.1.100`)

**Access from phone/tablet/other computer:**
```
http://192.168.1.100:3000
```

### Windows Firewall

Docker Desktop usually configures firewall rules automatically. If you can't access from other devices:

**Option A: Via GUI**
1. Open Windows Defender Firewall → Advanced Settings
2. Inbound Rules → New Rule
3. Port → TCP → 3000 → Allow → All profiles
4. Name: "Smart Home Dashboard"

**Option B: Via Command (as Administrator)**
```cmd
netsh advfirewall firewall add rule name="Smart Home Dashboard" dir=in action=allow protocol=TCP localport=3000
```

### Changing the Port

To use a different port (e.g., 8080), edit `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"  # Changed from "3000:3000"
```

Then restart:
```cmd
docker compose up -d
```

Access at: http://localhost:8080

---

## Management Commands

### Using Helper Scripts

| Script | Purpose |
|--------|---------|
| `scripts\docker-start.bat` | Build (if needed) and start |
| `scripts\docker-stop.bat` | Stop the container |
| `scripts\docker-update.bat` | Full rebuild with cleanup |
| `scripts\docker-logs.bat` | View live logs |
| `scripts\docker-status.bat` | Check status and health |

### Direct Docker Commands

| Task | Command |
|------|---------|
| Start | `docker compose up -d` |
| Start with rebuild | `docker compose up -d --build` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| View logs | `docker compose logs -f` |
| View recent logs | `docker compose logs --tail=100` |
| Check status | `docker compose ps` |
| Check health | `docker inspect smart-home-dashboard --format='{{.State.Health.Status}}'` |
| Resource usage | `docker stats smart-home-dashboard` |
| Shell into container | `docker exec -it smart-home-dashboard sh` |

### Complete Cleanup

To completely remove the dashboard (container, image, everything):

```cmd
:: Stop and remove container
docker compose down

:: Remove the image
docker rmi smart-home-dashboard:latest

:: Remove build cache (optional, frees disk space)
docker builder prune -f
```

---

## Troubleshooting

### Container Won't Start

**Check logs:**
```cmd
docker compose logs
```

**Check if port is in use:**
```cmd
netstat -ano | findstr :3000
```

If another app uses port 3000, either stop it or change the dashboard port.

### Docker Desktop Not Starting

1. Ensure virtualization is enabled in BIOS
2. For WSL 2 backend: Run `wsl --update` in PowerShell (as Admin)
3. Try restarting Docker Desktop

### "Cannot connect to Docker daemon"

Docker Desktop isn't running. Start it from the Start menu or system tray.

### Build Fails

**Clear Docker cache and rebuild:**
```cmd
docker compose build --no-cache
```

**If still failing, full cleanup:**
```cmd
docker compose down
docker system prune -f
docker compose up -d --build
```

### Container Starts but Site Doesn't Load

1. Check container is healthy:
   ```cmd
   docker compose ps
   ```
   
2. Check logs for errors:
   ```cmd
   docker compose logs --tail=50
   ```

3. Verify port mapping:
   ```cmd
   docker port smart-home-dashboard
   ```

### Slow Performance

**Check resource usage:**
```cmd
docker stats smart-home-dashboard
```

**Increase Docker resources:**
1. Open Docker Desktop → Settings
2. Go to Resources
3. Increase Memory (recommend 2GB+)
4. Apply & Restart

### After Windows Update, Container Won't Start

Windows updates sometimes affect WSL 2 or Hyper-V:

```cmd
:: Update WSL
wsl --update

:: Restart Docker Desktop
:: (Right-click system tray icon → Restart)

:: Restart your container
docker compose up -d
```

---

## File Structure

After setup, your project will have these Docker-related files:

```
smart_home_coding/
├── Dockerfile              # Multi-stage build instructions
├── docker-compose.yml      # Container configuration
├── .dockerignore           # Files excluded from build
└── scripts/
    ├── docker-start.bat    # Start helper
    ├── docker-stop.bat     # Stop helper
    ├── docker-update.bat   # Update helper
    ├── docker-logs.bat     # Log viewer
    └── docker-status.bat   # Status checker
```

---

## Quick Reference Card

**First time setup:**
```cmd
cd C:\SmartHome\dashboard
docker compose up -d --build
```

**Daily operations:**
- Start: `docker compose up -d`
- Stop: `docker compose down`
- Logs: `docker compose logs -f`
- Status: `docker compose ps`

**After pulling new code:**
```cmd
docker compose up -d --build
```

**Access URL:** `http://localhost:3000` or `http://<your-ip>:3000`

---

*Last updated: December 2024*

