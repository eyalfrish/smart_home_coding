'use client';

import { useCallback, useMemo, useState, useEffect } from "react";
import DiscoveryForm, { type DiscoveryFormValues } from "./discovery-form";
import DiscoveryResults from "./discovery-results";
import AllPanelsView from "./all-panels-view";
import BatchOperationsView from "./batch-operations-view";
import styles from "./discovery-dashboard.module.css";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoveryResult,
  PanelInfo,
  LivePanelState,
  PanelCommand,
} from "@/lib/discovery/types";
import { usePanelStream } from "@/lib/hooks/use-panel-stream";
import { exportDiscoveryToExcel } from "@/lib/discovery/export-excel";

const DEFAULTS: DiscoveryRequest = {
  baseIp: "10.88.99",
  start: 201,
  end: 254,
};

const INITIAL_FORM_VALUES: DiscoveryFormValues = {
  baseIp: DEFAULTS.baseIp,
  start: String(DEFAULTS.start),
  end: String(DEFAULTS.end),
};

function buildPlaceholderResponse(payload: DiscoveryRequest): DiscoveryResponse {
  const results: DiscoveryResponse["results"] = [];
  for (let octet = payload.start; octet <= payload.end; octet += 1) {
    results.push({
      ip: `${payload.baseIp}.${octet}`,
      status: "initial" as DiscoveryResult["status"],
    });
  }

  return {
    summary: {
      baseIp: payload.baseIp,
      start: payload.start,
      end: payload.end,
      totalChecked: results.length,
      panelsFound: 0,
      notPanels: 0,
      noResponse: 0,
      errors: 0,
    },
    results,
  };
}

