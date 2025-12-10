# Smart Lighting Dashboard

This repository will grow into a smart-lighting hub that discovers every smart switch-panel on the local network, aggregates their metadata, and eventually lets you jump into each panel’s native UI and return to a unified dashboard experience.

## Current App: IP Discovery

Iteration 1 focuses on a simple LAN scanner:

- Configure a base IP (three octets) and a start/end range for the final octet.
- Trigger a discovery run to probe each IP from the server with a short timeout.
- Review how many IPs responded with HTTP 200 (considered “panels”) versus those that failed or timed out.
- Inspect a per-IP status table that shows HTTP codes or any error returned by the scan.

The clean API response plus the standalone results table are intentionally designed so that future iterations can render each panel as a card, open it in an iframe, and provide “enter panel” / “back to dashboard” navigation without reworking the discovery flow.

## Prerequisites

- Node.js >= 18
- npm >= 9 (bundled with Node)

## Installation

```bash
npm install
```

## Running in Development

```bash
npm run dev
```

The Next.js dev server runs on `http://localhost:3000` by default.

## Usage

1. Open `http://localhost:3000`.
2. Adjust the base IP or last-octet range if needed (defaults: `10.88.99.201-244`).
3. Click **Discover**.
4. Watch the summary counters and per-IP table update once the scan finishes.
5. Re-run discovery whenever you need a fresh snapshot—the scanner only performs HTTP GETs and never modifies the panels.

### Discovery behavior

- Requests are issued from the server in small batches with short delays to avoid overwhelming embedded devices.
- Each IP is retried once if it fails to respond, reducing flaky “no response” results while still completing quickly.
- A 1.6 s timeout guards every request so the whole scan stays responsive even if certain IPs never answer.
- An address is marked as a panel only when the HTML clearly mentions “Cubixx” (case-insensitive); any other HTTP 200 page is reported as “Not Cubixx”.

## Deployment

For home deployment on a Windows PC with auto-start on boot, see the detailed guide:

📖 **[Windows Deployment Guide](docs/windows-deployment-guide.md)**

The guide covers:
- Prerequisites and installation
- Running as a Windows service (auto-start on reboot)
- Network configuration for access from other devices
- Updating to newer versions
- Remote management

Helper scripts are available in the `scripts/` folder:
- `install-service.bat` - Automated service installation
- `update-dashboard.bat` - Update and rebuild script
- `uninstall-service.bat` - Remove the service

## Future Plans

- Show each discovered panel as a card that can launch the live panel UI inside an iframe while offering a "return to dashboard" action.
- Gradually expand the dashboard to include metadata, health indicators, and navigation among multiple rooms/floors.
- Add batch operations (e.g., "reset all panels", "push config") built on top of the discovery and monitoring primitives established here.

