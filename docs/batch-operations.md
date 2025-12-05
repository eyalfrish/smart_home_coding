# Batch Operations for Cubixx Panels

This document analyzes the Cubixx panel APIs (HTTP endpoints and WebSocket commands) to identify which operations are suitable for batch invocation across multiple panels.

## Overview

Batch operations allow administrators to execute the same command across multiple selected panels simultaneously. This is particularly useful for:
- Fleet-wide configuration changes
- Synchronized actions across rooms/zones
- Bulk firmware updates
- Emergency shutdowns or resets

---

## Batch-Suitable Operations

### 1. **Restart** ⭐ High Priority
**Command:** `restart` (HTTP: `GET /restart`, WebSocket: `{ "command": "restart" }`)

**Use Case:** Restart multiple panels after configuration changes, to recover from issues, or as part of maintenance routines.

**Considerations:**
- Panels will disconnect from WebSocket immediately
- Recovery time varies (typically 5-30 seconds)
- Dashboard should show "restarting" state and wait for reconnection
- Recommended: Stagger restarts to avoid network congestion during boot

**Batch UI Suggestion:** 
- Single "Restart All Selected" button
- Optional "Staggered restart" checkbox (e.g., 2-second delay between panels)
- Progress indicator showing panels restarting/reconnected

---

### 2. **Backlight Control** ⭐ High Priority
**Command:** `backlight` (WebSocket: `{ "command": "backlight", "state": true|false }`)

**Use Case:** Turn status LEDs on/off across all panels for:
- Night mode (disable all panel lights at bedtime)
- Energy saving
- Uniform appearance in public spaces

**Batch UI Suggestion:**
- Two buttons: "Turn On All Backlights" / "Turn Off All Backlights"
- Or a toggle switch with "Backlight" label

---

### 3. **Lock/Unlock Buttons** ⭐ High Priority
**Command:** `lock_buttons` (WebSocket: `{ "command": "lock_buttons", "state": true|false }`)

**Use Case:** Prevent physical button presses on panels:
- Child safety (disable buttons in certain rooms)
- Maintenance mode (prevent accidental activations)
- Guest mode (restrict control to app only)
- Event mode (lock panels during presentations)

**Batch UI Suggestion:**
- Two buttons: "Lock All Panels" / "Unlock All Panels"
- Or a toggle switch with "Button Lock" label

---


### 4. **Scenes All Off** (Built-in Scene)
**Command:** `all_off` (WebSocket: `{ "command": "all_off" }`, HTTP: `GET /alloff`)

**Use Case:** Trigger the built-in "All Off" scene on all selected panels.

**Note:** This is the panel's built-in scene command. The exact behavior depends on how the panel's scenes are configured.

**Batch UI Suggestion:**
- Red "All Off" button under "Scenes" group with confirmation dialog

---

### 5. **Smart Toggle** (Scene)
**Command:** `toggle_all` (WebSocket: `{ "command": "toggle_all" }`, HTTP: `GET /toggleall`)

**Behavior:** 
- If **ANY** relay is ON → turns ALL relays OFF
- Only if **ALL** relays are OFF → turns ALL relays ON

**Use Case:** Quick way to turn everything off (or on if already off).

**Batch UI Suggestion:**
- "Smart Toggle" button with tooltip explaining the behavior

---

## Virtual Operations (Aggregated)

These operations are implemented by our dashboard, sending multiple individual commands to achieve the desired result. They appear in a separate "Virtual Operations" section in the UI.

### V1. **All Lights On**
**Implementation:** Sends `set_relay` with `state: true` to each configured relay on each panel.

**Use Case:** Turn on all lights across all selected panels.

**Considerations:**
- Only affects "configured" relays (those with custom names, not generic "Relay N")
- Sends one command per relay per panel (may take longer than direct operations)
- Panels with no configured relays are marked as success immediately

---

### V2. **All Lights Off**
**Implementation:** Sends `set_relay` with `state: false` to each configured relay on each panel.

**Use Case:** Turn off all lights across all selected panels.

**Considerations:**
- Same as "All Lights On" but turns lights off
- More predictable than "Scenes All Off" since it explicitly targets configured relays

---

## Direct vs Virtual Operations

| Type | Description | Example |
|------|-------------|---------|
| **Direct** | Single command sent to panel's native API | Restart, Backlight On/Off |
| **Virtual** | Our implementation using multiple commands | All Lights On/Off |

Direct operations are faster and more reliable. Virtual operations provide functionality not available natively.

---

### 6. **Firmware Update Check**
**Command:** `update` (WebSocket: `{ "command": "update" }`)

