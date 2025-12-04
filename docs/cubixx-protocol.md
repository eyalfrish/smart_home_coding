# Cubixx Controller Protocol (Reverse Engineered)

This document captures the endpoints and real-time APIs exposed by Cubixx controllers.
The goal is to provide enough detail to integrate with the controller programmatically 
(via HTTP + WebSockets) without resorting to HTML scraping.

## Device Topology

- **HTTP server on port `80`**: Serves the dashboard, settings UI, and legacy REST 
  endpoints used by anchor fallbacks (e.g. `/on?relay=1`).
- **WebSocket server on port `81`**: Provides real-time state streaming and accepts 
  commands encoded as JSON objects.
- **Auxiliary HTTP endpoint `/api/device-label`**: Persists custom labels for relays, 
  curtains, contacts, and scenes.

## HTTP Endpoints

| Endpoint | Method | Purpose | Notes |
|----------|--------|---------|-------|
| `/` | GET | Dashboard UI | No structured API data, just HTML/CSS/JS |
| `/settings` | GET | Device settings form | Contains hostname input (`id="hostn"`) |
| `/on?relay=N` | GET | Relay on | Fallback for buttons when WS fails |
| `/off?relay=N` | GET | Relay off | Same as above |
| `/curtain?num=N&action=open\|close\|stop` | GET | Curtain control | Used by curtain buttons |
| `/alloff` | GET | Scene action | Triggers the built-in "All Off" scene |
| `/toggleall` | GET | Toggles every relay | Fallback for WS command |
| `/backlight` | GET | Toggles/status LED/backlight | When WS unavailable |
| `/scenes` | GET | Scenes page | Navigation target |
| `/settings` | GET | Settings page | Navigation target |
| `/sync` | GET | Sync settings page | Navigation target |
| `/update` | GET | Firmware update page | Navigation target |
| `/restart` | GET | Restart the device | Immediate restart |
| `/log` | GET | System log page | Diagnostics |
| `/api/device-label` | POST | Rename relays/curtains/contact/scenes | JSON body (see below) |

### Device Label API

**Endpoint:** `POST /api/device-label`

**Request Body:**
```json
{
  "type": "relay" | "curtain" | "contact" | "scene",
  "index": 0,
  "name": "Living Room Light"
}
```

**Response:**
```json
{
  "success": true,
  "type": "relay",
  "index": 0,
  "name": "Living Room Light"
}
```

## WebSocket API

- **URL:** `ws://<host>:81/`
- **Reconnect:** Dashboard retries every 2 seconds if disconnected.
- **Handshake:** Standard WebSocket upgrade; no auth tokens are required on the LAN.

### Commands (Client → Device)

Commands are sent as JSON objects with at least a `command` field:

| Command | Payload Fields | Action |
|---------|----------------|--------|
| `request_state` | — | Requests a full snapshot (`full_state` event) |
| `set_relay` | `index` (0-based), `state` (boolean) | Set relay on/off |
| `toggle_relay` | `index` | Toggle specific relay |
| `toggle_all` | — | Toggle all relays |
| `curtain` | `index`, `action` (`open` \| `close` \| `stop`) | Curtain control |
| `scene_activate` | `index` | Trigger configured scene |
| `all_off` | — | Run the "All Off" scene |
| `backlight` | `state` (boolean) | Control status LED/backlight |
| `lock_buttons` | `state` (boolean) | Lock or unlock panel buttons |

**Example Commands:**

```json
// Request full state
{ "command": "request_state" }

// Turn on relay 0
{ "command": "set_relay", "index": 0, "state": true }

// Toggle relay 2
{ "command": "toggle_relay", "index": 2 }

// Open curtain 0
{ "command": "curtain", "index": 0, "action": "open" }

// Activate scene 1
{ "command": "scene_activate", "index": 1 }

// Turn off status LED
{ "command": "backlight", "state": false }

// Lock panel buttons
{ "command": "lock_buttons", "state": true }
```

### Events (Device → Client)

Messages delivered over the socket always include an `event` discriminator:

| Event | Fields | Meaning |
|-------|--------|---------|
| `full_state` | See below | Comprehensive state snapshot |
| `relay_update` | `relay: { index, state, name? }` or `device` map | Relay state delta |
| `curtain_update` | `curtain: { index, state, name? }` | Curtain status delta |
| `contact_update` | `contact: { index, state, name? }` | Contact sensor delta |
| `device_label` | `relay` / `curtain` / `contact` / `scene` sub-objects | Label pushed from controller |
| `device_label_update` | `target`, `index`, `name` | Another label update form |
| `scene_status` | `name`, `status` | Scene execution feedback |
| `config_saved` | `message` | Confirmation toast |
| `backlight_update` | `backlight: { state: boolean }` | Status LED/backlight state |
| `network_status` | `connected`, `ip` | Wi-Fi summary |
| `ack` | `command`, `args` | Generic command acknowledgement |
| `error` | `command`, `message` | Command failure |

