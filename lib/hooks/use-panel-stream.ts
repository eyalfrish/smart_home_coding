"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import type {
  SSEMessage,
  LivePanelState,
  RelayState,
  CurtainState,
  ContactState,
} from "@/lib/discovery/types";

interface UsePanelStreamOptions {
  /** Panel IPs to connect to */
  ips: string[];
  /** Callback when a panel's full state is received */
  onPanelState?: (ip: string, state: LivePanelState) => void;
  /** Callback when a relay update is received */
  onRelayUpdate?: (ip: string, relay: RelayState) => void;
  /** Callback when a curtain update is received */
  onCurtainUpdate?: (ip: string, curtain: CurtainState) => void;
  /** Callback when a contact update is received */
  onContactUpdate?: (ip: string, contact: ContactState) => void;
  /** Callback when a panel connects */
  onPanelConnected?: (ip: string) => void;
  /** Callback when a panel disconnects */
  onPanelDisconnected?: (ip: string) => void;
  /** Callback when a panel has an error */
  onPanelError?: (ip: string, error: string) => void;
  /** Whether the stream should be active */
  enabled?: boolean;
}

interface UsePanelStreamReturn {
  /** Whether the SSE connection is active */
  isConnected: boolean;
  /** Current panel states */
  panelStates: Map<string, LivePanelState>;
  /** Last error message */
  error: string | null;
  /** Manually reconnect */
  reconnect: () => void;
  /** Disconnect the stream */
  disconnect: () => void;
}

const RECONNECT_DELAY_MS = 1500;

