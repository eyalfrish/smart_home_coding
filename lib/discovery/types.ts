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

/** Panel settings scraped from /settings page */
export interface PanelSettings {
  logging?: boolean;
  longPressMs?: number;
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