### `full_state` Payload

The `full_state` event is emitted after connecting and whenever explicitly requested.

**Expected Fields:**

```typescript
interface FullState {
  // Network info
  wifiConnected: boolean;
  ssid: string;
  ip: string;
  wifiQuality: number; // 0-100

  // MQTT info
  mqttConnected: boolean;
  mqttDeviceName: string;
  mqttServer: string;

  // Sync info (panel-to-panel sync)
  syncEnabled: boolean;
  syncIp: string;
  syncPort: number;

  // Panel state
  buttonsLocked: boolean;
  statusLedOn: boolean;

  // Scene info
  sceneIsExecuting: boolean;
  sceneName: string;
  activeSceneIndex: number;

  // Time info
  localTime: string;
  localEpoch: number;
  timeZone: string;
  timeSyncStatus: string;

  // Device info
  uptimeMs: number;
  version: string;
  hostname: string;
  deviceId: string;

  // Entities
  relays: Array<{
    index: number;
    state: boolean;
    name?: string;
  }>;
  curtains: Array<{
    index: number;
    state: "open" | "closed" | "opening" | "closing" | "stopped";
    name?: string;
  }>;
  contacts?: Array<{
    index: number;
    state: "open" | "closed";
    name?: string;
  }>;
}
```

**Example `full_state` message:**

```json
{
  "event": "full_state",
  "wifiConnected": true,
  "ssid": "HomeNetwork",
  "ip": "10.88.99.201",
  "wifiQuality": 85,
  "mqttConnected": false,
  "hostname": "living-room-panel",
  "version": "2.1.5",
  "deviceId": "cubixx_abc123",
  "uptimeMs": 3600000,
  "buttonsLocked": false,
  "statusLedOn": true,
  "relays": [
    { "index": 0, "state": true, "name": "Ceiling Light" },
    { "index": 1, "state": false, "name": "Wall Lamp" },
    { "index": 2, "state": false, "name": "Fan" }
  ],
  "curtains": [
    { "index": 0, "state": "open", "name": "Main Curtain" }
  ]
}
```

### Event Examples

**`relay_update` (single relay):**
```json
{
  "event": "relay_update",
  "relay": { "index": 0, "state": true }
}
```

**`relay_update` (batch format):**
```json
{
  "event": "relay_update",
  "device": { "0": true, "1": false, "2": true }
}
```

**`curtain_update`:**
```json
{
  "event": "curtain_update",
  "curtain": { "index": 0, "state": "closing" }
}
```

**`scene_status`:**
```json
{
  "event": "scene_status",
  "name": "Movie Mode",
  "status": "executed"
}
```

## Interaction Flow

1. Browser/client loads dashboard and opens `ws://<host>:81/`
2. Immediately sends `{"command":"request_state"}` to obtain `full_state`
3. Displays UI using `full_state` data
4. User interactions send commands via WebSocket
5. Device responds with delta events (`relay_update`, etc.)
6. If WebSocket fails, HTTP fallback endpoints (`/on?relay=N`) are used

## Dashboard Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Server                            │
│                                                                  │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │   SSE API   │◄───│  Panel Registry  │────│ CubixxClient  │──┼──► WS Port 81
│  │  /api/panels│    │   (Singleton)    │    │  (per panel)  │  │    Panels
│  │   /stream   │    └──────────────────┘    └───────────────┘  │
│  └──────┬──────┘                                                │
│         │                                                       │
└─────────┼───────────────────────────────────────────────────────┘
          │
          │ SSE Events
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Client                            │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ usePanelStream  │───►│    Dashboard    │                     │
│  │     (Hook)      │    │   Components    │                     │
│  └─────────────────┘    └─────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

## Known Limitations / Assumptions

- **No authentication or TLS**: All traffic is plain HTTP/WebSocket over the LAN.
- **Contact sensor payloads**: Exact shapes not fully documented, but label update 
  hooks demonstrate that contacts exist and share the same rename API.
- **Curtain long-press**: Client-side behavior sends repeated `curtain` commands 
  (`open` on press, `stop` on release unless press exceeded 1 second).
- **State source**: The dashboard never scrapes HTML to learn about relays/curtains; 
  everything comes from WebSocket data once connected.

## Future Command Support

For dashboard-wide operations (planned):

| Command | Purpose |
|---------|---------|
| `restart` | Restart the panel |
| `update` | Trigger firmware update check |

These commands can be sent to multiple panels via the dashboard's `/api/panels/command` 
endpoint with `ips: "*"` to broadcast to all connected panels.

