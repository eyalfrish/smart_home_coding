'use client';

import { useCallback, useMemo, useState } from "react";
import DiscoveryForm, { type DiscoveryFormValues } from "./discovery-form";
import DiscoveryResults from "./discovery-results";
import AllPanelsView from "./all-panels-view";
import styles from "./discovery-dashboard.module.css";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoveryResult,
  PanelInfo,
  LivePanelState,
} from "@/lib/discovery/types";
import { usePanelStream } from "@/lib/hooks/use-panel-stream";

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
  const [view, setView] = useState<"discovery" | "panels-grid">("discovery");
  const [searchQuery, setSearchQuery] = useState("");
  const [formValues, setFormValues] =
    useState<DiscoveryFormValues>(INITIAL_FORM_VALUES);
  const [panelInfoMap, setPanelInfoMap] = useState<Record<string, PanelInfo>>(
    {}
  );
  const [showOnlyCubixx, setShowOnlyCubixx] = useState(true);
  const [showOnlyTouched, setShowOnlyTouched] = useState(false);

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

  // Real-time panel stream - only connect AFTER discovery is complete
  // This prevents constant reconnections during scanning
  const { isConnected: isStreamConnected, panelStates, error: streamError } = usePanelStream({
    ips: discoveredPanelIps,
    enabled: !isLoading && discoveredPanelIps.length > 0,
    onPanelState: handlePanelState,
  });

  const executeDiscovery = useCallback(
    async (payload: DiscoveryRequest) => {
      setIsLoading(true);
      setError(null);
      setView("discovery");
      setSearchQuery("");

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

      try {
        const url = `/api/discover/stream?baseIp=${encodeURIComponent(payload.baseIp)}&start=${payload.start}&end=${payload.end}`;
        const eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Ignore heartbeat messages (used to ensure connection is ready)
            if (message.type === "heartbeat") {
              return;
            }

            if (message.type === "result") {
              const result = message.data as DiscoveryResult;
              resultsMap.set(result.ip, result);

              // Update summary counts
              if (result.status === "panel") summary.panelsFound++;
              else if (result.status === "not-panel") summary.notPanels++;
              else if (result.status === "no-response") summary.noResponse++;
              else if (result.status === "error") summary.errors++;

              // Update panel info map for this result
              setPanelInfoMap((prev) => ({
                ...prev,
                [result.ip]: buildPanelInfoFromResult(result, undefined, { resetBaseline: true }),
              }));

              // Build ordered results array
              const orderedResults: DiscoveryResult[] = [];
              for (let octet = payload.start; octet <= payload.end; octet++) {
                const ip = `${payload.baseIp}.${octet}`;
                const existing = resultsMap.get(ip);
                if (existing) {
                  // Remove panelHtml for state storage
                  const { panelHtml, ...rest } = existing;
                  orderedResults.push(rest as DiscoveryResult);
                } else {
                  // Not yet scanned - show as initial/blank
                  orderedResults.push({
                    ip,
                    status: "initial",
                  });
                }
              }

              setResponse({
                summary: { ...summary },
                results: orderedResults,
              });
            } else if (message.type === "complete") {
              eventSource.close();
              setIsLoading(false);
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

    // Always reset to placeholder/scanning state when clicking Discover
    setResponse(buildPlaceholderResponse(payload));
    setPanelInfoMap({});

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

  const panelResults = response?.results ?? [];

  return (
    <div className={styles.card}>
      {view === "panels-grid" ? (
        <AllPanelsView
          panels={panelResults}
          onBack={handleBackToDiscovery}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      ) : (
        <>
          <DiscoveryForm
            values={formValues}
            disabled={isLoading}
            isLoading={isLoading}
            onChange={setFormValues}
            onSubmit={handleFormSubmit}
          />
          {discoveredPanelIps.length > 0 && (
            <div className={styles.streamStatus}>
              <span className={isStreamConnected ? styles.statusConnected : styles.statusDisconnected}>
                {isLoading
                  ? "○ Scanning network..."
                  : isStreamConnected
                    ? `● Live: ${panelStates.size}/${discoveredPanelIps.length} panels connected`
                    : "○ Connecting to panels..."}
              </span>
              {streamError && !isLoading && (
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
            onShowOnlyCubixxChange={setShowOnlyCubixx}
            onShowOnlyTouchedChange={setShowOnlyTouched}
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

