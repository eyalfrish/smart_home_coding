export type DiscoveryStatus =
  | "panel"
  | "not-panel"
  | "no-response"
  | "error"
  | "pending"    // Discovery in progress for this IP
  | "initial";   // Not yet started (UI placeholder)

export interface DiscoveryRequest {
  baseIp: string;
  start: number;
  end: number;
}

// ============================================================================
// Relay Configuration (parsed from /settings page)
// ============================================================================

/** Pair mode for a relay pair (from settings page) */
export type RelayPairMode = "normal" | "curtain" | "venetian" | "linked";

/** Individual relay mode when pair is in Normal mode */
export type RelayMode = "switch" | "momentary" | "disabled";

/** Configuration for a relay pair (2 relays) */
export interface RelayPairConfig {
  /** Pair index (0=relays 1&2, 1=relays 3&4, 2=relays 5&6) */
  pairIndex: number;
  /** The pair mode: normal, curtain, or venetian */
  pairMode: RelayPairMode;
  /** Individual relay modes (only relevant when pairMode is "normal") */
  relayModes: [RelayMode, RelayMode];
}

/**
 * Computed device type for a relay/curtain based on settings.
 * This is the "source of truth" for how to display a device.
 */
export type DeviceType = 
  | "light"      // Normal -> Switch (with real name)
  | "momentary"  // Normal -> Momentary (door locks, etc.)
  | "curtain"    // Curtain pair mode
  | "venetian"   // Venetian pair mode
  | "hidden";    // Disabled or generic "Relay N" name

/** Panel settings scraped from /settings page */
export interface PanelSettings {
  logging?: boolean;
  longPressMs?: number;
  /** Relay pair configurations (3 pairs for 6 relays) */
  relayPairs?: RelayPairConfig[];
}

export interface DiscoveryResult {
  ip: string;
  status: DiscoveryStatus;
  httpStatus?: number;
  errorMessage?: string;
  name?: string | null;
  panelHtml?: string;
  settings?: PanelSettings;
  /** Time taken to discover this IP in milliseconds */
  discoveryTimeMs?: number;
}

export interface DiscoverySummary {
  baseIp: string;
  start: number;
  end: number;
  totalChecked: number;
  panelsFound: number;
  notPanels: number;
  noResponse: number;
  errors: number;
}

export interface DiscoveryResponse {
  summary: DiscoverySummary;
  results: DiscoveryResult[];
}

export interface PanelInfo {
  ip: string;
  isCubixx: boolean;
  name?: string;
  link?: string;
  baselineFingerprint?: string | null;
  lastFingerprint?: string | null;
  touched?: boolean;
}

// ============================================================================
// WebSocket / Real-time types
// ============================================================================

/** Connection status for a panel's WebSocket */
export type PanelConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** State of a single relay */
export interface RelayState {
  index: number;
  state: boolean;
  name?: string;
}

/** State of a single curtain */
export interface CurtainState {
  index: number;
  state: "open" | "closed" | "opening" | "closing" | "stopped" | "unknown";
  name?: string;
}

/** State of a contact input */
export interface ContactState {
  index: number;
  state: "open" | "closed" | "unknown";
  name?: string;
}

/** Full state of a panel as received from WebSocket */
export interface PanelFullState {
  // Network info
  wifiConnected?: boolean;
  ssid?: string;
  ip?: string;
  wifiQuality?: number;

  // MQTT info
  mqttConnected?: boolean;
  mqttDeviceName?: string;
  mqttServer?: string;

  // Sync info
  syncEnabled?: boolean;
  syncIp?: string;
  syncPort?: number;

  // Panel state
  buttonsLocked?: boolean;
  statusLedOn?: boolean;

  // Scene info
  sceneIsExecuting?: boolean;
  sceneName?: string;
  activeSceneIndex?: number;

  // Time info
  localTime?: string;
  localEpoch?: number;
  timeZone?: string;
  timeSyncStatus?: string;

  // Device info
  uptimeMs?: number;
  version?: string;
  hostname?: string;
  deviceId?: string;

  // Entities
  relays: RelayState[];
  curtains: CurtainState[];
  contacts?: ContactState[];
}

/** Live panel state maintained by the registry */
export interface LivePanelState {
  ip: string;
  connectionStatus: PanelConnectionStatus;
  lastConnected?: number;
  lastError?: string;
  fullState?: PanelFullState;
  lastUpdated?: number;
}

/** SSE event types sent to the frontend */
export type SSEEventType =
  | "panel_connected"
  | "panel_disconnected"
  | "panel_state"
  | "panel_error"
  | "relay_update"
  | "curtain_update"
  | "contact_update"
  | "heartbeat";

/** SSE message payload */
export interface SSEMessage {
  type: SSEEventType;
  ip: string;
  timestamp: number;
  data?: Partial<LivePanelState> | RelayState | CurtainState | ContactState;
}

/** Command types that can be sent to panels */
export type PanelCommandType =
  | "request_state"
  | "set_relay"
  | "toggle_relay"
  | "toggle_all"
  | "curtain"
  | "scene_activate"
  | "all_off"
  | "backlight"
  | "lock_buttons"
  | "restart"
  | "update";

/** Command payload for sending to panels */
export interface PanelCommand {
  command: PanelCommandType;
  index?: number;
  state?: boolean;
  action?: "open" | "close" | "stop";
}

// ============================================================================
// Device Classification Utilities
// ============================================================================

