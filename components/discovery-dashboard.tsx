'use client';

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import DiscoveryForm, { type DiscoveryFormValues, type IpRange, type ThoroughSettings, createDefaultRange, validateFormRanges, DEFAULT_THOROUGH_SETTINGS } from "./discovery-form";
import DiscoveryResults from "./discovery-results";
import AllPanelsView from "./all-panels-view";
import BatchOperationsView from "./batch-operations-view";
import ProfilePicker, { type FullProfile, type DashboardSection, type FullscreenSection, DEFAULT_SECTION_ORDER } from "./profile-picker";
import FavoritesSection, { type FavoritesData, type SmartSwitchesData } from "./favorites-section";
import styles from "./discovery-dashboard.module.css";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoveryResult,
  DiscoverySummary,
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

interface ControlModeDiscoverySummary {
  totalChecked: number;
  panelsFound: number;
  noResponse: number;
  notPanels: number;
  errors: number;
}

interface DiscoveryDashboardProps {
  initialFavoritesFullscreen?: boolean;
  onFavoritesFullscreenConsumed?: () => void;
  skipAutoDiscovery?: boolean;
  /** Panel IPs discovered in Control mode - used to populate discovery results */
  controlModeDiscoveredIps?: string[];
  /** Discovery summary from Control mode - includes counts for no-response, etc. */
  controlModeDiscoverySummary?: ControlModeDiscoverySummary | null;
  /** Full discovery results from Control mode - includes settings (logging, longPressMs) */
  controlModeDiscoveryResults?: DiscoveryResult[];
  /** Live panel states from Control mode - used to get panel names */
  controlModePanelStates?: Map<string, LivePanelState>;
  /** Callback when discovery completes - to sync state with page.tsx */
  onDiscoveryComplete?: (discoveredIps: string[], summary: DiscoverySummary, forProfileId: number, results?: DiscoveryResult[]) => void;
  /** Callback when a profile is made default - to cache discovery results */
  onProfileMadeDefault?: (profileId: number | null) => void;
}

