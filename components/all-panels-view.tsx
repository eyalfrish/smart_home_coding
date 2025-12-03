'use client';

import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResult } from "@/lib/discovery/types";

interface AllPanelsViewProps {
  panels: DiscoveryResult[];
  onBack: () => void;
}

export default function AllPanelsView({ panels, onBack }: AllPanelsViewProps) {
  const cubixxPanels = panels.filter((panel) => panel.status === "panel");
  const count = cubixxPanels.length;

  return (
    <div className={styles.panelsView}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        ← Back to discovery
      </button>
      <div className={styles.panelsHeader}>
        <h2>All Cubixx Panels</h2>
        <p>{count === 1 ? "1 panel shown" : `${count} panels shown`}</p>
      </div>
      {count === 0 ? (
        <div className={styles.emptyPanelsState}>
          No panels available. Run a discovery scan first.
        </div>
      ) : (
        <div className={styles.panelGrid}>
          {cubixxPanels.map((panel) => (
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

