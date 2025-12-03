'use client';

import type { KeyboardEvent } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResponse } from "@/lib/discovery/types";

interface DiscoveryResultsProps {
  data: DiscoveryResponse | null;
  onPanelsSummaryClick?: () => void;
}

const statusLabel: Record<string, string> = {
  panel: "Panel detected",
  "not-panel": "Not Cubixx",
  "no-response": "No response",
  error: "Error",
};

const badgeClass: Record<string, string> = {
  panel: styles.badgePanel,
  "not-panel": styles.badgeNotPanel,
  "no-response": styles.badgeNoResponse,
  error: styles.badgeError,
};

export default function DiscoveryResults({
  data,
  onPanelsSummaryClick,
}: DiscoveryResultsProps) {
  if (!data) {
    return null;
  }

  const { summary, results } = data;
  const canOpenPanelsView =
    typeof onPanelsSummaryClick === "function" && summary.panelsFound > 0;

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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>IP</th>
              <th>Name</th>
              <th>Status</th>
              <th>HTTP</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.ip}>
                <td>{result.ip}</td>
                <td>{result.name ?? "—"}</td>
                <td>
                  <span className={`${styles.badge} ${badgeClass[result.status]}`}>
                    {statusLabel[result.status]}
                  </span>
                </td>
                <td>{result.httpStatus ?? "—"}</td>
                <td>{result.errorMessage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