/**
 * Determine the device type for a relay based on settings configuration.
 * 
 * Classification rules:
 * - Curtain pair mode → "curtain"
 * - Venetian pair mode → "venetian"  
 * - Normal + Switch (with real name) → "light"
 * - Normal + Momentary → "momentary" (door locks, etc.)
 * - Normal + Disabled → "hidden"
 * - Normal + Switch (with generic "Relay N" name) → "hidden"
 * 
 * @param relayIndex 0-based relay index (0-5)
 * @param relayName The relay name from WebSocket state
 * @param relayPairs Relay pair configuration from settings (may be undefined for older panels)
 * @param skipLinkHiding If true, don't hide Link-suffixed relays (used for Link column display)
 */
export function getRelayDeviceType(
  relayIndex: number,
  relayName: string | undefined,
  relayPairs: RelayPairConfig[] | undefined,
  skipLinkHiding: boolean = false
): DeviceType {
  // If no settings available, fall back to name-based detection (legacy behavior)
  if (!relayPairs || relayPairs.length === 0) {
    return getRelayDeviceTypeLegacy(relayName, skipLinkHiding);
  }
  
  // Find the pair for this relay (pair 0 = relays 0,1; pair 1 = relays 2,3; pair 2 = relays 4,5)
  const pairIndex = Math.floor(relayIndex / 2);
  const relayInPair = relayIndex % 2; // 0 = first relay, 1 = second relay
  
  const pairConfig = relayPairs.find(p => p.pairIndex === pairIndex);
  if (!pairConfig) {
    // Pair not found in config, use legacy detection
    return getRelayDeviceTypeLegacy(relayName, skipLinkHiding);
  }
  
  // For Curtain/Venetian/Linked modes, relays are used together - they shouldn't appear as individual relays
  // The WebSocket will report them as curtains instead (for curtain/venetian)
  if (pairConfig.pairMode === "curtain") {
    return "hidden"; // Individual relay hidden; shown as curtain entity
  }
  if (pairConfig.pairMode === "venetian") {
    return "hidden"; // Individual relay hidden; shown as venetian entity
  }
  if (pairConfig.pairMode === "linked") {
    return "hidden"; // Linked relays operate as a pair; hide from individual selection
  }
  
  // Normal mode - check individual relay mode
  const relayMode = pairConfig.relayModes[relayInPair];
  
  if (relayMode === "disabled") {
    return "hidden";
  }
  
  if (relayMode === "momentary") {
    return "momentary";
  }
  
  // Switch mode - but still hide if generic name or linked relay
  if (relayMode === "switch") {
    if (!relayName || relayName.trim() === "") return "hidden";
    if (/^Relay\s+\d+$/i.test(relayName.trim())) return "hidden";
    // Hide linked relays (names ending with "-Link", "_Link", etc.) - unless skipLinkHiding is true
    if (/[-_–—]Link$/i.test(relayName.trim()) && !skipLinkHiding) return "hidden";
    return "light";
  }
  
  return "hidden";
}

/**
 * Determine the device type for a curtain based on settings configuration.
 * 
 * @param curtainIndex 0-based curtain index (corresponds to pair index)
 * @param curtainName The curtain name from WebSocket state
 * @param relayPairs Relay pair configuration from settings
 */
export function getCurtainDeviceType(
  curtainIndex: number,
  curtainName: string | undefined,
  relayPairs: RelayPairConfig[] | undefined
): DeviceType {
  // If no settings available, fall back to checking if it's configured
  if (!relayPairs || relayPairs.length === 0) {
    return getCurtainDeviceTypeLegacy(curtainName);
  }
  
  // Curtain index corresponds to pair index
  const pairConfig = relayPairs.find(p => p.pairIndex === curtainIndex);
  if (!pairConfig) {
    return getCurtainDeviceTypeLegacy(curtainName);
  }
  
  // Only show curtains when pair is in curtain or venetian mode
  // When we have settings confirmation, trust it - don't hide based on generic names
  // (The settings prove it's a configured curtain/venetian device)
  if (pairConfig.pairMode === "curtain") {
    return "curtain";
  }
  
  if (pairConfig.pairMode === "venetian") {
    return "venetian";
  }
  
  // Pair is in normal mode - curtain shouldn't be shown
  return "hidden";
}

/**
 * Legacy name-based detection for relays (fallback when settings unavailable).
 * @param skipLinkHiding If true, don't hide Link-suffixed relays (used for Link column display)
 */
function getRelayDeviceTypeLegacy(relayName: string | undefined, skipLinkHiding: boolean = false): DeviceType {
  if (!relayName || relayName.trim() === "") return "hidden";
  if (/^Relay\s+\d+$/i.test(relayName.trim())) return "hidden";
  // Hide linked relays (names ending with "-Link", "_Link", etc.) - unless skipLinkHiding is true
  if (/[-_–—]Link$/i.test(relayName.trim()) && !skipLinkHiding) return "hidden";
  
  // Check for door lock indicators
  const name = relayName.toLowerCase();
  if (name.includes("lock") || name.includes("unlock")) {
    return "momentary";
  }
  
  return "light";
}

/**
 * Legacy name-based detection for curtains (fallback when settings unavailable).
 */
function getCurtainDeviceTypeLegacy(curtainName: string | undefined): DeviceType {
  if (!curtainName || curtainName.trim() === "") return "hidden";
  if (/^Curtain\s+\d+$/i.test(curtainName.trim())) return "hidden";
  return "curtain"; // Legacy: all configured curtains are just "curtain" type
}