export default function DiscoveryDashboard() {
  const [response, setResponse] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<"discovery" | "panels-grid" | "batch-operations">("discovery");
  const [searchQuery, setSearchQuery] = useState("");
  const [formValues, setFormValues] =
    useState<DiscoveryFormValues>(INITIAL_FORM_VALUES);
  const [panelInfoMap, setPanelInfoMap] = useState<Record<string, PanelInfo>>(
    {}
  );
  const [showOnlyCubixx, setShowOnlyCubixx] = useState(true);
  const [showOnlyTouched, setShowOnlyTouched] = useState(false);
  const [showOnlyLightActive, setShowOnlyLightActive] = useState(false);
  // Selection state for batch operations - persists across filters/views
  const [selectedPanelIps, setSelectedPanelIps] = useState<Set<string>>(new Set());
  // Only connect to panels AFTER explicit discovery in THIS page session
  // Use sessionStorage to detect if this is a fresh page load
  const [hasDiscoveredThisSession, setHasDiscoveredThisSession] = useState(() => {
    // Check if we're in the browser and if there's a discovery flag
    if (typeof window !== 'undefined') {
      const flag = sessionStorage.getItem('discoveredThisSession');
      // Clear the flag on fresh load - it will be set again when discovery runs
      sessionStorage.removeItem('discoveredThisSession');
      return false; // Always start fresh on page load
    }
    return false;
  });
  
  // Track if registry has been reset
  const [registryReady, setRegistryReady] = useState(false);
  
  // Server session ID for validating panel stream connections
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  
  // Live progress during discovery
  const [liveProgress, setLiveProgress] = useState<{
    scannedCount: number;
    panelsFound: number;
    notPanels: number;
    noResponse: number;
    phase: string;
    partialResults: Array<{ ip: string; status: string; name?: string }>;
  } | null>(null);

  // Reset panel registry on mount and check server session
  // This ensures clean slate when page loads or server restarts
  useEffect(() => {
    // ALWAYS clear discovery state on mount - this handles Fast Refresh preserving state
    console.log('[Dashboard] Mount: clearing discovery state');
    setResponse(null);
    setPanelInfoMap({});
    setSelectedPanelIps(new Set());
    setHasDiscoveredThisSession(false);
    setServerSessionId(null); // Clear session until we get a new one
    sessionStorage.removeItem('discoveredThisSession');
    
    const checkServerAndReset = async () => {
      try {
        // Get current server session
        const sessionRes = await fetch('/api/session');
        const { sessionId } = await sessionRes.json();
        
        // Save current session ID
        sessionStorage.setItem('serverSessionId', sessionId);
        setServerSessionId(sessionId);
        console.log('[Dashboard] Server session:', sessionId);
        
        // Reset registry
        const resetRes = await fetch('/api/panels/reset', { method: 'POST' });
        const resetData = await resetRes.json();
        console.log('[Dashboard] Registry reset:', resetData.message);
        setRegistryReady(true);
      } catch (err) {
        console.error('[Dashboard] Failed to check session/reset registry:', err);
        setRegistryReady(true); // Continue anyway
      }
    };
    
    checkServerAndReset();
  }, []);

  // Poll for progress during discovery and update table with partial results
  useEffect(() => {
    if (!isLoading) {
      setLiveProgress(null);
      return;
    }
    
    const pollProgress = async () => {
      try {
        const res = await fetch('/api/discover/progress');
        const data = await res.json();
        if (data.isRunning) {
          setLiveProgress({
            scannedCount: data.scannedCount,
            panelsFound: data.panelsFound,
            notPanels: data.notPanels,
            noResponse: data.noResponse,
            phase: data.phase,
            partialResults: data.partialResults || [],
          });
          
          // Update response with partial results so table shows progress
          setResponse(prev => {
            if (!prev) return prev;
            
            // Create a map from partial results for quick lookup
            const partialMap = new Map<string, { status: string; name?: string }>();
            for (const pr of data.partialResults || []) {
              partialMap.set(pr.ip, { status: pr.status, name: pr.name });
            }
            
            // Update results with partial data - update any row that has new info
            const updatedResults = prev.results.map(r => {
              const partial = partialMap.get(r.ip);
              if (partial) {
                // Update if we have new data (status changed or name added)
                const statusChanged = partial.status !== r.status;
                const nameAdded = partial.name && !r.name;
                if (statusChanged || nameAdded) {
                  return {
                    ...r,
                    status: partial.status as DiscoveryResult['status'],
                    name: partial.name || r.name,
                  };
                }
              }
              return r;
            });
            
            return {
              ...prev,
              summary: {
                ...prev.summary,
                panelsFound: data.panelsFound,
                notPanels: data.notPanels,
                noResponse: data.noResponse,
                errors: data.errors,
              },
              results: updatedResults,
            };
          });
        }
      } catch (err) {
        // Ignore polling errors
      }
    };
    
    // Poll immediately and then every 300ms for responsive updates
    pollProgress();
    const interval = setInterval(pollProgress, 300);
    
    return () => clearInterval(interval);
  }, [isLoading]);

  // Get list of discovered Cubixx panel IPs for real-time streaming
  const discoveredPanelIps = useMemo(() => {
    if (!response) return [];
    return response.results
      .filter((r) => r.status === "panel")
      .map((r) => r.ip);
  }, [response]);

  // Handle real-time panel state updates
  const handlePanelState = useCallback((ip: string, state: LivePanelState) => {
    setPanelInfoMap((prev) => {
      const existing = prev[ip];
      if (!existing) return prev;

      // Compute current state fingerprint from live data
      const relayFingerprint = state.fullState?.relays
        ?.map((r) => `${r.index}:${r.state}`)
        .join(",") ?? "";
      const curtainFingerprint = state.fullState?.curtains
        ?.map((c) => `${c.index}:${c.state}`)
        .join(",") ?? "";
      const currentFingerprint = `relays=[${relayFingerprint}],curtains=[${curtainFingerprint}]`;

      // If no baseline yet, this is the first live state - capture it as baseline
      const isFirstLiveState = !existing.baselineFingerprint;
      const newBaseline = isFirstLiveState ? currentFingerprint : existing.baselineFingerprint;
      
      // Once touched, stay touched until next discovery
      // Mark as touched if state differs from baseline (and we have a baseline)
      const touched = existing.touched || (!isFirstLiveState && currentFingerprint !== newBaseline);

      return {
        ...prev,
        [ip]: {
          ...existing,
          name: state.fullState?.hostname ?? existing.name,
          lastFingerprint: currentFingerprint,
          baselineFingerprint: newBaseline,
          touched,
        },
      };
    });
  }, []);

  // Real-time panel stream
  // Only connect AFTER:
  // 1. Registry has been reset (registryReady)
  // 2. Explicit discovery in this session (hasDiscoveredThisSession)
  // 3. Not currently loading
  // 4. We have discovered panels
  // 5. We have a valid server session ID
  const shouldConnectToPanels = registryReady && hasDiscoveredThisSession && !isLoading && discoveredPanelIps.length > 0 && !!serverSessionId;
  
  const { isConnected: isStreamConnected, panelStates, error: streamError } = usePanelStream({
    ips: shouldConnectToPanels ? discoveredPanelIps : [], // Pass empty array if not ready
    sessionId: serverSessionId, // Required for server-side validation
    enabled: shouldConnectToPanels,
    onPanelState: handlePanelState,
  });

  const executeDiscovery = useCallback(
    async (payload: DiscoveryRequest) => {
      // Clear all state at the very start, synchronously
      setIsLoading(true);
      setError(null);
      setView("discovery");
      setSearchQuery("");
      setPanelInfoMap({}); // Clear panel info
      setSelectedPanelIps(new Set()); // Clear selection on new discovery
      
      // Initialize response with placeholder data so polling can update it
      const initialResults: DiscoveryResult[] = [];
      for (let octet = payload.start; octet <= payload.end; octet++) {
        initialResults.push({ ip: `${payload.baseIp}.${octet}`, status: "initial" });
      }
      setResponse({
        summary: {
          baseIp: payload.baseIp,
          start: payload.start,
          end: payload.end,
          totalChecked: payload.end - payload.start + 1,
          panelsFound: 0,
          notPanels: 0,
          noResponse: 0,
          errors: 0,
        },
        results: initialResults,
      });

      // Give React a chance to process the init before we start receiving data
      await new Promise(resolve => setTimeout(resolve, 0));

      // Track results as they stream in
      const resultsMap = new Map<string, DiscoveryResult>();
      const summary = {
        baseIp: payload.baseIp,
        start: payload.start,
        end: payload.end,
        totalChecked: payload.end - payload.start + 1,
        panelsFound: 0,
        notPanels: 0,
        noResponse: 0,
        errors: 0,
      };

      // Throttled update mechanism - update UI at most every 50ms for responsive progressive display
      let updatePending = false;
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 50;
      
      const doUpdateResponse = () => {
        const orderedResults: DiscoveryResult[] = [];
        let panels = 0, notPanels = 0, noResp = 0, errs = 0;
        
        for (let octet = payload.start; octet <= payload.end; octet++) {
          const ip = `${payload.baseIp}.${octet}`;
          const existing = resultsMap.get(ip);
          if (existing) {
            const { panelHtml, ...rest } = existing;
            orderedResults.push(rest as DiscoveryResult);
            // Count statuses
            if (existing.status === "panel") panels++;
            else if (existing.status === "not-panel") notPanels++;
            else if (existing.status === "no-response" || existing.status === "pending") noResp++;
            else if (existing.status === "error") errs++;
          } else {
            orderedResults.push({ ip, status: "initial" });
          }
        }
        
        setResponse({
          summary: { 
            ...summary, 
            panelsFound: panels, 
            notPanels: notPanels, 
            noResponse: noResp, 
            errors: errs 
          },
          results: orderedResults,
        });
        lastUpdateTime = Date.now();
        updatePending = false;
      };
      
      // Throttled update - schedules update if not already pending
      const updateResponseFromMap = (force = false) => {
        if (force) {
          doUpdateResponse();
          return;
        }
        
        const now = Date.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
          // Enough time passed, update immediately
          doUpdateResponse();
        } else if (!updatePending) {
          // Schedule update for later
          updatePending = true;
          setTimeout(() => {
            if (updatePending) {
              doUpdateResponse();
            }
          }, UPDATE_INTERVAL - (now - lastUpdateTime));
        }
      };

      // Set initial placeholder after clears are processed
      setResponse(buildPlaceholderResponse(payload));

      try {
        const url = `/api/discover/stream?baseIp=${encodeURIComponent(payload.baseIp)}&start=${payload.start}&end=${payload.end}`;
        const eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Ignore heartbeat and phase events (used internally)
            if (message.type === "heartbeat") {
              console.log("[Discovery] Connection established");
              return;
            }
            
            if (message.type === "phase_start") {
              console.log(`[Discovery] Starting phase: ${message.phase}`);
              return;
            }
            
            if (message.type === "phase_complete") {
              console.log(`[Discovery] Phase ${message.phase} complete. Panels: ${message.progress?.panelsFound}`);
              return;
            }
            
            if (message.type === "settings_start" || message.type === "settings_complete") {
              console.log(`[Discovery] ${message.type}`);
              return;
            }
            
            // Handle batch settings update - all settings in one event
            if (message.type === "settings_batch") {
              const batchResults = message.data as DiscoveryResult[];
              console.log(`[Discovery] Received settings batch for ${batchResults.length} panels`);
              
              // Build panel info map update in one batch
              const newPanelInfoEntries: Record<string, PanelInfo> = {};
              for (const result of batchResults) {
                resultsMap.set(result.ip, result);
                if (result.status === "panel") {
                  newPanelInfoEntries[result.ip] = buildPanelInfoFromResult(result, undefined, { resetBaseline: false });
                }
              }
              
              setPanelInfoMap((prev) => ({ ...prev, ...newPanelInfoEntries }));
              updateResponseFromMap(true); // Force immediate update for settings
              return;
            }

            if (message.type === "result") {
              const result = message.data as DiscoveryResult;
              
              // Debug: log first few panel results
              if (result.status === "panel" && Array.from(resultsMap.values()).filter(r => r.status === "panel").length < 3) {
                console.log(`[Discovery] Panel found: ${result.ip} (${result.name || "unnamed"})`);
              }
              
              resultsMap.set(result.ip, result);

              // Update panel info map for panels
              if (result.status === "panel") {
                setPanelInfoMap((prev) => ({
                  ...prev,
                  [result.ip]: buildPanelInfoFromResult(result, undefined, { resetBaseline: true }),
                }));
              }

              updateResponseFromMap();
            } else if (message.type === "update") {
              // Update from verification or settings enrichment
              const result = message.data as DiscoveryResult;
              const previousResult = resultsMap.get(result.ip);
              
              resultsMap.set(result.ip, result);
              
              // Update panel info map
              if (result.status === "panel") {
                setPanelInfoMap((prev) => ({
                  ...prev,
                  [result.ip]: buildPanelInfoFromResult(result, prev[result.ip], { resetBaseline: false }),
                }));
              } else if (previousResult?.status === "panel") {
                // Panel became invalid during verification
                console.log(`[Discovery] Panel ${result.ip} failed verification`);
              }
              
              updateResponseFromMap();
            } else if (message.type === "complete") {
              const stats = message.stats;
              console.log(`[Discovery] Complete! Found ${stats?.panelsFound ?? "?"} panels in ${stats?.totalDurationMs ?? "?"}ms`);
              if (stats?.phases) {
                for (const phase of stats.phases) {
                  console.log(`  - ${phase.name}: scanned ${phase.scanned}, found ${phase.found} (${phase.durationMs}ms)`);
                }
              }
              
              // Final update - mark any remaining "initial" as no-response
              for (let octet = payload.start; octet <= payload.end; octet++) {
                const ip = `${payload.baseIp}.${octet}`;
                if (!resultsMap.has(ip)) {
                  resultsMap.set(ip, { ip, status: "no-response", errorMessage: "Not scanned" });
                }
              }
              
              updateResponseFromMap(true); // Force final update
              eventSource.close();
              setIsLoading(false);
              setHasDiscoveredThisSession(true); // Enable panel connections
              // Mark that we've discovered in this session (for debugging)
              if (typeof window !== 'undefined') {
                sessionStorage.setItem('discoveredThisSession', 'true');
              }
            }
          } catch (e) {
            console.error("[Discovery] Failed to parse message:", e);
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          setIsLoading(false);
          if (resultsMap.size === 0) {
            setError("Failed to connect to discovery service.");
          }
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unexpected error occurred.";
        setError(message);
        setIsLoading(false);
      }
    },
    []
  );

  const handleFormSubmit = () => {
    const payload: DiscoveryRequest = {
      baseIp: formValues.baseIp.trim(),
      start: Number(formValues.start),
      end: Number(formValues.end),
    };

    setFormValues({
      baseIp: payload.baseIp,
      start: String(payload.start),
      end: String(payload.end),
    });

    // State clearing is now done inside executeDiscovery to avoid race conditions
    executeDiscovery(payload);
  };

  const handlePanelsSummaryClick = () => {
    if (!response || response.summary.panelsFound === 0) {
      return;
    }
    setView("panels-grid");
  };

  const handleBackToDiscovery = () => {
    setView("discovery");
  };

  const handleBatchOperationsClick = () => {
    if (selectedPanelIps.size === 0) return;
    setView("batch-operations");
  };

  // Selection handlers
  const handlePanelSelectionChange = useCallback((ip: string, selected: boolean) => {
    setSelectedPanelIps(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(ip);
      } else {
        next.delete(ip);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((ips: string[]) => {
    setSelectedPanelIps(new Set(ips));
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedPanelIps(new Set());
  }, []);

  // Export all discovery results to Excel
  const handleExportToExcel = useCallback(() => {
    if (!response) return;
    exportDiscoveryToExcel({
      results: response.results,
      panelInfoMap,
      livePanelStates: panelStates,
    });
  }, [response, panelInfoMap, panelStates]);

  // Send a command to a specific panel
  const sendCommand = useCallback(async (ip: string, command: PanelCommand): Promise<boolean> => {
    try {
      const res = await fetch("/api/panels/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ips: [ip],
          ...command,
        }),
      });

      if (!res.ok) {
        console.error(`[Command] Failed to send ${command.command} to ${ip}: HTTP ${res.status}`);
        return false;
      }

      const data = await res.json();
      return data.successCount > 0;
    } catch (err) {
      console.error(`[Command] Error sending ${command.command} to ${ip}:`, err);
      return false;
    }
  }, []);

  // Update panel settings in the response state (persists settings changes from batch operations)
  const handlePanelSettingsUpdate = useCallback((ip: string, settings: { logging?: boolean; longPressMs?: number }) => {
    setResponse(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        results: prev.results.map(result => 
          result.ip === ip 
            ? { ...result, settings: { ...result.settings, ...settings } }
            : result
        ),
      };
    });
  }, []);

  const panelResults = response?.results ?? [];

  // Get list of Cubixx panel IPs for selection purposes
  const cubixxPanelIps = useMemo(() => {
    if (!response) return [];
    return response.results
      .filter((r) => r.status === "panel")
      .map((r) => r.ip);
  }, [response]);

  return (
    <div className={styles.card}>
      {view === "panels-grid" ? (
        <AllPanelsView
          panels={panelResults}
          onBack={handleBackToDiscovery}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      ) : view === "batch-operations" ? (
        <BatchOperationsView
          selectedPanelIps={selectedPanelIps}
          panelResults={panelResults}
          panelInfoMap={panelInfoMap}
          livePanelStates={panelStates}
          onBack={handleBackToDiscovery}
          onSelectionChange={handlePanelSelectionChange}
          onSendCommand={sendCommand}
          onPanelSettingsUpdate={handlePanelSettingsUpdate}
        />
      ) : (
        <>
          <DiscoveryForm
            values={formValues}
            disabled={isLoading}
            isLoading={isLoading}
            onChange={setFormValues}
            onSubmit={handleFormSubmit}
            selectedCount={selectedPanelIps.size}
            onBatchOperationsClick={handleBatchOperationsClick}
            hasResults={!!response && response.results.length > 0}
            onExportClick={handleExportToExcel}
          />
          {isLoading && (
            <div className={styles.loadingBox}>
              <div className={styles.loadingSpinner} />
              <div className={styles.loadingText}>
                <strong>Scanning network...</strong>
                <span style={{ fontSize: "0.9em", opacity: 0.8, marginLeft: "0.5rem" }}>
                  {liveProgress ? `Phase: ${liveProgress.phase}` : "Initializing..."}
                </span>
              </div>
            </div>
          )}
          {!isLoading && discoveredPanelIps.length > 0 && (
            <div className={styles.streamStatus}>
              <span className={isStreamConnected ? styles.statusConnected : styles.statusDisconnected}>
                {isStreamConnected
                  ? `● Live: ${discoveredPanelIps.filter(ip => panelStates.get(ip)?.connectionStatus === "connected").length}/${discoveredPanelIps.length} panels connected`
                  : "○ Connecting to panels..."}
              </span>
              {streamError && (
                <span className={styles.streamError}>
                  {streamError.includes("npm install") 
                    ? "⚠️ " + streamError
                    : `(${streamError})`}
                </span>
              )}
            </div>
          )}
          {error && <div className={styles.errorBox}>{error}</div>}
          <DiscoveryResults
            data={response}
            onPanelsSummaryClick={handlePanelsSummaryClick}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            panelInfoMap={panelInfoMap}
            livePanelStates={panelStates}
            showOnlyCubixx={showOnlyCubixx}
            showOnlyTouched={showOnlyTouched}
            showOnlyLightActive={showOnlyLightActive}
            onShowOnlyCubixxChange={setShowOnlyCubixx}
            onShowOnlyTouchedChange={setShowOnlyTouched}
            onShowOnlyLightActiveChange={setShowOnlyLightActive}
            onSendCommand={sendCommand}
            selectedPanelIps={selectedPanelIps}
            onPanelSelectionChange={handlePanelSelectionChange}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            cubixxPanelIps={cubixxPanelIps}
          />
        </>
      )}
    </div>
  );
}

