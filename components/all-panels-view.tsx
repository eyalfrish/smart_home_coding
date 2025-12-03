'use client';

import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResult } from "@/lib/discovery/types";

interface AllPanelsViewProps {
  panels: DiscoveryResult[];
  onBack: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

export default function AllPanelsView({
  panels,
  onBack,
  searchQuery,
  onSearchChange,
}: AllPanelsViewProps) {
  const cubixxPanels = panels.filter((panel) => panel.status === "panel");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredPanels = cubixxPanels.filter((panel) => {
    if (!normalizedQuery) {
      return true;
    }
    const name = panel.name?.toLowerCase() ?? "";
    return (
      panel.ip.toLowerCase().includes(normalizedQuery) ||
      name.includes(normalizedQuery)
    );
  });
  const count = filteredPanels.length;
  const hasAnyPanels = cubixxPanels.length > 0;

  return (
    <div className={styles.panelsView}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        ← Back to discovery
      </button>
      <div className={styles.panelsHeader}>
        <h2>All Cubixx Panels</h2>
        <p>{count === 1 ? "1 panel shown" : `${count} panels shown`}</p>
      </div>
      <div className={styles.searchRow}>
        <label className={styles.searchLabel} htmlFor="panels-search">
          Search
        </label>
        <input
          id="panels-search"
          type="text"
          className={styles.searchInput}
          placeholder="Filter by IP or name"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      {count === 0 ? (
        <div className={styles.emptyPanelsState}>
          {normalizedQuery || hasAnyPanels
            ? "No panels match that search. Clear the filter or run a new discovery."
            : "No panels available. Run a discovery scan first."}
        </div>
      ) : (
        <div className={styles.panelGrid}>
          {filteredPanels.map((panel) => (
            <div key={panel.ip} className={styles.panelCard}>
              <div className={styles.panelCardHeader}>
                <h3>{panel.name ?? "Unnamed panel"}</h3>
                <span>{panel.ip}</span>
              </div>
              <iframe
                src={`http://${panel.ip}/`}
                title={`${panel.name ?? panel.ip} panel`}
                loading="lazy"
                className={styles.panelFrame}
              />
              <button
                type="button"
                className={styles.openPanelButton}
                onClick={() => window.open(`http://${panel.ip}/`, "_blank")}
              >
                Open panel in new tab
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

