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
  /** Server session ID for validation */
  sessionId?: string | null;
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
const IP_CHANGE_DEBOUNCE_MS = 200; // Debounce rapid IP additions during discovery

export function usePanelStream(
  options: UsePanelStreamOptions
): UsePanelStreamReturn {
  const {
    ips,
    sessionId,
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
  const ipChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIpsRef = useRef<string[]>([]);
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
              // Create a new object to ensure React detects the change
              // (mutating in place can cause stale references after reconnect)
              next.set(ip, {
                ...existing,
                connectionStatus: "disconnected",
              });
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

  // Use ref to always have current IPs without causing reconnects
  const currentIpsRef = useRef<string[]>([]);
  currentIpsRef.current = ips;
  
  const connect = useCallback(() => {
    const currentIps = currentIpsRef.current;
    if (currentIps.length === 0 || eventSourceRef.current || !sessionId) {
      return;
    }

    const url = `/api/panels/stream?ips=${encodeURIComponent(currentIps.join(","))}&session=${encodeURIComponent(sessionId)}`;
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
        if (response.status === 401) {
          // Session expired - server restarted, don't reconnect
          console.log("[usePanelStream] Session expired, not reconnecting");
          shouldReconnectRef.current = false;
          setError("Session expired - server restarted");
          return;
        }
      } catch {
        // Ignore fetch errors
      }

      setError("Connection lost");

      // Schedule reconnect only if allowed
      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (shouldReconnectRef.current) {
            connect();
          }
        }, RECONNECT_DELAY_MS);
      }
    };
  }, [sessionId, handleMessage]); // Removed ips dependency - use ref instead

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
  const prevIpsSetRef = useRef<Set<string>>(new Set());
  
  // Debounced reconnect function - waits for rapid changes to settle
  const debouncedReconnect = useCallback(() => {
    // Clear any pending debounce
    if (ipChangeDebounceRef.current) {
      clearTimeout(ipChangeDebounceRef.current);
    }
    
    // Schedule reconnect after debounce period
    ipChangeDebounceRef.current = setTimeout(() => {
      ipChangeDebounceRef.current = null;
      const ipsToConnect = pendingIpsRef.current;
      
      if (ipsToConnect.length > 0 && sessionId) {
        console.log(`[usePanelStream] Debounced reconnect with ${ipsToConnect.length} panels`);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        // Update refs to current state
        prevIpsKeyRef.current = ipsToConnect.join(",");
        prevIpsSetRef.current = new Set(ipsToConnect);
        // Connect will use the current ips from closure
        shouldReconnectRef.current = true;
        
        // Build URL with pending IPs
        const url = `/api/panels/stream?ips=${encodeURIComponent(ipsToConnect.join(","))}&session=${encodeURIComponent(sessionId)}`;
        console.log("[usePanelStream] Reconnecting to:", url);
        
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;
        
        eventSource.onopen = () => {
          console.log("[usePanelStream] Connected");
          setIsConnected(true);
          setError(null);
        };
        
        eventSource.onmessage = handleMessage;
        
        eventSource.onerror = () => {
          setIsConnected(false);
          eventSource.close();
          eventSourceRef.current = null;
          setError("Connection lost during reconnect");
        };
      }
    }, IP_CHANGE_DEBOUNCE_MS);
  }, [sessionId, handleMessage]);
  
  // Connect/disconnect based on enabled state and ips
  useEffect(() => {
    const currentIpsSet = new Set(ips);
    const prevIpsSet = prevIpsSetRef.current;
    const ipsChanged = prevIpsKeyRef.current !== ipsKey;
    
    // Always update pending IPs for debounced reconnect
    pendingIpsRef.current = ips;
    
    if (ipsChanged) {
      // Calculate what changed
      const addedIps = ips.filter(ip => !prevIpsSet.has(ip));
      const removedIps = Array.from(prevIpsSet).filter(ip => !currentIpsSet.has(ip));
      
      // Only disconnect and reconnect if IPs actually changed (not just order)
      const hasRealChanges = addedIps.length > 0 || removedIps.length > 0;
      
      if (hasRealChanges) {
        // Remove states for IPs that are no longer in the list (immediate)
        if (removedIps.length > 0) {
          console.log(`[usePanelStream] Removing ${removedIps.length} panels: ${removedIps.join(", ")}`);
          setPanelStates((prev) => {
            const next = new Map(prev);
            for (const ip of removedIps) {
              next.delete(ip);
            }
            return next;
          });
        }
        
        // For added IPs, use debounced reconnect to batch rapid additions
        if (addedIps.length > 0 && eventSourceRef.current) {
          console.log(`[usePanelStream] ${addedIps.length} new panels detected, scheduling debounced reconnect`);
          debouncedReconnect();
        }
      }
      
      prevIpsKeyRef.current = ipsKey;
      prevIpsSetRef.current = currentIpsSet;
    }
    
    if (enabled && ips.length > 0 && sessionId) {
      shouldReconnectRef.current = true;
      // Only connect if not already connected (or just disconnected above)
      if (!eventSourceRef.current && !ipChangeDebounceRef.current) {
        connect();
      }
    } else {
      // Clear debounce timer when disabling
      if (ipChangeDebounceRef.current) {
        clearTimeout(ipChangeDebounceRef.current);
        ipChangeDebounceRef.current = null;
      }
      disconnect();
    }

    return () => {
      if (ipChangeDebounceRef.current) {
        clearTimeout(ipChangeDebounceRef.current);
        ipChangeDebounceRef.current = null;
      }
      disconnect();
    };
  }, [enabled, ipsKey, sessionId, connect, disconnect, debouncedReconnect]);

  return {
    isConnected,
    panelStates,
    error,
    reconnect,
    disconnect,
  };
}