**Use Case:** Trigger firmware update check on all panels:
- Deploy new firmware version across fleet
- Ensure all panels are up to date

**Considerations:**
- Panels need internet connectivity to update server
- Update process may take several minutes per panel
- Panels restart automatically after update
- May want to update in batches to maintain some operational capacity

**Batch UI Suggestion:**
- "Check for Updates" button
- Show current version vs latest version for each panel
- Optional: "Update All Outdated" button
- Progress tracking per panel

---

### 7. **Request State** (Diagnostic)
**Command:** `request_state` (WebSocket: `{ "command": "request_state" }`)

**Use Case:** Force state refresh from all panels:
- Sync UI after network issues
- Diagnostic/debugging
- Verify all panels are responsive

**Batch UI Suggestion:**
- "Refresh All States" button
- Useful for diagnostics, can be in a secondary toolbar

---

## Operations NOT Suitable for Batch

The following operations are **panel-specific** and should NOT be batch-invoked without careful consideration:

### ❌ Relay Control (`set_relay`, `toggle_relay`)
**Reason:** Different panels control different devices. Turning on "relay 0" on all panels would affect completely different devices (living room light vs bedroom fan vs garage door).

**Exception:** Could be useful if panels are grouped by identical configuration (e.g., all hallway lighting panels).

### ❌ Curtain Control (`curtain`)
**Reason:** Similar to relays - different panels control different curtains. Batch opening all curtains may be undesired (privacy, security).

**Exception:** Time-based routines (e.g., open all curtains at sunrise).

### ❌ Scene Activation (`scene_activate`)
**Reason:** Scenes are configured per-panel with different meanings. "Scene 1" on Panel A might be "Movie Mode" while "Scene 1" on Panel B is "Party Mode".

**Exception:** If scenes are standardized across panels with same index = same purpose.

### ❌ Device Labeling (`POST /api/device-label`)
**Reason:** Labels are unique to each device/panel.

---

## Implementation Architecture

### Backend API: Batch Command Endpoint

The existing `/api/panels/command` endpoint already supports batch operations:

```typescript
// Current API supports:
POST /api/panels/command
{
  "ips": ["10.88.99.201", "10.88.99.202"],  // or "*" for all
  "command": "restart"
}
```

### Suggested Batch Operations UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  BATCH OPERATIONS                                    [X panels] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ 💡 Backlight │  │ 🔒 Button    │  │ ⚡ Power               │ │
│  │   Control   │  │   Lock      │  │                         │ │
│  │             │  │             │  │ [   All Off   ]        │ │
│  │ [On] [Off]  │  │ [Lock][Unlk]│  │                         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  🔄 Maintenance                                              ││
│  │  [ Restart Selected Panels ]   [ Check for Updates ]        ││
│  │  □ Staggered restart (2s delay)                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Selected Panels (5)                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [☑] 10.88.99.201  │ Living Room Panel  │ 2.1.5  │ ● LIVE │  │
│  │ [☑] 10.88.99.203  │ Bedroom Panel      │ 2.1.4  │ ● LIVE │  │
│  │ [☑] 10.88.99.205  │ Kitchen Panel      │ 2.1.5  │ ● LIVE │  │
│  │ ...                                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Priority Roadmap

### Phase 1 (MVP)
1. ✅ Selection checkboxes in panel list
2. ✅ Batch Operations page with selected panels table
3. Backlight on/off controls
4. Button lock/unlock controls
5. Restart functionality

### Phase 2
6. All Off emergency button (with confirmation)
7. Firmware update check
8. Staggered restart option

### Phase 3
9. Saved batch groups (e.g., "All Bedroom Panels")
10. Scheduled batch operations
11. Batch operation history/logging

---

## Safety Considerations

1. **Confirmation Dialogs:** Destructive operations (restart, all off) should require confirmation
2. **Rate Limiting:** Avoid sending too many commands simultaneously (panels may not handle flood)
3. **Staggered Execution:** For restarts/updates, stagger to maintain partial operation
4. **Rollback:** Consider undo functionality for backlight/lock changes
5. **Audit Log:** Log all batch operations with timestamp and affected panels

---

## WebSocket Command Reference (Batch-Suitable)

| Command | Payload | Description |
|---------|---------|-------------|
| `restart` | `{}` | Restart the panel |
| `backlight` | `{ state: boolean }` | Control status LED |
| `lock_buttons` | `{ state: boolean }` | Lock/unlock physical buttons |
| `all_off` | `{}` | Turn off all relays |
| `toggle_all` | `{}` | Toggle all relay states |
| `update` | `{}` | Check for firmware update |
| `request_state` | `{}` | Request full state snapshot |


