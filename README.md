# Smart Home Panels Dashboard

A dashboard that discovers and aggregates all smart switch-panels in the house, displays their metadata, and allows navigation into each panel’s local Web UI and back. This repo will eventually support batch operations, device scanning, and reverse-engineered communication (REST/WebSocket) with each switch panel.

## Overview

The Smart Home Panels Dashboard will orchestrate discovery, monitoring, and control flows for every network-connected switch panel on the property. The project will unify metadata aggregation, quick navigation to per-panel UIs, and future automation hooks into a single experience tailored for advanced smart-home setups.

## Planned Architecture (high-level)

- Lightweight Python services handle device discovery, metadata collection, and communication protocol experiments.
- A modern React/Vite/Next.js frontend renders a responsive dashboard for viewing all panels, drilling into details, and launching local UI sessions.
- Shared data contracts (REST/WebSocket) will keep the frontend synchronized with discovery updates and batch command responses.
- Modular adapters will make it easy to add new panel vendors or custom firmware integrations over time.

## Expected Features

- Automatic discovery of all smart switch panels on the home network, with metadata refreshes.
- Central dashboard with quick navigation into each panel’s local Web UI and a simple path back to the aggregate view.
- Batch operations for firmware updates, configuration pushes, or diagnostics across multiple panels simultaneously.
- Extensible communication layer supporting REST, WebSocket, and reverse-engineered protocols as they surface.

## Folder Structure

```text
smart_home_coding/
├─ backend/          # Python services for discovery and protocol handling (planned)
├─ frontend/         # React/Vite/Next.js dashboard application (planned)
├─ docs/             # Design notes, protocol research, and future specifications (planned)
└─ scripts/          # Utilities for scanning, testing, and deployment workflows (planned)
```

## Setup Instructions

Setup scripts and environment configuration will be provided once the backend and frontend scaffolding land. For now, ensure you have Python 3.11+, Node.js 20+, and a modern package manager (npm, pnpm, or yarn) ready to go.

## Roadmap

1. Establish automated device discovery service and persistence layer.
2. Scaffold the frontend dashboard with mock data and navigation flows.
3. Implement live metadata updates via REST/WebSocket contracts.
4. Add batch operation tooling with auditing and graceful failure handling.
5. Expand protocol support based on reverse-engineering findings and vendor collaboration.
