'use client';

import { useCallback, useEffect, useState } from "react";
import DiscoveryForm, { type DiscoveryFormValues } from "./discovery-form";
import DiscoveryResults from "./discovery-results";
import AllPanelsView from "./all-panels-view";
import styles from "./discovery-dashboard.module.css";
import type {
  DiscoveryRequest,
  DiscoveryResponse,
  DiscoveryResult,
  PanelInfo,
} from "@/lib/discovery/types";
import { computePanelFingerprint } from "@/lib/discovery/panel-fingerprint";

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
      status: "pending" as const,
      errorMessage: "Scanning…",
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [view, setView] = useState<"discovery" | "panels-grid">("discovery");
  const [searchQuery, setSearchQuery] = useState("");
  const [formValues, setFormValues] =
    useState<DiscoveryFormValues>(INITIAL_FORM_VALUES);
  const [lastRequest, setLastRequest] = useState<DiscoveryRequest | null>(null);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0);
  const [panelInfoMap, setPanelInfoMap] = useState<Record<string, PanelInfo>>(
    {}
  );
  const [showOnlyCubixx, setShowOnlyCubixx] = useState(false);
  const [showOnlyTouched, setShowOnlyTouched] = useState(false);

  const executeDiscovery = useCallback(
    async (payload: DiscoveryRequest, options?: { background?: boolean }) => {
      const isBackground = options?.background ?? false;
      if (!isBackground) {
        setIsLoading(true);
        setError(null);
        setView("discovery");
        setSearchQuery("");
        setPanelInfoMap({});
      } else {
        setIsRefreshing(true);
      }

      setLastRequest(payload);

      try {
        const res = await fetch("/api/discover", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          let message = "Failed to reach discovery service.";
          try {
            const body = await res.json();
            if (body?.message) {
              message = body.message;
            }
          } catch {
            // ignore JSON parse issues here
          }
          throw new Error(message);
        }

        const body = (await res.json()) as DiscoveryResponse;
        setPanelInfoMap((prev) =>
          mergePanelInfoState(body.results, prev, {
            resetBaselines: !isBackground,
          })
        );
        const sanitizedResults = body.results.map(({ panelHtml, ...rest }) => rest) as DiscoveryResult[];
        setResponse({
          summary: body.summary,
          results: sanitizedResults,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unexpected error occurred.";
        if (!isBackground) {
          setError(message);
        } else {
          console.warn("Background refresh failed:", message);
        }
      } finally {
        if (!isBackground) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
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

    const rangeChanged =
      !response ||
      response.summary.baseIp !== payload.baseIp ||
      response.summary.start !== payload.start ||
      response.summary.end !== payload.end;

    if (rangeChanged) {
      setResponse(buildPlaceholderResponse(payload));
    }

    executeDiscovery(payload);
  };

  useEffect(() => {
    if (
      !autoRefreshSeconds ||
      autoRefreshSeconds <= 0 ||
      !lastRequest ||
      isLoading ||
      isRefreshing
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!lastRequest) {
        return;
      }
      executeDiscovery(lastRequest, { background: true });
    }, autoRefreshSeconds * 1000);

    return () => window.clearInterval(interval);
  }, [
    autoRefreshSeconds,
    lastRequest,
    isLoading,
    isRefreshing,
    executeDiscovery,
  ]);

  const handleAutoRefreshChange = (value: string) => {
    const next = Number(value);
    if (Number.isNaN(next)) {
      setAutoRefreshSeconds(0);
      return;
    }
    setAutoRefreshSeconds(Math.max(0, Math.floor(next)));
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
          <div className={styles.refreshControls}>
            <label className={styles.refreshLabel} htmlFor="auto-refresh">
              Auto refresh (seconds)
            </label>
            <input
              id="auto-refresh"
              type="number"
              min={0}
              className={styles.refreshInput}
              value={autoRefreshSeconds}
              onChange={(event) => handleAutoRefreshChange(event.target.value)}
            />
            <span className={styles.refreshHint}>
              {autoRefreshSeconds > 0
                ? `Refreshing every ${autoRefreshSeconds}s`
                : "Enter 0 to disable auto refresh"}
            </span>
            {isRefreshing && (
              <span className={styles.status}>Auto-refreshing…</span>
            )}
          </div>
          {error && <div className={styles.errorBox}>{error}</div>}
          <DiscoveryResults
            data={response}
            onPanelsSummaryClick={handlePanelsSummaryClick}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            panelInfoMap={panelInfoMap}
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
  const hasPanelHtml = Boolean(isCubixx && result.panelHtml);

  let baselineFingerprint = previous?.baselineFingerprint ?? null;
  let lastFingerprint = previous?.lastFingerprint ?? null;
  let touched = previous?.touched ?? false;

  if (shouldReset || !previous) {
    if (hasPanelHtml && result.panelHtml) {
      const fingerprint = computePanelFingerprint(result.panelHtml);
      baselineFingerprint = fingerprint;
      lastFingerprint = fingerprint;
    } else {
      baselineFingerprint = null;
      lastFingerprint = null;
    }
    touched = false;
  } else if (hasPanelHtml && result.panelHtml) {
    const fingerprint = computePanelFingerprint(result.panelHtml);
    if (!baselineFingerprint) {
      baselineFingerprint = fingerprint;
    } else if (fingerprint !== baselineFingerprint) {
      touched = true;
    }
    lastFingerprint = fingerprint;
  }

  return {
    ip: result.ip,
    isCubixx,
    name: resolvedName ?? undefined,
    link,
    baselineFingerprint,
    lastFingerprint,
    touched,
  };
}

