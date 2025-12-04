'use client';

import type { KeyboardEvent } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResponse, PanelInfo, LivePanelState } from "@/lib/discovery/types";

interface DiscoveryResultsProps {
  data: DiscoveryResponse | null;
  onPanelsSummaryClick?: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  panelInfoMap: Record<string, PanelInfo>;
  livePanelStates?: Map<string, LivePanelState>;
  showOnlyCubixx: boolean;
  showOnlyTouched: boolean;
  onShowOnlyCubixxChange: (value: boolean) => void;
  onShowOnlyTouchedChange: (value: boolean) => void;
}

// Short status indicators with icons
const statusConfig: Record<string, { icon: string; label: string; className: string }> = {
  panel: { icon: "●", label: "Panel", className: "statusPanel" },
  "not-panel": { icon: "○", label: "Other", className: "statusOther" },
  "no-response": { icon: "○", label: "None", className: "statusNone" },
  error: { icon: "⚠", label: "Error", className: "statusError" },
  pending: { icon: "◌", label: "Scan", className: "statusPending" },
  initial: { icon: "·", label: "", className: "statusInitial" },
};

export default function DiscoveryResults({
  data,
  onPanelsSummaryClick,
  searchQuery,
  onSearchChange,
  panelInfoMap,
  livePanelStates,
  showOnlyCubixx,
  showOnlyTouched,
  onShowOnlyCubixxChange,
  onShowOnlyTouchedChange,
}: DiscoveryResultsProps) {

  if (!data) {
    return null;
  }

  const { summary, results } = data;
  const canOpenPanelsView =
    typeof onPanelsSummaryClick === "function" && summary.panelsFound > 0;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredResults = results.filter((result) => {
    const metadata = panelInfoMap[result.ip];
    const isCubixx = metadata?.isCubixx ?? (result.status === "panel");

    if (showOnlyCubixx && !isCubixx) {
      return false;
    }

    if (showOnlyTouched && !metadata?.touched) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const name =
      metadata?.name?.toLowerCase() ?? result.name?.toLowerCase() ?? "";
    return (
      result.ip.toLowerCase().includes(normalizedQuery) ||
      name.includes(normalizedQuery)
    );
  });

  const handlePanelsSummaryKeyDown = (
    event: KeyboardEvent<HTMLDivElement>
  ) => {
    if (!canOpenPanelsView || !onPanelsSummaryClick) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPanelsSummaryClick();
    }
  };

  return (
    <>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryItem}>
          <h4>Total IPs checked</h4>
          <p className={styles.summaryAccent}>{summary.totalChecked}</p>
        </div>
        <div
          className={`${styles.summaryItem} ${
            canOpenPanelsView ? styles.summaryItemInteractive : ""
          }`}
          onClick={canOpenPanelsView ? onPanelsSummaryClick : undefined}
          onKeyDown={handlePanelsSummaryKeyDown}
          role={canOpenPanelsView ? "button" : undefined}
          tabIndex={canOpenPanelsView ? 0 : undefined}
          aria-disabled={!canOpenPanelsView}
        >
          <h4>Panels found</h4>
          <p className={styles.summaryPanel}>{summary.panelsFound}</p>
        </div>
        <div className={styles.summaryItem}>
          <h4>Non Cubixx (HTTP 200)</h4>
          <p className={styles.summaryNeutral}>{summary.notPanels}</p>
        </div>
        <div className={styles.summaryItem}>
          <h4>No response</h4>
          <p className={styles.summaryWarn}>{summary.noResponse}</p>
        </div>
        <div className={styles.summaryItem}>
          <h4>Errors</h4>
          <p className={styles.summaryWarn}>{summary.errors}</p>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <div className={styles.searchRow}>
          <label className={styles.searchLabel} htmlFor="results-search">
            Search
          </label>
          <input
            id="results-search"
            type="text"
            className={styles.searchInput}
            placeholder="Filter by IP or name"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className={styles.filtersRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showOnlyCubixx}
              onChange={(event) =>
                onShowOnlyCubixxChange(event.target.checked)
              }
            />
            Show only Live Cubixx panels
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showOnlyTouched}
              onChange={(event) =>
                onShowOnlyTouchedChange(event.target.checked)
              }
            />
            Show only touched panels
          </label>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>IP</th>
              <th>Name</th>
              <th>Status</th>
              <th>Live State</th>
              <th>Touched</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan={7}>No entries match that search.</td>
              </tr>
            ) : (
              filteredResults.map((result) => {
                const metadata = panelInfoMap[result.ip];
                const liveState = livePanelStates?.get(result.ip);
                const touched = metadata?.touched === true;
                const touchedClass = touched
                  ? styles.touchedYes
                  : styles.touchedNo;

                return (
                  <tr key={result.ip}>
                    <td>
                      {result.status === "panel" ? (
                        <a
                          href={`http://${result.ip}/`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.panelLink}
                        >
                          {result.ip}
                        </a>
                      ) : (
                        result.ip
                      )}
                    </td>
                    <td>
                      {liveState?.fullState?.hostname ?? metadata?.name ?? result.name ?? "—"}
                    </td>
                    <td>
                      {liveState?.connectionStatus === "connected" ? (
                        <span className={styles.statusLive}>● LIVE</span>
                      ) : (
                        <span className={styles[statusConfig[result.status]?.className ?? "statusNone"]}>
                          {statusConfig[result.status]?.icon ?? "○"} {statusConfig[result.status]?.label ?? "—"}
                        </span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState ? (
                        <div className={styles.entityStates}>
                          {liveState.fullState.relays.slice(0, 6).map((relay) => (
                            <span
                              key={`r${relay.index}`}
                              className={`${styles.entityBadge} ${relay.state ? styles.on : styles.off}`}
                              title={relay.name || `Relay ${relay.index + 1}`}
                            >
                              R{relay.index + 1}: {relay.state ? "ON" : "OFF"}
                            </span>
                          ))}
                          {liveState.fullState.curtains.slice(0, 4).map((curtain) => (
                            <span
                              key={`c${curtain.index}`}
                              className={`${styles.entityBadge} ${
                                curtain.state === "open" ? styles.open :
                                curtain.state === "closed" ? styles.closed : ""
                              }`}
                              title={curtain.name || `Curtain ${curtain.index + 1}`}
                            >
                              C{curtain.index + 1}: {curtain.state}
                            </span>
                          ))}
                          {liveState.fullState.relays.length > 6 && (
                            <span className={styles.entityBadge}>
                              +{liveState.fullState.relays.length - 6} more
                            </span>
                          )}
                        </div>
                      ) : result.status === "panel" ? (
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                          Connecting...
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={`${styles.touchedBadge} ${touchedClass}`}>
                        {touched ? "Yes" : "No"}
                      </span>
                    </td>
                    <td>{result.errorMessage ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