function mergePanelInfoState(
  results: DiscoveryResult[],
  existing: Record<string, PanelInfo>,
  options: { resetBaselines: boolean }
): Record<string, PanelInfo> {
  if (results.length === 0) {
    return options.resetBaselines ? {} : existing;
  }

  const next: Record<string, PanelInfo> = options.resetBaselines
    ? {}
    : { ...existing };

  for (const result of results) {
    const previous = options.resetBaselines ? undefined : existing[result.ip];
    next[result.ip] = buildPanelInfoFromResult(result, previous, {
      resetBaseline: options.resetBaselines,
    });
  }

  return next;
}

function buildPanelInfoFromResult(
  result: DiscoveryResult,
  previous?: PanelInfo,
  options?: { resetBaseline?: boolean }
): PanelInfo {
  const isCubixx = result.status === "panel";
  const resolvedName = result.name ?? previous?.name;
  const link = isCubixx ? `http://${result.ip}/` : previous?.link;
  const shouldReset = options?.resetBaseline ?? false;

  // When resetting or new panel, initialize with null baseline
  // The baseline will be captured from the first live state update
  if (shouldReset || !previous) {
    return {
      ip: result.ip,
      isCubixx,
      name: resolvedName ?? undefined,
      link,
      baselineFingerprint: null,
      lastFingerprint: null,
      touched: false,
    };
  }

  // Keep existing state for non-reset scenarios
  return {
    ip: result.ip,
    isCubixx,
    name: resolvedName ?? undefined,
    link,
    baselineFingerprint: previous.baselineFingerprint,
    lastFingerprint: previous.lastFingerprint,
    touched: previous.touched,
  };
}