export default function DiscoveryDashboard({ 
  initialFavoritesFullscreen = false,
  onFavoritesFullscreenConsumed,
  skipAutoDiscovery = false,
  controlModeDiscoveredIps = [],
  controlModeDiscoverySummary,
  controlModeDiscoveryResults = [],
  controlModePanelStates,
  onDiscoveryComplete,
  onProfileMadeDefault,
}: DiscoveryDashboardProps = {}) {
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
  
  // Selected profile (full profile data for favorites section)
  const [selectedProfile, setSelectedProfile] = useState<FullProfile | null>(null);
  
  // Section order for drag-and-drop reordering
  const [sectionOrder, setSectionOrder] = useState<DashboardSection[]>([...DEFAULT_SECTION_ORDER]);
  
  // Fullscreen section state - when set, only profile and this section are visible
  const [fullscreenSection, setFullscreenSection] = useState<FullscreenSection>(
    initialFavoritesFullscreen ? 'favorites' : null
  );
  
  
  // Drag state
  const [draggedSection, setDraggedSection] = useState<DashboardSection | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ section: DashboardSection; position: 'before' | 'after' } | null>(null);
  
  // Edit mode - controls whether drag-and-drop is enabled
  const [editMode, setEditMode] = useState(false);
  
  // Track if registry has been reset
  const [registryReady, setRegistryReady] = useState(false);
  
  // Track if discovery has completed at least once (for validation)
  const [discoveryCompleted, setDiscoveryCompleted] = useState(false);
  
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
  
  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Handle initial favorites fullscreen prop - use a longer-lived flag
  const initialFullscreenAppliedRef = useRef(false);
  
  useEffect(() => {
    if (initialFavoritesFullscreen && !initialFullscreenAppliedRef.current) {
      console.log('[Dashboard] Setting fullscreen to favorites from initial prop');
      setFullscreenSection('favorites');
      initialFullscreenAppliedRef.current = true;
      // Notify parent that we've consumed the prop
      onFavoritesFullscreenConsumed?.();
    }
  }, [initialFavoritesFullscreen, onFavoritesFullscreenConsumed]);

  // Reset panel registry on mount and check server session
  // Only reset discovery if NOT coming from Control mode (skipAutoDiscovery indicates we came from Control)
  useEffect(() => {
    // Only clear discovery state on fresh page load, not when switching from Control mode
    if (!skipAutoDiscovery) {
      console.log('[Dashboard] Mount: clearing discovery state (fresh load)');
      setResponse(null);
      setPanelInfoMap({});
      setSelectedPanelIps(new Set());
    } else {
      console.log('[Dashboard] Mount: preserving discovery state (came from Control mode)');
    }
    
    setServerSessionId(null); // Always refresh session
    
    const checkServerAndReset = async () => {
      try {
        // Get current server session
        const sessionRes = await fetch('/api/session');
        const { sessionId } = await sessionRes.json();
        
        // Save current session ID
        sessionStorage.setItem('serverSessionId', sessionId);
        setServerSessionId(sessionId);
        console.log('[Dashboard] Server session:', sessionId);
        
        // Only reset registry on fresh load
        if (!skipAutoDiscovery) {
          const resetRes = await fetch('/api/panels/reset', { method: 'POST' });
          const resetData = await resetRes.json();
          console.log('[Dashboard] Registry reset:', resetData.message);
        }
        setRegistryReady(true);
      } catch (err) {
        console.error('[Dashboard] Failed to check session/reset registry:', err);
        setRegistryReady(true); // Continue anyway
      }
    };
    
    checkServerAndReset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Track what IPs we've populated from control mode to detect changes
  const lastPopulatedIpsRef = useRef<string>('');
  
  // Populate discovery results from Control mode data
  useEffect(() => {
    if (!skipAutoDiscovery || controlModeDiscoveredIps.length === 0) {
      return;
    }
    
    // Create a fingerprint of the current control mode IPs to detect changes
    const currentIpsFingerprint = controlModeDiscoveredIps.slice().sort().join(',');
    
    // Skip if we've already populated with this exact set of IPs
    if (lastPopulatedIpsRef.current === currentIpsFingerprint) {
      return;
    }
    
    // Check if we already have a response with settings data for these IPs
    // This happens when we previously ran discovery in AdminView, then switched to Control and back
    const existingResultsMap = new Map<string, DiscoveryResult>();
    if (response?.results) {
      for (const r of response.results) {
        existingResultsMap.set(r.ip, r);
      }
    }
    
    // Check if existing results have settings - if so, preserve them
    const existingHasSettings = response?.results?.some(r => r.settings?.logging !== undefined || r.settings?.longPressMs !== undefined);
    const existingIpsMatch = controlModeDiscoveredIps.every(ip => existingResultsMap.has(ip) && existingResultsMap.get(ip)?.status === 'panel');
    
    if (existingHasSettings && existingIpsMatch) {
      console.log('[Dashboard] Preserving existing discovery results with settings data');
      lastPopulatedIpsRef.current = currentIpsFingerprint;
      // Only update discovery completed state, keep existing response
      setDiscoveryCompleted(true);
      return;
    }
    
    console.log('[Dashboard] Populating discovery from Control mode:', controlModeDiscoveredIps.length, 'panels', 'summary:', controlModeDiscoverySummary, 'total results from page.tsx:', controlModeDiscoveryResults.length, 'with settings:', controlModeDiscoveryResults.filter(r => r.settings).length);
    lastPopulatedIpsRef.current = currentIpsFingerprint;
    
    // Build a map of passed results from page.tsx (these include ALL statuses: panel, no-response, not-panel, error)
    const passedResultsMap = new Map<string, DiscoveryResult>();
    for (const r of controlModeDiscoveryResults) {
      passedResultsMap.set(r.ip, r);
    }
    
    // Use ALL results from controlModeDiscoveryResults as the primary source
    // This includes panels, no-response, not-panel, and error entries
    // Only enrich panel entries with live state names
    const results: DiscoveryResult[] = controlModeDiscoveryResults.map(passedResult => {
      // For panel entries, enrich with live state name if available
      if (passedResult.status === 'panel') {
        const liveState = controlModePanelStates?.get(passedResult.ip);
        const panelName = liveState?.fullState?.mqttDeviceName || null;
        return {
          ...passedResult,
          name: panelName || passedResult.name, // Prefer live name
        };
      }
      // For non-panel entries (no-response, not-panel, error), return as-is
      return passedResult;
    });
    
    // If controlModeDiscoveryResults is empty but we have discovered IPs,
    // fall back to creating minimal panel entries (backward compatibility)
    if (results.length === 0 && controlModeDiscoveredIps.length > 0) {
      for (const ip of controlModeDiscoveredIps) {
        const liveState = controlModePanelStates?.get(ip);
        const panelName = liveState?.fullState?.mqttDeviceName || null;
        
        // Check existing results first
        const existingResult = existingResultsMap.get(ip);
        if (existingResult) {
          results.push({
            ...existingResult,
            name: panelName || existingResult.name,
          });
        } else {
          // Create minimal panel result
          results.push({
            ip,
            status: 'panel' as const,
            name: panelName,
          });
        }
      }
    }
    
    // Use the summary from Control mode if available, otherwise create a basic one
    const summary = controlModeDiscoverySummary ? {
      baseIp: '',
      start: 0,
      end: 0,
      totalChecked: controlModeDiscoverySummary.totalChecked,
      panelsFound: controlModeDiscoverySummary.panelsFound,
      notPanels: controlModeDiscoverySummary.notPanels,
      noResponse: controlModeDiscoverySummary.noResponse,
      errors: controlModeDiscoverySummary.errors,
    } : {
      baseIp: '',
      start: 0,
      end: 0,
      totalChecked: controlModeDiscoveredIps.length,
      panelsFound: controlModeDiscoveredIps.length,
      notPanels: 0,
      noResponse: 0,
      errors: 0,
    };
    
    // Create a discovery response with summary
    const newResponse: DiscoveryResponse = {
      summary,
      results,
    };
    setResponse(newResponse);
    setDiscoveryCompleted(true);
    
    // Also populate panel info map for live updates
    const newPanelInfoMap: Record<string, PanelInfo> = {};
    for (const ip of controlModeDiscoveredIps) {
      const liveState = controlModePanelStates?.get(ip);
      newPanelInfoMap[ip] = {
        ip,
        isCubixx: true,
        name: liveState?.fullState?.mqttDeviceName,
      };
    }
    setPanelInfoMap(newPanelInfoMap);
  }, [skipAutoDiscovery, controlModeDiscoveredIps, controlModeDiscoverySummary, controlModeDiscoveryResults, controlModePanelStates, response]);

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
          setDiscoveryCompleted(true); // Mark discovery as completed for validation
          
          // Notify parent of discovered panel IPs and summary - this syncs state with page.tsx
          // IMPORTANT: Use discoveryProfileIdRef.current instead of selectedProfile?.id
          // because selectedProfile state might be stale due to async updates
          let panels = 0, notPanels = 0, noResp = 0, errs = 0;
          const discoveredPanelIps: string[] = [];
          for (const result of resultsMap.values()) {
            if (result.status === 'panel') { panels++; discoveredPanelIps.push(result.ip); }
            else if (result.status === 'not-panel') notPanels++;
            else if (result.status === 'no-response' || result.status === 'pending') noResp++;
            else if (result.status === 'error') errs++;
          }
          const completeSummary: DiscoverySummary = {
            baseIp: firstReq.baseIp,
            start: firstReq.start,
            end: requests[requests.length - 1].end,
            totalChecked: allIps.length,
            panelsFound: panels,
            notPanels: notPanels,
            noResponse: noResp,
            errors: errs,
          };
          const profileIdForCallback = discoveryProfileIdRef.current ?? selectedProfile?.id;
          
          // Build final results array with settings
          const finalResults: DiscoveryResult[] = [];
          for (const result of resultsMap.values()) {
            finalResults.push(result);
          }
          
          console.log('[Dashboard] Discovery complete, notifying parent:', discoveredPanelIps.length, 'panels', 'summary:', completeSummary, 'results with settings:', finalResults.filter(r => r.settings).length, 'for profile:', profileIdForCallback);
          if (profileIdForCallback) {
            onDiscoveryComplete?.(discoveredPanelIps, completeSummary, profileIdForCallback, finalResults);
          }
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
    [formValues.thoroughMode, formValues.thoroughSettings, onDiscoveryComplete, selectedProfile]
  );

  const handleFormSubmit = () => {
    // Convert form ranges to discovery requests
    const requests: DiscoveryRequest[] = formValues.ranges.map(rangeToRequest);
    
    // Set the discovery profile ID ref to current selected profile
    // (This handles manual form submit, not profile switch)
    discoveryProfileIdRef.current = selectedProfile?.id ?? null;
    
    // Stay collapsed during discovery - user can expand if they want
    // State clearing is now done inside executeDiscovery to avoid race conditions
    executeDiscovery(requests);
  };

  // Track the profile ID that discovery is running for (to avoid stale closure issues)
  const discoveryProfileIdRef = useRef<number | null>(null);
  
  // Handle profile selection - load IP ranges and trigger discovery
  const handleProfileSelect = useCallback((profileId: number, ranges: IpRange[], fullProfile: FullProfile) => {
    // Store the profile ID in a ref for the discovery callback to use
    discoveryProfileIdRef.current = profileId;
    
    setSelectedProfile(fullProfile);
    setFormValues(prev => ({
      ...prev,
      ranges,
    }));
    // Load section order from profile
    if (fullProfile.section_order && fullProfile.section_order.length === DEFAULT_SECTION_ORDER.length) {
      setSectionOrder(fullProfile.section_order);
    }
    // Load fullscreen section from profile - but don't override if we applied initialFavoritesFullscreen
    if (!initialFullscreenAppliedRef.current) {
      setFullscreenSection(fullProfile.fullscreen_section ?? null);
    } else {
      console.log('[Dashboard] Preserving fullscreen from initialFavoritesFullscreen');
    }
    // Collapse IP ranges section after loading profile
    setIsIpRangesExpanded(false);
  }, []);

  // Handle profile clear - reset to defaults when no profile selected or profile deleted
  const handleProfileClear = useCallback(() => {
    setSelectedProfile(null);
    setFormValues(INITIAL_FORM_VALUES);
    // Clear discovery results
    setResponse(null);
    setPanelInfoMap({});
    setSelectedPanelIps(new Set());
    setDiscoveryCompleted(false);
    // Reset section order to default
    setSectionOrder([...DEFAULT_SECTION_ORDER]);
    // Reset fullscreen mode
    setFullscreenSection(null);
  }, []);

  // Handle showing toast notifications
  const handleShowToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Trigger discovery after profile load - receives ranges directly to avoid state timing issues
  const handleTriggerDiscoveryFromProfile = useCallback((ranges: IpRange[]) => {
    // Validate the provided ranges
    const validation = validateFormRanges(ranges);
    if (validation.canSubmit) {
      const requests: DiscoveryRequest[] = ranges.map(rangeToRequest);
      executeDiscovery(requests);
    }
  }, [executeDiscovery]);

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

  // Handle favorites update - update local state only (saved via Save button in ProfilePicker)
  const handleFavoritesUpdate = useCallback((profileId: number, favorites: FavoritesData) => {
    console.log('[Dashboard] Updating local favorites for profile:', profileId, favorites);
    setSelectedProfile(prev => prev ? { ...prev, favorites } : null);
  }, []);

  // Handle smart switches update - update local state only
  const handleSmartSwitchesUpdate = useCallback((profileId: number, smartSwitches: SmartSwitchesData) => {
    console.log('[Dashboard] Updating local smart_switches for profile:', profileId, smartSwitches);
    setSelectedProfile(prev => prev ? { ...prev, smart_switches: smartSwitches } : null);
  }, []);

  // =============================================================================
  // Drag and Drop Handlers for Section Reordering
  // =============================================================================

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, section: DashboardSection) => {
    setDraggedSection(section);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', section);
    
    // Create custom drag image
    const dragTarget = e.currentTarget;
    if (dragTarget) {
      // Use a timeout to apply dragging styles after the drag image is captured
      setTimeout(() => {
        dragTarget.classList.add(styles.dragging);
      }, 0);
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    setDraggedSection(null);
    setDropIndicator(null);
    e.currentTarget.classList.remove(styles.dragging);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, section: DashboardSection) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (!draggedSection || draggedSection === section) return;
    
    // Determine if dropping before or after based on mouse Y position
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position: 'before' | 'after' = e.clientY < midY ? 'before' : 'after';
    
    setDropIndicator({ section, position });
  }, [draggedSection]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear if we're leaving the section entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDropIndicator(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, targetSection: DashboardSection) => {
    e.preventDefault();
    
    if (!draggedSection || !dropIndicator || draggedSection === targetSection) {
      setDropIndicator(null);
      setDraggedSection(null);
      return;
    }

    setSectionOrder(prev => {
      const newOrder = [...prev];
      const draggedIndex = newOrder.indexOf(draggedSection);
      let targetIndex = newOrder.indexOf(targetSection);
      
      if (draggedIndex === -1 || targetIndex === -1) return prev;
      
      // Adjust target index based on position
      if (dropIndicator.position === 'after') {
        targetIndex += 1;
      }
      
      // Adjust for removal of dragged item
      if (draggedIndex < targetIndex) {
        targetIndex -= 1;
      }
      
      // If no actual change, return original
      if (draggedIndex === targetIndex) return prev;
      
      // Remove from old position and insert at new position
      const [removed] = newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, removed);
      
      console.log('[Dashboard] Section order changed:', newOrder);
      return newOrder;
    });

    setDropIndicator(null);
    setDraggedSection(null);
  }, [draggedSection, dropIndicator]);

  // Section labels for display
  const sectionLabels: Record<DashboardSection, string> = {
    'profile': '👤 Profile',
    'ip-ranges': '🌐 IP Ranges',
    'discovery': '🔍 Panel Discovery',
    'favorites': '⭐ Favorites',
  };

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
          {/* Discovery Progress Banner - show when discovering */}
          {isLoading && (
            <div className={styles.discoveryProgressBanner}>
              <div className={styles.discoveryProgressBannerContent}>
                <div className={styles.discoveryProgressSpinner} />
                <span className={styles.discoveryProgressText}>
                  Discovering... <strong>{liveProgress?.panelsFound ?? 0}</strong> panels found
                  {liveProgress?.scannedCount ? ` (${liveProgress.scannedCount} IPs scanned)` : ''}
                </span>
              </div>
            </div>
          )}
          
          {/* Render sections in the configured order */}
          {sectionOrder.map((section) => {
            // In fullscreen mode, only show 'profile' and the fullscreen section
            if (fullscreenSection !== null) {
              if (section !== 'profile' && section !== fullscreenSection) {
                return null;
              }
            }
            
            const isDragging = draggedSection === section;
            const showDropBefore = dropIndicator?.section === section && dropIndicator?.position === 'before' && draggedSection !== section;
            const showDropAfter = dropIndicator?.section === section && dropIndicator?.position === 'after' && draggedSection !== section;
            
            // Check if this section is in fullscreen mode
            const isThisSectionFullscreen = fullscreenSection === section;
            
            // Draggable wrapper for each section
            const wrapSection = (content: React.ReactNode, sectionId: DashboardSection) => {
              // Hide drag handle when in fullscreen mode or edit mode is disabled
              const hideDragHandle = fullscreenSection !== null || !editMode;
              // Only allow dragging when edit mode is enabled and not in fullscreen
              const canDrag = editMode && !isLoading && !fullscreenSection;
              
              return (
                <div
                  key={sectionId}
                  className={`${styles.draggableSection} ${isDragging ? styles.dragging : ''} ${showDropBefore ? styles.draggableSectionDropBefore : ''} ${showDropAfter ? styles.draggableSectionDropAfter : ''} ${isThisSectionFullscreen ? styles.draggableSectionFullscreen : ''}`}
                  draggable={canDrag}
                  onDragStart={(e) => handleDragStart(e, sectionId)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, sectionId)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, sectionId)}
                >
                  {/* Drag handle - hide in fullscreen mode or when not in edit mode */}
                  {!hideDragHandle && (
                    <div className={styles.dragHandle} title="Drag to reorder sections">
                      <span className={styles.dragHandleIcon}>⋮⋮</span>
                    </div>
                  )}
                  <div className={styles.draggableSectionContent}>
                    {content}
                  </div>
                </div>
              );
            };
            
            switch (section) {
              case 'profile':
                return wrapSection(
                  <ProfilePicker
                    currentRanges={formValues.ranges}
                    currentFavorites={selectedProfile?.favorites || {}}
                    currentSmartSwitches={selectedProfile?.smart_switches || {}}
                    currentSectionOrder={sectionOrder}
                    currentFullscreenSection={fullscreenSection}
                    onProfileSelect={handleProfileSelect}
                    onTriggerDiscovery={handleTriggerDiscoveryFromProfile}
                    onProfileClear={handleProfileClear}
                    onShowToast={handleShowToast}
                    isLoading={isLoading}
                    disabled={isLoading}
                    skipAutoDiscovery={skipAutoDiscovery}
                    onProfileMadeDefault={onProfileMadeDefault}
                  />,
                  section
                );

              case 'ip-ranges':
                return wrapSection(
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
                  />,
                  section
                );

              case 'discovery':
                // Auto-expand when in fullscreen mode
                const isDiscoveryFullscreen = fullscreenSection === 'discovery';
                const isDiscoveryExpanded = isDiscoveryFullscreen || isPanelDiscoveryExpanded;
                return wrapSection(
                  <div className={`${styles.collapsibleSection} ${isDiscoveryExpanded ? styles.collapsibleSectionExpanded : ""} ${isDiscoveryFullscreen ? styles.collapsibleSectionFullscreen : ""}`}>
            {/* Header - always visible, entire header is clickable */}
            <div 
              className={styles.collapsibleSectionHeader}
              onClick={() => setIsPanelDiscoveryExpanded(!isPanelDiscoveryExpanded)}
              style={{ cursor: "pointer" }}
            >
              <div className={styles.collapsibleSectionHeaderLeft}>
                <span className={styles.collapsibleSectionToggle}>
                  {isDiscoveryExpanded ? "▼" : "▶"}
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
                {!isDiscoveryExpanded && (
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
                <button
                  type="button"
                  className={`${styles.fullscreenToggleButton} ${fullscreenSection === 'discovery' ? styles.fullscreenToggleButtonActive : ''}`}
                  onClick={() => setFullscreenSection(fullscreenSection === 'discovery' ? null : 'discovery')}
                  title={fullscreenSection === 'discovery' ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
                >
                  {fullscreenSection === 'discovery' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Summary stats row - visible when collapsed AND (has data OR is loading) */}
            {!isDiscoveryExpanded && (showCollapsedSummary || isLoading) && (
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
          </div>,
                  section
                );

              case 'favorites':
                return wrapSection(
                  <FavoritesSection
                    profile={selectedProfile ? {
                      id: selectedProfile.id,
                      name: selectedProfile.name,
                      favorites: selectedProfile.favorites,
                      smart_switches: selectedProfile.smart_switches,
                    } : null}
                    discoveredPanelIps={new Set(discoveredPanelIps)}
                    isLoading={isLoading}
                    discoveryCompleted={discoveryCompleted}
                    livePanelStates={panelStates}
                    discoveredPanels={response?.results || []}
                    onFavoritesUpdate={handleFavoritesUpdate}
                    onSmartSwitchesUpdate={handleSmartSwitchesUpdate}
                    isFullscreen={fullscreenSection === 'favorites'}
                    onFullscreenToggle={() => setFullscreenSection(fullscreenSection === 'favorites' ? null : 'favorites')}
                  />,
                  section
                );

              default:
                return null;
            }
          })}
        </>
      )}
      
      {/* Edit Mode Toggle - floating button when not in fullscreen */}
      {!fullscreenSection && (
        <button
          type="button"
          className={`${styles.editModeToggle} ${editMode ? styles.editModeToggleActive : ''}`}
          onClick={() => setEditMode(!editMode)}
          title={editMode ? 'Exit edit mode (disable drag & drop)' : 'Enter edit mode (enable drag & drop)'}
        >
          {editMode ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span className={styles.editModeLabel}>Done</span>
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span className={styles.editModeLabel}>Edit Layout</span>
            </>
          )}
        </button>
      )}
      
      {/* Toast Notification */}
      {toast && (
        <div 
          className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}
          onClick={() => setToast(null)}
        >
          <span className={styles.toastIcon}>
            {toast.type === 'success' ? '✓' : '✕'}
          </span>
          <span className={styles.toastMessage}>{toast.message}</span>
        </div>
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

