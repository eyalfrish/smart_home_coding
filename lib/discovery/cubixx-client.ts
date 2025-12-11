import type {
  PanelConnectionStatus,
  PanelFullState,
  RelayState,
  CurtainState,
  ContactState,
  PanelCommand,
} from "./types";

// WebSocket type for Node.js ws package
interface WSWebSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  terminate(): void;
  ping(): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface WSConstructor {
  new (url: string): WSWebSocket;
  readonly OPEN: number;
}

// Try to load ws package, but gracefully handle if not available
let WebSocket: WSConstructor | null = null;
let wsAvailable = false;

try {
  WebSocket = require("ws");
  wsAvailable = true;
  console.log("[CubixxClient] ws package loaded successfully");
} catch (e) {
  console.warn("[CubixxClient] ws package not available - WebSocket connections disabled");
  console.warn("[CubixxClient] Run: npm install ws @types/ws --save");
}

/** Check if WebSocket support is available */
export function isWebSocketAvailable(): boolean {
  return wsAvailable;
}

const WS_PORT = 81;
const RECONNECT_DELAY_MS = 1000;   // Reduced from 2000ms
const CONNECTION_TIMEOUT_MS = 3000; // Reduced from 5000ms
const PING_INTERVAL_MS = 30000;

type MessageHandler = (event: string, data: unknown) => void;
type StatusHandler = (status: PanelConnectionStatus, error?: string) => void;

/**
 * WebSocket client for a single Cubixx panel.
 * Handles connection, reconnection, and message parsing.
 */
export class CubixxClient {
  readonly ip: string;
  private ws: WSWebSocket | null = null;
  private status: PanelConnectionStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private fullState: PanelFullState | null = null;
  private lastError: string | null = null;
  private shouldReconnect = false;

  private onMessage: MessageHandler;
  private onStatusChange: StatusHandler;

  constructor(
    ip: string,
    onMessage: MessageHandler,
    onStatusChange: StatusHandler
  ) {
    this.ip = ip;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
  }

  /** Current connection status */
  getStatus(): PanelConnectionStatus {
    return this.status;
  }

  /** Last known full state */
  getFullState(): PanelFullState | null {
    return this.fullState;
  }

  /** Last error message */
  getLastError(): string | null {
    return this.lastError;
  }

  /** Connect to the panel's WebSocket */
  connect(): void {
    if (!wsAvailable || !WebSocket) {
      console.warn(`[${this.ip}] Cannot connect - ws package not installed`);
      this.lastError = "WebSocket package (ws) not installed. Run: npm install ws --save";
      this.setStatus("error", this.lastError);
      return;
    }

    if (this.ws) {
      return;
    }

    this.shouldReconnect = true;
    this.doConnect();
  }