export function usePanelStream(
  options: UsePanelStreamOptions
): UsePanelStreamReturn {
  const {
    ips,
    onPanelState,
    onRelayUpdate,
    onCurtainUpdate,
    onContactUpdate,
    onPanelConnected,
    onPanelDisconnected,
    onPanelError,
    enabled = true,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelStates, setPanelStates] = useState<Map<string, LivePanelState>>(
    new Map()
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);

  // Store callbacks in refs to avoid dependency issues
  const callbacksRef = useRef({
    onPanelState,
    onRelayUpdate,
    onCurtainUpdate,
    onContactUpdate,
    onPanelConnected,
    onPanelDisconnected,
    onPanelError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onPanelState,
      onRelayUpdate,
      onCurtainUpdate,
      onContactUpdate,
      onPanelConnected,
      onPanelDisconnected,
      onPanelError,
    };
  }, [
    onPanelState,
    onRelayUpdate,
    onCurtainUpdate,
    onContactUpdate,
    onPanelConnected,
    onPanelDisconnected,
    onPanelError,
  ]);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as SSEMessage;
      const { type, ip, data } = message;

      switch (type) {
        case "panel_state":
          if (data && "fullState" in data) {
            const liveState = data as LivePanelState;
            setPanelStates((prev) => {
              const next = new Map(prev);
              next.set(ip, liveState);
              return next;
            });
            callbacksRef.current.onPanelState?.(ip, liveState);
          }
          break;

        case "relay_update":
          if (data && "index" in data && "state" in data) {
            const relay = data as RelayState;
            // Update local state and notify
            setPanelStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(ip);
              if (existing?.fullState?.relays) {
                const relayIndex = existing.fullState.relays.findIndex(
                  (r) => r.index === relay.index
                );
                if (relayIndex >= 0) {
                  existing.fullState.relays[relayIndex] = {
                    ...existing.fullState.relays[relayIndex],
                    ...relay,
                  };
                  existing.lastUpdated = Date.now();
                  // Notify onPanelState so touched detection works
                  callbacksRef.current.onPanelState?.(ip, existing);
                }
              }
              return next;
            });
            callbacksRef.current.onRelayUpdate?.(ip, relay);
          }
          break;

        case "curtain_update":
          if (data && "index" in data) {
            const curtain = data as CurtainState;
            setPanelStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(ip);
              if (existing?.fullState?.curtains) {
                const curtainIndex = existing.fullState.curtains.findIndex(
                  (c) => c.index === curtain.index
                );
                if (curtainIndex >= 0) {
                  existing.fullState.curtains[curtainIndex] = {
                    ...existing.fullState.curtains[curtainIndex],
                    ...curtain,
                  };
                  existing.lastUpdated = Date.now();
                  // Notify onPanelState so touched detection works
                  callbacksRef.current.onPanelState?.(ip, existing);
                }
              }
              return next;
            });
            callbacksRef.current.onCurtainUpdate?.(ip, curtain);
          }
          break;

        case "contact_update":
          if (data && "index" in data) {
            const contact = data as ContactState;
            setPanelStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(ip);
              if (existing?.fullState?.contacts) {
                const contactIndex = existing.fullState.contacts.findIndex(
                  (c) => c.index === contact.index
                );
                if (contactIndex >= 0) {
                  existing.fullState.contacts[contactIndex] = {
                    ...existing.fullState.contacts[contactIndex],
                    ...contact,
                  };
                  existing.lastUpdated = Date.now();
                  // Notify onPanelState so touched detection works
                  callbacksRef.current.onPanelState?.(ip, existing);
                }
              }
              return next;
            });
            callbacksRef.current.onContactUpdate?.(ip, contact);
          }
          break;

        case "panel_connected":
          callbacksRef.current.onPanelConnected?.(ip);
          break;

        case "panel_disconnected":
          setPanelStates((prev) => {
            const next = new Map(prev);
            const existing = next.get(ip);
            if (existing) {
              existing.connectionStatus = "disconnected";
            }
            return next;
          });
          callbacksRef.current.onPanelDisconnected?.(ip);
          break;

        case "panel_error":
          if (data && "lastError" in data) {
            const errorData = data as { lastError?: string };
            callbacksRef.current.onPanelError?.(ip, errorData.lastError ?? "Unknown error");
          }
          break;

        case "heartbeat":
          // Keep-alive, no action needed
          break;
      }
    } catch (e) {
      console.error("[usePanelStream] Failed to parse message:", e);
    }
  }, []);

  const connect = useCallback(() => {
    if (ips.length === 0 || eventSourceRef.current) {
      return;
    }

    const url = `/api/panels/stream?ips=${encodeURIComponent(ips.join(","))}`;
    console.log("[usePanelStream] Connecting to:", url);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[usePanelStream] Connected");
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = handleMessage;

    eventSource.onerror = async (e) => {
      console.error("[usePanelStream] Error:", e);
      setIsConnected(false);
      eventSource.close();
      eventSourceRef.current = null;

      // Try to get more details about the error
      try {
        const response = await fetch(url);
        if (response.status === 503) {
          const data = await response.json();
          setError(data.message || "WebSocket package not installed");
          // Don't reconnect if ws is not installed
          shouldReconnectRef.current = false;
          return;
        }
      } catch {
        // Ignore fetch errors
      }

      setError("Connection lost");

      // Schedule reconnect
      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (shouldReconnectRef.current) {
            connect();
          }
        }, RECONNECT_DELAY_MS);
      }
    };
  }, [ips, handleMessage]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    shouldReconnectRef.current = true;
    connect();
  }, [connect, disconnect]);

  // Track IPs to detect changes
  const ipsKey = ips.join(",");
  const prevIpsKeyRef = useRef<string>("");
  
  // Connect/disconnect based on enabled state and ips
  useEffect(() => {
    const ipsChanged = prevIpsKeyRef.current !== ipsKey;
    
    if (ipsChanged) {
      // IPs changed - disconnect and clear states to start fresh
      if (eventSourceRef.current) {
        console.log("[usePanelStream] IPs changed, reconnecting...");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setPanelStates(new Map());
      prevIpsKeyRef.current = ipsKey;
    }
    
    if (enabled && ips.length > 0) {
      shouldReconnectRef.current = true;
      // Only connect if not already connected (or just disconnected above)
      if (!eventSourceRef.current) {
        connect();
      }
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, ipsKey, connect, disconnect]);

  return {
    isConnected,
    panelStates,
    error,
    reconnect,
    disconnect,
  };
}

