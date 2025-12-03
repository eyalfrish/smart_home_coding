'use client';

import type { KeyboardEvent } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResponse, PanelInfo } from "@/lib/discovery/types";

interface DiscoveryResultsProps {
  data: DiscoveryResponse | null;
  onPanelsSummaryClick?: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  panelInfoMap: Record<string, PanelInfo>;
  showOnlyCubixx: boolean;
  showOnlyTouched: boolean;
  onShowOnlyCubixxChange: (value: boolean) => void;
  onShowOnlyTouchedChange: (value: boolean) => void;
}

const statusLabel: Record<string, string> = {
  panel: "Panel detected",
  "not-panel": "Not Cubixx",
  "no-response": "No response",
  error: "Error",
  pending: "Scanning…",
};

const badgeClass: Record<string, string> = {
  panel: styles.badgePanel,
  "not-panel": styles.badgeNotPanel,
  "no-response": styles.badgeNoResponse,
  error: styles.badgeError,
  pending: styles.badgePending,
};

export default function DiscoveryResults({
  data,
  onPanelsSummaryClick,
  searchQuery,
  onSearchChange,
  panelInfoMap,
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
            Show only Cubixx panels
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
              <th>Touched</th>
              <th>HTTP</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan={6}>No entries match that search.</td>
              </tr>
            ) : (
              filteredResults.map((result) => {
                const metadata = panelInfoMap[result.ip];
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
                    <td>{metadata?.name ?? result.name ?? "—"}</td>
                    <td>
                      <span
                        className={`${styles.badge} ${
                          badgeClass[result.status]
                        }`}
                      >
                        {statusLabel[result.status]}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.touchedBadge} ${touchedClass}`}>
                        {touched ? "Yes" : "No"}
                      </span>
                    </td>
                    <td>{result.httpStatus ?? "—"}</td>
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

