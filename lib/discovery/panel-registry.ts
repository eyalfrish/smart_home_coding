import { CubixxClient, isWebSocketAvailable } from "./cubixx-client";
import type {
  PanelConnectionStatus,
  LivePanelState,
  SSEMessage,
  SSEEventType,
  PanelCommand,
  RelayState,
  CurtainState,
  ContactState,
} from "./types";

type SSEListener = (message: SSEMessage) => void;

/**
 * Global registry for managing WebSocket connections to multiple Cubixx panels.
 * This is a singleton that maintains persistent connections and notifies
 * SSE listeners of state changes.
 */
class PanelRegistryImpl {
  private clients: Map<string, CubixxClient> = new Map();
  private states: Map<string, LivePanelState> = new Map();
  private listeners: Set<SSEListener> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start heartbeat to keep SSE connections alive
    this.startHeartbeat();
  }

  /** Add an SSE listener */
  addListener(listener: SSEListener): void {
    this.listeners.add(listener);

    // Immediately send current state of ALL panels (including connecting ones)
    // This allows UI to show progress while panels are still connecting
    const connectedCount = Array.from(this.states.values())
      .filter(s => s.connectionStatus === "connected" && s.fullState).length;
    console.log(`[Registry] New listener added. ${connectedCount}/${this.states.size} panels already connected`);
    
    Array.from(this.states.entries()).forEach(([ip, state]) => {
      listener({
        type: "panel_state",
        ip,
        timestamp: Date.now(),
        data: state,
      });
    });
  }

  /** Remove an SSE listener */
  removeListener(listener: SSEListener): void {
    this.listeners.delete(listener);
  }

  /** Get the number of active listeners */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /** Connect to a panel */
  connectPanel(ip: string): void {
    if (this.clients.has(ip)) {
      // Already connected or connecting
      return;
    }

    console.log(`[Registry] Connecting to panel: ${ip}`);

    // Initialize state
    const state: LivePanelState = {
      ip,
      connectionStatus: "connecting",
    };
    this.states.set(ip, state);

    // Create client
    const client = new CubixxClient(
      ip,
      (event, data) => this.handleMessage(ip, event, data),
      (status, error) => this.handleStatusChange(ip, status, error)
    );

    this.clients.set(ip, client);
    client.connect();
  }

  /** Disconnect from a panel */
  disconnectPanel(ip: string): void {
    const client = this.clients.get(ip);
    if (client) {
      console.log(`[Registry] Disconnecting from panel: ${ip}`);
      client.disconnect();
      this.clients.delete(ip);
      this.states.delete(ip);

      this.broadcast({
        type: "panel_disconnected",
        ip,
        timestamp: Date.now(),
      });
    }
  }

  /** Connect to multiple panels */
  connectPanels(ips: string[]): void {
    for (const ip of ips) {
      this.connectPanel(ip);
    }
  }

  /** Disconnect from all panels */
  disconnectAllPanels(): void {
    const ips = Array.from(this.clients.keys());
    for (const ip of ips) {
      this.disconnectPanel(ip);
    }
  }

  /** Check if WebSocket support is available */
  isWebSocketAvailable(): boolean {
    return isWebSocketAvailable();
  }

  /** Get connection status for a panel */
  getPanelState(ip: string): LivePanelState | undefined {
    return this.states.get(ip);
  }

  /** Get all panel states */
  getAllPanelStates(): LivePanelState[] {
    return Array.from(this.states.values());
  }

  /** Get list of connected panel IPs */
  getConnectedPanelIps(): string[] {
    return Array.from(this.states.entries())
      .filter(([, state]) => state.connectionStatus === "connected")
      .map(([ip]) => ip);
  }

  /** Send a command to a specific panel */
  sendCommand(ip: string, command: PanelCommand): boolean {
    const client = this.clients.get(ip);
    if (!client) {
      console.warn(`[Registry] No client for panel: ${ip}`);
      return false;
    }
    return client.sendCommand(command);
  }

  /** Send a command to multiple panels */
  sendCommandToMany(ips: string[], command: PanelCommand): Map<string, boolean> {
    const results = new Map<string, boolean>();
    for (const ip of ips) {
      results.set(ip, this.sendCommand(ip, command));
    }
    return results;
  }

  /** Send a command to all connected panels */
  broadcastCommand(command: PanelCommand): Map<string, boolean> {
    return this.sendCommandToMany(this.getConnectedPanelIps(), command);
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private handleMessage(ip: string, event: string, data: unknown): void {
    const state = this.states.get(ip);
    if (!state) return;

    state.lastUpdated = Date.now();

    switch (event) {
      case "full_state":
        state.fullState = data as LivePanelState["fullState"];
        this.broadcast({
          type: "panel_state",
          ip,
          timestamp: Date.now(),
          data: state,
        });
        break;

      case "relay_update":
        this.broadcast({
          type: "relay_update",
          ip,
          timestamp: Date.now(),
          data: data as RelayState,
        });
        break;

      case "curtain_update":
        this.broadcast({
          type: "curtain_update",
          ip,
          timestamp: Date.now(),
          data: data as CurtainState,
        });
        break;

      case "contact_update":
        this.broadcast({
          type: "contact_update",
          ip,
          timestamp: Date.now(),
          data: data as ContactState,
        });
        break;

      case "backlight_update":
        // Broadcast updated full state so UI reflects the change
        this.broadcast({
          type: "panel_state",
          ip,
          timestamp: Date.now(),
          data: state,
        });
        break;

      // Other events can be handled here as needed
    }
  }

  private handleStatusChange(
    ip: string,
    status: PanelConnectionStatus,
    error?: string
  ): void {
    const state = this.states.get(ip);
    if (!state) return;

    state.connectionStatus = status;
    if (error) {
      state.lastError = error;
    }

    if (status === "connected") {
      state.lastConnected = Date.now();
      this.broadcast({
        type: "panel_connected",
        ip,
        timestamp: Date.now(),
      });
    } else if (status === "disconnected") {
      this.broadcast({
        type: "panel_disconnected",
        ip,
        timestamp: Date.now(),
      });
    } else if (status === "error") {
      this.broadcast({
        type: "panel_error",
        ip,
        timestamp: Date.now(),
        data: { lastError: error } as Partial<LivePanelState>,
      });
    }
  }

  private broadcast(message: SSEMessage): void {
    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        console.error("[Registry] Error in listener:", error);
      }
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    // Send heartbeat every 15 seconds to keep SSE connections alive
    this.heartbeatTimer = setInterval(() => {
      if (this.listeners.size > 0) {
        this.broadcast({
          type: "heartbeat",
          ip: "",
          timestamp: Date.now(),
        });
      }
    }, 15000);
  }

  /** Cleanup - call when shutting down */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.disconnectAllPanels();
    this.listeners.clear();
  }
}

// Use globalThis to ensure the singleton persists across Next.js API routes
// This is necessary because Next.js may create separate module instances for each route
const REGISTRY_KEY = Symbol.for("smart_home_panel_registry");

interface GlobalWithRegistry {
  [REGISTRY_KEY]?: PanelRegistryImpl;
}

/** Get the global panel registry instance */
export function getPanelRegistry(): PanelRegistryImpl {
  const globalObj = globalThis as GlobalWithRegistry;
  if (!globalObj[REGISTRY_KEY]) {
    console.log("[Registry] Creating new global panel registry instance");
    globalObj[REGISTRY_KEY] = new PanelRegistryImpl();
  }
  return globalObj[REGISTRY_KEY];
}

// Export type for use elsewhere
export type PanelRegistry = PanelRegistryImpl;

