'use client';

import { useCallback, useMemo } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResult, PanelInfo, LivePanelState, PanelCommand } from "@/lib/discovery/types";

interface BatchOperationsViewProps {
  selectedPanelIps: Set<string>;
  panelResults: DiscoveryResult[];
  panelInfoMap: Record<string, PanelInfo>;
  livePanelStates?: Map<string, LivePanelState>;
  onBack: () => void;
  onSelectionChange: (ip: string, selected: boolean) => void;
  onSendCommand?: (ip: string, command: PanelCommand) => Promise<boolean>;
}

// Compare two semver-like version strings
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const maxLen = Math.max(partsA.length, partsB.length);
  
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

export default function BatchOperationsView({
  selectedPanelIps,
  panelResults,
  panelInfoMap,
  livePanelStates,
  onBack,
  onSelectionChange,
}: BatchOperationsViewProps) {
  // Filter to only show selected panels that are actual panels
  const selectedPanels = useMemo(() => {
    return panelResults.filter(
      (result) => result.status === "panel" && selectedPanelIps.has(result.ip)
    );
  }, [panelResults, selectedPanelIps]);

  // Calculate the highest firmware version from selected panels
  const highestVersion = useMemo(() => {
    if (!livePanelStates) return null;
    let highest: string | null = null;
    selectedPanels.forEach((panel) => {
      const state = livePanelStates.get(panel.ip);
      const version = state?.fullState?.version;
      if (version) {
        if (!highest || compareVersions(version, highest) > 0) {
          highest = version;
        }
      }
    });
    return highest;
  }, [selectedPanels, livePanelStates]);

  const handleRemovePanel = useCallback((ip: string) => {
    onSelectionChange(ip, false);
  }, [onSelectionChange]);

  const count = selectedPanels.length;

  return (
    <div className={styles.batchView}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        ← Back to discovery
      </button>
      
      <div className={styles.batchHeader}>
        <h2>Batch Operations</h2>
        <p>{count === 1 ? "1 panel selected" : `${count} panels selected`}</p>
      </div>

      {/* Placeholder area for batch controls */}
      <div className={styles.batchControlsArea}>
        <div className={styles.batchControlsPlaceholder}>
          <span className={styles.placeholderIcon}>⚙️</span>
          <span className={styles.placeholderText}>
            Batch operation controls will appear here
          </span>
          <span className={styles.placeholderHint}>
            Coming soon: Restart, Backlight, Button Lock, All Off
          </span>
        </div>
      </div>

      {/* Selected panels table */}
      {count === 0 ? (
        <div className={styles.emptyBatchState}>
          No panels selected. Go back and select panels to perform batch operations.
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkboxHeader}></th>
                <th>IP</th>
                <th>Name</th>
                <th>Status</th>
                <th>FW Version</th>
                <th>Signal</th>
                <th>Backlight</th>
                <th>Live State</th>
              </tr>
            </thead>
            <tbody>
              {selectedPanels.map((panel) => {
                const metadata = panelInfoMap[panel.ip];
                const liveState = livePanelStates?.get(panel.ip);

                return (
                  <tr key={panel.ip} className={styles.selectedRow}>
                    <td className={styles.checkboxCell}>
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => handleRemovePanel(panel.ip)}
                        className={styles.rowCheckbox}
                        title="Uncheck to remove from batch"
                      />
                    </td>
                    <td>
                      <a
                        href={`http://${panel.ip}/`}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.panelLink}
                      >
                        {panel.ip}
                      </a>
                    </td>
                    <td>
                      {liveState?.fullState?.hostname ?? metadata?.name ?? panel.name ?? "—"}
                    </td>
                    <td>
                      {liveState?.connectionStatus === "connected" ? (
                        <span className={styles.statusLive}>● LIVE</span>
                      ) : (
                        <span className={styles.statusPanel}>● Panel</span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState?.version ? (
                        <span className={
                          highestVersion && compareVersions(liveState.fullState.version, highestVersion) === 0
                            ? styles.versionLatest
                            : styles.versionOutdated
                        }>
                          {liveState.fullState.version}
                        </span>
                      ) : (
                        <span className={styles.versionUnknown}>...</span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState?.wifiQuality != null ? (
                        <span className={
                          liveState.fullState.wifiQuality >= 70
                            ? styles.signalGood
                            : liveState.fullState.wifiQuality >= 40
                            ? styles.signalMedium
                            : styles.signalWeak
                        }>
                          {liveState.fullState.wifiQuality}%
                        </span>
                      ) : (
                        <span className={styles.signalUnknown}>...</span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState?.statusLedOn != null ? (
                        <span className={
                          liveState.fullState.statusLedOn
                            ? styles.backlightOnIndicator
                            : styles.backlightOffIndicator
                        }>
                          {liveState.fullState.statusLedOn ? "On" : "Off"}
                        </span>
                      ) : (
                        <span className={styles.backlightUnknown}>...</span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState ? (
                        (() => {
                          const relayCount = liveState.fullState.relays?.filter(
                            r => r.name && !/^Relay\s+\d+$/i.test(r.name.trim())
                          ).length ?? 0;
                          const curtainCount = liveState.fullState.curtains?.filter(
                            c => c.name && !/^Curtain\s+\d+$/i.test(c.name.trim())
                          ).length ?? 0;
                          const onCount = liveState.fullState.relays?.filter(
                            r => r.state && r.name && !/^Relay\s+\d+$/i.test(r.name.trim())
                          ).length ?? 0;

                          if (relayCount === 0 && curtainCount === 0) {
                            return <span style={{ color: "var(--muted)" }}>—</span>;
                          }

                          return (
                            <span className={styles.liveStateSummary}>
                              {relayCount > 0 && (
                                <span className={styles.lightsSummary}>
                                  💡 {onCount}/{relayCount}
                                </span>
                              )}
                              {curtainCount > 0 && (
                                <span className={styles.shadesSummary}>
                                  🪟 {curtainCount}
                                </span>
                              )}
                            </span>
                          );
                        })()
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                          Connecting...
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

