'use client';

import { useCallback, useMemo, useState, useEffect } from "react";
import DiscoveryForm, { type DiscoveryFormValues, type IpRange, type ThoroughSettings, createDefaultRange, validateFormRanges, DEFAULT_THOROUGH_SETTINGS } from "./discovery-form";
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

const INITIAL_FORM_VALUES: DiscoveryFormValues = {
  ranges: [createDefaultRange("10", "88", "99", "201", "254")],
};

// Convert IpRange to DiscoveryRequest format
function rangeToRequest(range: IpRange): DiscoveryRequest {
  return {
    baseIp: `${range.octet1}.${range.octet2}.${range.octet3}`,
    start: parseInt(range.start, 10),
    end: parseInt(range.end, 10),
  };
}

function buildPlaceholderResponse(requests: DiscoveryRequest[]): DiscoveryResponse {
  const results: DiscoveryResponse["results"] = [];
  
  for (const payload of requests) {
    for (let octet = payload.start; octet <= payload.end; octet += 1) {
      results.push({
        ip: `${payload.baseIp}.${octet}`,
        status: "initial" as DiscoveryResult["status"],
      });
    }
  }

  const firstRequest = requests[0];
  return {
    summary: {
      baseIp: firstRequest?.baseIp ?? "",
      start: firstRequest?.start ?? 0,
      end: requests[requests.length - 1]?.end ?? 0,
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
  // Panel Discovery section expansion state - starts collapsed
  const [isPanelDiscoveryExpanded, setIsPanelDiscoveryExpanded] = useState(false);
  // IP Ranges section expansion state - starts collapsed
  const [isIpRangesExpanded, setIsIpRangesExpanded] = useState(false);
  
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
    setServerSessionId(null); // Clear session until we get a new one
    
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
  // Connect as soon as we have panels - don't wait for discovery to complete!
  // This allows progressive loading where panels show their full state as they're discovered.
  // Requirements:
  // 1. Registry has been reset (registryReady)
  // 2. We have discovered panels (discoveredPanelIps.length > 0)
  // 3. We have a valid server session ID
  // Note: We no longer wait for !isLoading - panels connect progressively during discovery
  const shouldConnectToPanels = registryReady && discoveredPanelIps.length > 0 && !!serverSessionId;
  
  const { isConnected: isStreamConnected, panelStates, error: streamError } = usePanelStream({
    ips: shouldConnectToPanels ? discoveredPanelIps : [], // Pass empty array if not ready
    sessionId: serverSessionId, // Required for server-side validation
    enabled: shouldConnectToPanels,
    onPanelState: handlePanelState,
  });

  const executeDiscovery = useCallback(
    async (requests: DiscoveryRequest[]) => {
      if (requests.length === 0) return;
      
      // Clear all state at the very start, synchronously
      setIsLoading(true);
      setError(null);
      setView("discovery");
      setSearchQuery("");
      setPanelInfoMap({}); // Clear panel info
      setSelectedPanelIps(new Set()); // Clear selection on new discovery
      
      // Build list of all IPs across all ranges
      const allIps: string[] = [];
      for (const req of requests) {
        for (let octet = req.start; octet <= req.end; octet++) {
          allIps.push(`${req.baseIp}.${octet}`);
        }
      }
      
      // Initialize response with placeholder data so polling can update it
      const initialResults: DiscoveryResult[] = allIps.map(ip => ({ ip, status: "initial" as const }));
      const firstReq = requests[0];
      setResponse({
        summary: {
          baseIp: firstReq.baseIp,
          start: firstReq.start,
          end: requests[requests.length - 1].end,
          totalChecked: allIps.length,
          panelsFound: 0,
          notPanels: 0,
          noResponse: 0,
          errors: 0,
        },
        results: initialResults,
      });

      // Give React a chance to process the init before we start receiving data
      await new Promise(resolve => setTimeout(resolve, 0));

      // Track results as they stream in (shared across all ranges)
      const resultsMap = new Map<string, DiscoveryResult>();
      const allIpsSet = new Set(allIps);

      // Throttled update mechanism - update UI at most every 50ms for responsive progressive display
      let updatePending = false;
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 50;
      
      const doUpdateResponse = () => {
        const orderedResults: DiscoveryResult[] = [];
        let panels = 0, notPanels = 0, noResp = 0, errs = 0;
        
        for (const ip of allIps) {
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
            baseIp: firstReq.baseIp,
            start: firstReq.start,
            end: requests[requests.length - 1].end,
            totalChecked: allIps.length,
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
      setResponse(buildPlaceholderResponse(requests));

      // Track completion state for multiple streams
      let completedStreams = 0;
      const totalStreams = requests.length;

      const handleStreamComplete = () => {
        completedStreams++;
        if (completedStreams >= totalStreams) {
          // All streams complete - final update
          for (const ip of allIpsSet) {
            if (!resultsMap.has(ip)) {
              resultsMap.set(ip, { ip, status: "no-response", errorMessage: "Not scanned" });
            }
          }
          
          updateResponseFromMap(true); // Force final update
          setIsLoading(false);
        }
      };

      try {
        // Create event sources for each range (run in parallel)
        const thoroughMode = formValues.thoroughMode ?? false;
        const thoroughSettings = formValues.thoroughSettings;
        for (const payload of requests) {
          let url = `/api/discover/stream?baseIp=${encodeURIComponent(payload.baseIp)}&start=${payload.start}&end=${payload.end}`;
          if (thoroughMode) {
            url += '&thorough=true';
            if (thoroughSettings) {
              url += `&timeout=${thoroughSettings.timeout}`;
              url += `&concurrency=${thoroughSettings.concurrency}`;
              url += `&retries=${thoroughSettings.retries}`;
            }
          }
          const eventSource = new EventSource(url);

          eventSource.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);

              // Ignore heartbeat and phase events (used internally)
              if (message.type === "heartbeat") {
                console.log(`[Discovery] Connection established for ${payload.baseIp}`);
                return;
              }
              
              if (message.type === "phase_start") {
                console.log(`[Discovery] Starting phase: ${message.phase} (${payload.baseIp})`);
                return;
              }
              
              if (message.type === "phase_complete") {
                console.log(`[Discovery] Phase ${message.phase} complete for ${payload.baseIp}`);
                return;
              }
              
              if (message.type === "settings_start" || message.type === "settings_complete") {
                console.log(`[Discovery] ${message.type} (${payload.baseIp})`);
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
                console.log(`[Discovery] Range ${payload.baseIp}.${payload.start}-${payload.end} complete! Found ${stats?.panelsFound ?? "?"} panels`);
                eventSource.close();
                handleStreamComplete();
              }
            } catch (e) {
              console.error("[Discovery] Failed to parse message:", e);
            }
          };

          eventSource.onerror = () => {
            eventSource.close();
            console.error(`[Discovery] Error in stream for ${payload.baseIp}`);
            handleStreamComplete();
          };
        }
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
    // Convert form ranges to discovery requests
    const requests: DiscoveryRequest[] = formValues.ranges.map(rangeToRequest);
    
    // Stay collapsed during discovery - user can expand if they want
    // State clearing is now done inside executeDiscovery to avoid race conditions
    executeDiscovery(requests);
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

  // Compute form validation state for external buttons
  const formValidation = useMemo(() => validateFormRanges(formValues.ranges), [formValues.ranges]);
  const canSubmitDiscovery = !isLoading && formValidation.canSubmit;
  const hasBatchSelection = selectedPanelIps.size > 0;
  const hasResults = !!response && response.results.length > 0;

  // Determine if we should show the summary stats in collapsed state
  // Show when: has data AND (discovery complete OR loading with partial results)
  const showCollapsedSummary = hasResults;

  // Calculate live panel count for collapsed header display
  const liveConnectedCount = discoveredPanelIps.filter(ip => panelStates.get(ip)?.connectionStatus === "connected").length;

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
          {/* IP Ranges Form - Collapsible */}
          <DiscoveryForm
            values={formValues}
            disabled={isLoading}
            isLoading={isLoading}
            onChange={setFormValues}
            onSubmit={handleFormSubmit}
            selectedCount={selectedPanelIps.size}
            onBatchOperationsClick={handleBatchOperationsClick}
            hasResults={hasResults}
            onExportClick={handleExportToExcel}
            hideActions={true}
            hideThoroughMode={true}
            collapsed={!isIpRangesExpanded}
            onExpand={() => setIsIpRangesExpanded(true)}
            onCollapse={() => setIsIpRangesExpanded(false)}
          />

          {/* Panel Discovery Section - Collapsible */}
          <div className={`${styles.collapsibleSection} ${isPanelDiscoveryExpanded ? styles.collapsibleSectionExpanded : ""}`}>
            {/* Header - always visible, entire header is clickable */}
            <div 
              className={styles.collapsibleSectionHeader}
              onClick={() => setIsPanelDiscoveryExpanded(!isPanelDiscoveryExpanded)}
              style={{ cursor: "pointer" }}
            >
              <div className={styles.collapsibleSectionHeaderLeft}>
                <span className={styles.collapsibleSectionToggle}>
                  {isPanelDiscoveryExpanded ? "▼" : "▶"}
                </span>
                <h3 className={styles.collapsibleSectionTitle}>
                  🔍 Panel Discovery
                  {/* Live badge when connected */}
                  {!isLoading && isStreamConnected && liveConnectedCount > 0 && (
                    <span className={styles.collapsibleSectionLiveBadge}>
                      ● Live: {liveConnectedCount}/{discoveredPanelIps.length}
                    </span>
                  )}
                </h3>
              </div>
              <div className={styles.collapsibleSectionActions} onClick={(e) => e.stopPropagation()}>
                {/* Thorough mode toggle - compact when not expanded */}
                {!isPanelDiscoveryExpanded && (
                  <label className={styles.thoroughModeCompact} title="Slower scan for panels recovering from power outages">
                    <input
                      type="checkbox"
                      checked={formValues.thoroughMode ?? false}
                      onChange={(e) => setFormValues({ 
                        ...formValues, 
                        thoroughMode: e.target.checked,
                        thoroughSettings: e.target.checked ? (formValues.thoroughSettings ?? DEFAULT_THOROUGH_SETTINGS) : undefined,
                      })}
                      disabled={isLoading}
                      className={styles.thoroughModeCompactCheckbox}
                    />
                    <span className={styles.thoroughModeCompactLabel}>🔬</span>
                  </label>
                )}
                <button
                  type="button"
                  className={styles.button}
                  disabled={!canSubmitDiscovery}
                  aria-busy={isLoading}
                  onClick={handleFormSubmit}
                  title={
                    formValidation.hasOverlap
                      ? "Cannot start discovery: IP ranges overlap"
                      : !formValidation.allValid
                      ? "Please fill in all IP range fields with valid values"
                      : undefined
                  }
                >
                  {isLoading ? (
                    <>
                      <span className={styles.desktopText}>⏳ Scanning…</span>
                      <span className={styles.mobileText}>⏳</span>
                    </>
                  ) : (
                    <>
                      <span className={styles.desktopText}>🔍 Discover</span>
                      <span className={styles.mobileText}>🔍</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className={`${styles.batchButton} ${hasBatchSelection ? styles.batchButtonActive : ""}`}
                  disabled={!hasBatchSelection || isLoading}
                  onClick={handleBatchOperationsClick}
                >
                  <span className={styles.desktopText}>
                    ⚡ Batch{hasBatchSelection ? ` (${selectedPanelIps.size})` : ""}
                  </span>
                  <span className={styles.mobileText}>
                    ⚡{hasBatchSelection ? ` ${selectedPanelIps.size}` : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.exportButton}
                  disabled={!hasResults || isLoading}
                  onClick={handleExportToExcel}
                  title="Export all discovery results to Excel"
                >
                  <span className={styles.desktopText}>📊 Export</span>
                  <span className={styles.mobileText}>📊</span>
                </button>
              </div>
            </div>

            {/* Summary stats row - visible when collapsed AND (has data OR is loading) */}
            {!isPanelDiscoveryExpanded && (showCollapsedSummary || isLoading) && (
              <div className={styles.collapsibleSectionSummary}>
                {/* Mini progress section when loading */}
                {isLoading && (() => {
                  const phases = [
                    { key: "quick-sweep", label: "Quick", shortLabel: "Q" },
                    { key: "standard", label: "Standard", shortLabel: "S" },
                    { key: "deep", label: "Deep", shortLabel: "D" },
                  ];
                  const currentPhase = liveProgress?.phase || "";
                  const currentPhaseIndex = phases.findIndex(p => currentPhase.includes(p.key));
                  const totalIps = response?.summary?.totalChecked ?? 0;
                  const scanned = liveProgress?.scannedCount ?? 0;
                  const percent = totalIps > 0 ? Math.round((scanned / totalIps) * 100) : 0;
                  return (
                    <div className={styles.miniProgressSection}>
                      {/* Mini phase steps */}
                      <div className={styles.miniPhaseSteps}>
                        {phases.map((phase, idx) => {
                          const isActive = idx === currentPhaseIndex;
                          const isComplete = idx < currentPhaseIndex;
                          return (
                            <div 
                              key={phase.key}
                              className={`${styles.miniPhaseStep} ${isActive ? styles.miniPhaseStepActive : ""} ${isComplete ? styles.miniPhaseStepComplete : ""}`}
                            >
                              <span className={styles.miniPhaseStepIndicator}>
                                {isComplete ? "✓" : idx + 1}
                              </span>
                              <span className={styles.miniPhaseStepLabel}>
                                <span className={styles.desktopText}>{phase.label}</span>
                                <span className={styles.mobileText}>{phase.shortLabel}</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Mini progress bar */}
                      <div className={styles.miniProgressContainer}>
                        <div className={styles.miniProgressBarTrack}>
                          <div 
                            className={styles.miniProgressBarFill}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>
                        <span className={styles.miniProgressText}>{percent}%</span>
                      </div>
                    </div>
                  );
                })()}
                <div className={`${styles.miniStatBox} ${styles.miniStatAccent}`}>
                  <span className={styles.miniStatValue}>{isLoading ? (liveProgress?.scannedCount ?? 0) : (response?.summary.totalChecked ?? 0)}</span>
                  <span className={styles.miniStatLabel}>
                    <span className={styles.desktopText}>{isLoading ? "Scanned" : "Total"}</span>
                    <span className={styles.mobileText}>{isLoading ? "S" : "T"}</span>
                  </span>
                </div>
                <div 
                  className={`${styles.miniStatBox} ${styles.miniStatPanel} ${!isLoading && (response?.summary.panelsFound ?? 0) > 0 ? styles.miniStatClickable : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isLoading && (response?.summary.panelsFound ?? 0) > 0) {
                      handlePanelsSummaryClick();
                    }
                  }}
                  title={!isLoading && (response?.summary.panelsFound ?? 0) > 0 ? "Click to view all panels" : undefined}
                >
                  <span className={styles.miniStatIcon}>●</span>
                  <span className={styles.miniStatValue}>{isLoading ? (liveProgress?.panelsFound ?? 0) : (response?.summary.panelsFound ?? 0)}</span>
                  <span className={styles.miniStatLabel}>
                    <span className={styles.desktopText}>Panels</span>
                    <span className={styles.mobileText}>P</span>
                  </span>
                </div>
                <div className={`${styles.miniStatBox} ${styles.miniStatMuted}`}>
                  <span className={styles.miniStatIcon}>○</span>
                  <span className={styles.miniStatValue}>{isLoading ? (liveProgress?.notPanels ?? 0) : (response?.summary.notPanels ?? 0)}</span>
                  <span className={styles.miniStatLabel}>
                    <span className={styles.desktopText}>Other</span>
                    <span className={styles.mobileText}>O</span>
                  </span>
                </div>
                <div className={`${styles.miniStatBox} ${styles.miniStatWarn}`}>
                  <span className={styles.miniStatValue}>{isLoading ? (liveProgress?.noResponse ?? 0) : (response?.summary.noResponse ?? 0)}</span>
                  <span className={styles.miniStatLabel}>
                    <span className={styles.desktopText}>Offline</span>
                    <span className={styles.mobileText}>Off</span>
                  </span>
                </div>
                <div className={`${styles.miniStatBox} ${styles.miniStatWarn}`}>
                  <span className={styles.miniStatValue}>{response?.summary.errors ?? 0}</span>
                  <span className={styles.miniStatLabel}>
                    <span className={styles.desktopText}>Errors</span>
                    <span className={styles.mobileText}>Err</span>
                  </span>
                </div>
              </div>
            )}

            {/* Expandable content area */}
            <div className={styles.collapsibleSectionContent}>
              {/* Thorough Mode Settings - Full version when expanded */}
              <div className={styles.thoroughModeSection}>
                <label className={styles.thoroughModeLabel}>
                  <input
                    type="checkbox"
                    checked={formValues.thoroughMode ?? false}
                    onChange={(e) => setFormValues({ 
                      ...formValues, 
                      thoroughMode: e.target.checked,
                      thoroughSettings: e.target.checked ? (formValues.thoroughSettings ?? DEFAULT_THOROUGH_SETTINGS) : undefined,
                    })}
                    disabled={isLoading}
                    className={styles.thoroughModeCheckbox}
                  />
                  <span className={styles.thoroughModeText}>
                    🔬 Thorough Mode
                  </span>
                  <span className={styles.thoroughModeHint}>
                    (slower scan for panels recovering from power outages)
                  </span>
                </label>
                
                {/* Thorough Mode Settings */}
                {formValues.thoroughMode && (
                  <div className={styles.thoroughSettings}>
                    <div className={styles.thoroughSettingsHeader}>
                      <span className={styles.thoroughSettingsTitle}>Thorough Mode Settings</span>
                    </div>
                    
                    <div className={styles.thoroughSettingRow}>
                      <label className={styles.thoroughSettingLabel} title="Maximum time to wait for each panel response">
                        ⏱️ Timeout
                      </label>
                      <div className={styles.thoroughSettingInputGroup}>
                        <input
                          type="number"
                          min="500"
                          max="30000"
                          step="100"
                          value={formValues.thoroughSettings?.timeout ?? DEFAULT_THOROUGH_SETTINGS.timeout}
                          onChange={(e) => setFormValues({
                            ...formValues,
                            thoroughSettings: {
                              ...DEFAULT_THOROUGH_SETTINGS,
                              ...formValues.thoroughSettings,
                              timeout: parseInt(e.target.value, 10) || DEFAULT_THOROUGH_SETTINGS.timeout,
                            },
                          })}
                          disabled={isLoading}
                          className={styles.thoroughSettingInput}
                        />
                        <span className={styles.thoroughSettingSuffix}>ms</span>
                      </div>
                    </div>
                    
                    <div className={styles.thoroughSettingRow}>
                      <label className={styles.thoroughSettingLabel} title="Number of simultaneous panel requests">
                        🔀 Parallel
                      </label>
                      <div className={styles.thoroughSettingInputGroup}>
                        <input
                          type="number"
                          min="1"
                          max="25"
                          step="1"
                          value={formValues.thoroughSettings?.concurrency ?? DEFAULT_THOROUGH_SETTINGS.concurrency}
                          onChange={(e) => setFormValues({
                            ...formValues,
                            thoroughSettings: {
                              ...DEFAULT_THOROUGH_SETTINGS,
                              ...formValues.thoroughSettings,
                              concurrency: Math.max(1, parseInt(e.target.value, 10) || DEFAULT_THOROUGH_SETTINGS.concurrency),
                            },
                          })}
                          disabled={isLoading}
                          className={styles.thoroughSettingInput}
                        />
                      </div>
                    </div>
                    
                    <div className={styles.thoroughSettingRow}>
                      <label className={styles.thoroughSettingLabel} title="Number of retry attempts per panel">
                        🔄 Retries
                      </label>
                      <div className={styles.thoroughSettingInputGroup}>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          step="1"
                          value={formValues.thoroughSettings?.retries ?? DEFAULT_THOROUGH_SETTINGS.retries}
                          onChange={(e) => setFormValues({
                            ...formValues,
                            thoroughSettings: {
                              ...DEFAULT_THOROUGH_SETTINGS,
                              ...formValues.thoroughSettings,
                              retries: Math.max(0, parseInt(e.target.value, 10) ?? DEFAULT_THOROUGH_SETTINGS.retries),
                            },
                          })}
                          disabled={isLoading}
                          className={styles.thoroughSettingInput}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress indicator during loading */}
          {isLoading && (() => {
            const phases = [
              { key: "quick-sweep", label: "Quick Sweep", shortLabel: "Quick" },
              { key: "standard", label: "Standard Scan", shortLabel: "Standard" },
              { key: "deep", label: "Deep Scan", shortLabel: "Deep" },
            ];
            const currentPhase = liveProgress?.phase || "";
            const currentPhaseIndex = phases.findIndex(p => currentPhase.includes(p.key));
            const totalIps = response?.summary?.totalChecked ?? 0;
            const scanned = liveProgress?.scannedCount ?? 0;
            const percent = totalIps > 0 ? Math.round((scanned / totalIps) * 100) : 0;
            
            return (
              <div className={styles.progressContainer}>
                {/* Phase Steps */}
                <div className={styles.phaseSteps}>
                  {phases.map((phase, idx) => {
                    const isActive = idx === currentPhaseIndex;
                    const isComplete = idx < currentPhaseIndex;
                    const isPending = idx > currentPhaseIndex;
                    return (
                      <div 
                        key={phase.key}
                        className={`${styles.phaseStep} ${isActive ? styles.phaseStepActive : ""} ${isComplete ? styles.phaseStepComplete : ""} ${isPending ? styles.phaseStepPending : ""}`}
                      >
                        <div className={styles.phaseStepIndicator}>
                          {isComplete ? "✓" : idx + 1}
                        </div>
                        <span className={styles.phaseStepLabel}>
                          <span className={styles.desktopText}>{phase.label}</span>
                          <span className={styles.mobileText}>{phase.shortLabel}</span>
                        </span>
                        {isActive && <span className={styles.phaseStepPulse} />}
                      </div>
                    );
                  })}
                </div>
                
                {/* Main Progress Bar */}
                <div className={styles.progressBarWrapper}>
                  <div className={styles.progressBarTrack}>
                    <div 
                      className={styles.progressBarFill}
                      style={{ width: `${Math.min(100, percent)}%` }}
                    />
                  </div>
                  <span className={styles.progressPercent}>{percent}%</span>
                </div>
                
                {/* Stats Row */}
                <div className={styles.progressStats}>
                  <div className={styles.progressStatMain}>
                    <span className={styles.progressStatValue}>{scanned}</span>
                    <span className={styles.progressStatLabel}>/ {totalIps} IPs scanned</span>
                  </div>
                  <div className={styles.progressStatsRight}>
                    <div className={`${styles.progressStat} ${styles.progressStatPanel}`}>
                      <span className={styles.progressStatIcon}>●</span>
                      <span className={styles.progressStatValue}>{liveProgress?.panelsFound ?? 0}</span>
                      <span className={styles.progressStatLabel}>panels</span>
                    </div>
                    <div className={`${styles.progressStat} ${styles.progressStatOther}`}>
                      <span className={styles.progressStatIcon}>○</span>
                      <span className={styles.progressStatValue}>{liveProgress?.notPanels ?? 0}</span>
                      <span className={styles.progressStatLabel}>other</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

              {/* Stream status */}
          {!isLoading && discoveredPanelIps.length > 0 && (
            <div className={styles.streamStatus}>
              <span className={isStreamConnected ? styles.statusConnected : styles.statusDisconnected}>
                {isStreamConnected
                      ? `● Live: ${liveConnectedCount}/${discoveredPanelIps.length} panels connected`
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

              {/* Error display */}
          {error && <div className={styles.errorBox}>{error}</div>}

              {/* Full results table and filters - only show when NOT loading */}
              {!isLoading && (
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
              )}
            </div>
          </div>

          {/* Placeholder: Favorite Switches Section */}
          <div className={styles.placeholderSection}>
            <div className={styles.placeholderSectionHeader}>
              <h3 className={styles.placeholderSectionTitle}>
                ⭐ Favorite Switches
                <span className={styles.placeholderBadge}>Coming Soon</span>
              </h3>
            </div>
            <div className={styles.placeholderContent}>
              <div className={styles.placeholderIcon}>🏠</div>
              <p>Create Zones and add your favorite switches for quick access.</p>
            </div>
          </div>

          {/* Placeholder: Smart Switches Section */}
          <div className={styles.placeholderSection}>
            <div className={styles.placeholderSectionHeader}>
              <h3 className={styles.placeholderSectionTitle}>
                🤖 Smart Switches
                <span className={styles.placeholderBadge}>Coming Soon</span>
              </h3>
            </div>
            <div className={styles.placeholderContent}>
              <div className={styles.placeholderIcon}>⚡</div>
              <p>Program automated sequences with toggles, clicks, and timers.</p>
            </div>
          </div>
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