  /** Disconnect from the panel */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearTimers();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.setStatus("disconnected");
  }

  /** Send a command to the panel */
  sendCommand(command: PanelCommand): boolean {
    if (!WebSocket || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(command));
      return true;
    } catch (error) {
      console.error(`[${this.ip}] Failed to send command:`, error);
      return false;
    }
  }

  /** Request full state from the panel */
  requestState(): boolean {
    return this.sendCommand({ command: "request_state" });
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private doConnect(): void {
    if (this.ws || !WebSocket) {
      return;
    }

    this.setStatus("connecting");
    const url = `ws://${this.ip}:${WS_PORT}/`;

    try {
      this.ws = new WebSocket(url);

      // Set connection timeout
      this.connectionTimer = setTimeout(() => {
        if (this.status === "connecting") {
          console.log(`[${this.ip}] Connection timed out`);
          this.handleError("Connection timed out");
          this.ws?.terminate();
          this.ws = null;
          this.scheduleReconnect();
        }
      }, CONNECTION_TIMEOUT_MS);

      this.ws.on("open", () => {
        this.clearConnectionTimeout();
        console.log(`[${this.ip}] WebSocket connected`);
        this.setStatus("connected");
        this.lastError = null;

        // Request initial state
        this.requestState();

        // Start ping interval to keep connection alive
        this.startPingInterval();
      });

      this.ws.on("message", (data: Buffer) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        console.log(
          `[${this.ip}] WebSocket closed: code=${code}, reason=${reason.toString()}`
        );
        this.clearTimers();
        this.ws = null;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      });

      this.ws.on("error", (error: Error) => {
        console.error(`[${this.ip}] WebSocket error:`, error.message);
        this.handleError(error.message);
      });
    } catch (error) {
      console.error(`[${this.ip}] Failed to create WebSocket:`, error);
      this.handleError((error as Error).message);
      this.scheduleReconnect();
    }
  }

  private handleMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw);
      const event = parsed.event as string | undefined;

      if (!event) {
        console.warn(`[${this.ip}] Message without event field:`, raw);
        return;
      }

      // Process known events
      switch (event) {
        case "full_state":
          this.fullState = this.parseFullState(parsed);
          this.onMessage("full_state", this.fullState);
          break;

        case "relay_update":
          this.handleRelayUpdate(parsed);
          break;

        case "curtain_update":
          this.handleCurtainUpdate(parsed);
          break;

        case "contact_update":
          this.handleContactUpdate(parsed);
          break;

        case "backlight_update":
          if (this.fullState && parsed.backlight?.state !== undefined) {
            this.fullState.statusLedOn = parsed.backlight.state;
            this.onMessage("backlight_update", { state: parsed.backlight.state });
          }
          break;

        case "scene_status":
          this.onMessage("scene_status", {
            name: parsed.name,
            status: parsed.status,
          });
          break;

        case "network_status":
          if (this.fullState) {
            this.fullState.wifiConnected = parsed.connected;
            this.fullState.ip = parsed.ip;
          }
          this.onMessage("network_status", parsed);
          break;

        case "ack":
        case "error":
        case "config_saved":
        case "device_label":
        case "device_label_update":
          this.onMessage(event, parsed);
          break;

        default:
          console.log(`[${this.ip}] Unknown event: ${event}`, parsed);
          this.onMessage(event, parsed);
      }
    } catch (error) {
      console.warn(`[${this.ip}] Failed to parse message:`, raw, error);
    }
  }

  private parseFullState(data: Record<string, unknown>): PanelFullState {
    const relays = (data.relays as Array<Record<string, unknown>>) ?? [];
    const curtains = (data.curtains as Array<Record<string, unknown>>) ?? [];
    const contacts = (data.contacts as Array<Record<string, unknown>>) ?? [];

    return {
      // Network
      wifiConnected: data.wifiConnected as boolean | undefined,
      ssid: data.ssid as string | undefined,
      ip: data.ip as string | undefined,
      wifiQuality: data.wifiQuality as number | undefined,

      // MQTT
      mqttConnected: data.mqttConnected as boolean | undefined,
      mqttDeviceName: data.mqttDeviceName as string | undefined,
      mqttServer: data.mqttServer as string | undefined,

      // Sync
      syncEnabled: data.syncEnabled as boolean | undefined,
      syncIp: data.syncIp as string | undefined,
      syncPort: data.syncPort as number | undefined,

      // Panel
      buttonsLocked: data.buttonsLocked as boolean | undefined,
      statusLedOn: data.statusLedOn as boolean | undefined,

      // Scene
      sceneIsExecuting: data.sceneIsExecuting as boolean | undefined,
      sceneName: data.sceneName as string | undefined,
      activeSceneIndex: data.activeSceneIndex as number | undefined,

      // Time
      localTime: data.localTime as string | undefined,
      localEpoch: data.localEpoch as number | undefined,
      timeZone: data.timeZone as string | undefined,
      timeSyncStatus: data.timeSyncStatus as string | undefined,

      // Device
      uptimeMs: data.uptimeMs as number | undefined,
      version: data.version as string | undefined,
      hostname: data.hostname as string | undefined,
      deviceId: data.deviceId as string | undefined,

      // Entities
      relays: relays.map((r) => ({
        index: r.index as number,
        state: Boolean(r.state),
        name: r.name as string | undefined,
      })),
      curtains: curtains.map((c) => ({
        index: c.index as number,
        state: this.parseCurtainState(c.state),
        name: c.name as string | undefined,
      })),
      contacts: contacts.map((c) => ({
        index: c.index as number,
        state: this.parseContactState(c.state),
        name: c.name as string | undefined,
      })),
    };
  }

  private parseCurtainState(
    state: unknown
  ): CurtainState["state"] {
    if (typeof state === "string") {
      const lower = state.toLowerCase();
      if (lower.includes("opening")) return "opening";
      if (lower.includes("closing")) return "closing";
      if (lower.includes("open")) return "open";
      if (lower.includes("closed") || lower.includes("close")) return "closed";
      if (lower.includes("stopped") || lower.includes("stop")) return "stopped";
    }
    return "unknown";
  }

  private parseContactState(state: unknown): ContactState["state"] {
    if (typeof state === "string") {
      const lower = state.toLowerCase();
      if (lower.includes("open")) return "open";
      if (lower.includes("closed") || lower.includes("close")) return "closed";
    }
    if (typeof state === "boolean") {
      return state ? "open" : "closed";
    }
    return "unknown";
  }

  private handleRelayUpdate(data: Record<string, unknown>): void {
    // The relay update can come in different formats
    const relay = data.relay as Record<string, unknown> | undefined;
    const device = data.device as Record<string, unknown> | undefined;

    if (relay) {
      const update: RelayState = {
        index: relay.index as number,
        state: Boolean(relay.state),
        name: relay.name as string | undefined,
      };

      if (this.fullState && this.fullState.relays) {
        const existing = this.fullState.relays.find(
          (r) => r.index === update.index
        );
        if (existing) {
          existing.state = update.state;
          if (update.name) existing.name = update.name;
        }
      }

      this.onMessage("relay_update", update);
    } else if (device) {
      // Handle device map format
      for (const [key, value] of Object.entries(device)) {
        const index = parseInt(key, 10);
        if (!isNaN(index) && this.fullState?.relays) {
          const existing = this.fullState.relays.find((r) => r.index === index);
          if (existing) {
            existing.state = Boolean(value);
            this.onMessage("relay_update", {
              index,
              state: Boolean(value),
            } as RelayState);
          }
        }
      }
    }
  }

  private handleCurtainUpdate(data: Record<string, unknown>): void {
    const curtain = data.curtain as Record<string, unknown> | undefined;
    if (!curtain) return;

    const update: CurtainState = {
      index: curtain.index as number,
      state: this.parseCurtainState(curtain.state),
      name: curtain.name as string | undefined,
    };

    if (this.fullState && this.fullState.curtains) {
      const existing = this.fullState.curtains.find(
        (c) => c.index === update.index
      );
      if (existing) {
        existing.state = update.state;
        if (update.name) existing.name = update.name;
      }
    }

    this.onMessage("curtain_update", update);
  }

  private handleContactUpdate(data: Record<string, unknown>): void {
    const contact = data.contact as Record<string, unknown> | undefined;
    if (!contact) return;

    const update: ContactState = {
      index: contact.index as number,
      state: this.parseContactState(contact.state),
      name: contact.name as string | undefined,
    };

    if (this.fullState && this.fullState.contacts) {
      const existing = this.fullState.contacts.find(
        (c) => c.index === update.index
      );
      if (existing) {
        existing.state = update.state;
        if (update.name) existing.name = update.name;
      }
    }

    this.onMessage("contact_update", update);
  }

  private handleError(message: string): void {
    this.lastError = message;
    this.setStatus("error", message);
  }

  private setStatus(status: PanelConnectionStatus, error?: string): void {
    if (this.status !== status) {
      this.status = status;
      this.onStatusChange(status, error);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    console.log(`[${this.ip}] Scheduling reconnect in ${RECONNECT_DELAY_MS}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.doConnect();
      }
    }, RECONNECT_DELAY_MS);
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingTimer = setInterval(() => {
      if (WebSocket && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {
          // Ignore ping errors
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearConnectionTimeout();
    this.stopPingInterval();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

