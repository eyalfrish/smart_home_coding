'use client';

import { useCallback, useMemo, useState } from "react";
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

// Status for each panel during batch operation
type PanelBatchStatus = "idle" | "in-progress" | "success" | "failed";

// Available batch operations
type BatchOperationType = "backlight-on" | "backlight-off" | "restart" | "all-off" | "toggle-all";

interface BatchOperation {
  id: BatchOperationType;
  label: string;
  icon: string;
  command: PanelCommand;
  confirmMessage?: string;
  variant?: "default" | "warning" | "danger";
}

const BATCH_OPERATIONS: BatchOperation[] = [
  {
    id: "backlight-on",
    label: "Backlight On",
    icon: "💡",
    command: { command: "backlight", state: true },
    variant: "default",
  },
  {
    id: "backlight-off",
    label: "Backlight Off",
    icon: "🌙",
    command: { command: "backlight", state: false },
    variant: "default",
  },
  {
    id: "restart",
    label: "Restart",
    icon: "🔄",
    command: { command: "restart" },
    confirmMessage: "Are you sure you want to restart all selected panels? They will be temporarily unavailable.",
    variant: "warning",
  },
  {
    id: "all-off",
    label: "All Off",
    icon: "⚡",
    command: { command: "all_off" },
    confirmMessage: "Are you sure you want to turn OFF all relays on all selected panels?",
    variant: "danger",
  },
  {
    id: "toggle-all",
    label: "Toggle All",
    icon: "🔀",
    command: { command: "toggle_all" },
    variant: "default",
  },
];

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
  onSendCommand,
}: BatchOperationsViewProps) {
  // Track batch operation status per panel
  const [panelStatuses, setPanelStatuses] = useState<Map<string, PanelBatchStatus>>(new Map());
  // Track if a batch operation is currently running
  const [isRunning, setIsRunning] = useState(false);
  // Track the last operation that was run (for re-run functionality)
  const [lastOperation, setLastOperation] = useState<BatchOperation | null>(null);

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

  // Calculate statistics
  const stats = useMemo(() => {
    let success = 0;
    let failed = 0;
    let inProgress = 0;
    
    selectedPanels.forEach((panel) => {
      const status = panelStatuses.get(panel.ip);
      if (status === "success") success++;
      else if (status === "failed") failed++;
      else if (status === "in-progress") inProgress++;
    });

    return { success, failed, inProgress, total: selectedPanels.length };
  }, [selectedPanels, panelStatuses]);

  const hasFailures = stats.failed > 0;
  const hasAnyStatus = stats.success > 0 || stats.failed > 0;

  const handleRemovePanel = useCallback((ip: string) => {
    onSelectionChange(ip, false);
  }, [onSelectionChange]);

  // Execute batch operation on specified panels
  const executeBatchOperation = useCallback(async (
    operation: BatchOperation,
    targetIps: string[]
  ) => {
    if (!onSendCommand || targetIps.length === 0) return;

    setIsRunning(true);
    setLastOperation(operation);

    // Set all target panels to in-progress
    setPanelStatuses(prev => {
      const next = new Map(prev);
      targetIps.forEach(ip => next.set(ip, "in-progress"));
      return next;
    });

    // Execute commands in parallel but update status as each completes
    const promises = targetIps.map(async (ip) => {
      try {
        const success = await onSendCommand(ip, operation.command);
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, success ? "success" : "failed");
          return next;
        });
        return { ip, success };
      } catch {
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, "failed");
          return next;
        });
        return { ip, success: false };
      }
    });

    await Promise.all(promises);
    setIsRunning(false);
  }, [onSendCommand]);

  // Handle clicking a batch operation button
  const handleOperationClick = useCallback((operation: BatchOperation) => {
    // If there's a confirm message, show confirmation
    if (operation.confirmMessage) {
      const confirmed = window.confirm(operation.confirmMessage);
      if (!confirmed) return;
    }

    // Reset all statuses before starting new operation
    setPanelStatuses(new Map());

    // Execute on all selected panels
    const targetIps = selectedPanels.map(p => p.ip);
    executeBatchOperation(operation, targetIps);
  }, [selectedPanels, executeBatchOperation]);

  // Handle re-run on failed panels
  const handleRerunFailed = useCallback(() => {
    if (!lastOperation || !hasFailures) return;

    // Get only the failed panel IPs
    const failedIps = selectedPanels
      .filter(p => panelStatuses.get(p.ip) === "failed")
      .map(p => p.ip);

    // Only reset status for failed panels (keep success statuses)
    setPanelStatuses(prev => {
      const next = new Map(prev);
      failedIps.forEach(ip => next.delete(ip));
      return next;
    });

    // Re-run on failed panels only
    executeBatchOperation(lastOperation, failedIps);
  }, [lastOperation, hasFailures, selectedPanels, panelStatuses, executeBatchOperation]);

  const count = selectedPanels.length;

  // Get status icon for a panel
  const getStatusIcon = (ip: string) => {
    const status = panelStatuses.get(ip);
    switch (status) {
      case "in-progress":
        return <span className={styles.batchStatusInProgress} title="In progress">⏳</span>;
      case "success":
        return <span className={styles.batchStatusSuccess} title="Success">✓</span>;
      case "failed":
        return <span className={styles.batchStatusFailed} title="Failed">✗</span>;
      default:
        return <span className={styles.batchStatusIdle}></span>;
    }
  };

  return (
    <div className={styles.batchView}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        ← Back to discovery
      </button>
      
      <div className={styles.batchHeader}>
        <h2>Batch Operations <span className={styles.batchCount}>(batching {count} {count === 1 ? "panel" : "panels"})</span></h2>
        {hasAnyStatus && (
          <p className={styles.batchProgress}>
            {stats.inProgress > 0 && <span className={styles.progressInProgress}>⏳ {stats.inProgress} in progress</span>}
            {stats.success > 0 && <span className={styles.progressSuccess}>✓ {stats.success} succeeded</span>}
            {stats.failed > 0 && <span className={styles.progressFailed}>✗ {stats.failed} failed</span>}
          </p>
        )}
      </div>

      {/* Batch operation controls */}
      <div className={styles.batchControlsArea}>
        <div className={styles.batchControlsGrid}>
          {/* Backlight Controls */}
          <div className={styles.batchControlGroup}>
            <h4 className={styles.batchControlGroupTitle}>💡 Backlight</h4>
            <div className={styles.batchControlButtons}>
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(BATCH_OPERATIONS[0])}
                disabled={isRunning || count === 0}
              >
                On
              </button>
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(BATCH_OPERATIONS[1])}
                disabled={isRunning || count === 0}
              >
                Off
              </button>
            </div>
          </div>

          {/* Restart */}
          <div className={styles.batchControlGroup}>
            <h4 className={styles.batchControlGroupTitle}>🔄 Device</h4>
            <div className={styles.batchControlButtons}>
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlWarning}`}
                onClick={() => handleOperationClick(BATCH_OPERATIONS[2])}
                disabled={isRunning || count === 0}
              >
                Restart
              </button>
            </div>
          </div>

          {/* Power Controls */}
          <div className={styles.batchControlGroup}>
            <h4 className={styles.batchControlGroupTitle}>⚡ Power</h4>
            <div className={styles.batchControlButtons}>
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlDanger}`}
                onClick={() => handleOperationClick(BATCH_OPERATIONS[3])}
                disabled={isRunning || count === 0}
              >
                All Off
              </button>
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(BATCH_OPERATIONS[4])}
                disabled={isRunning || count === 0}
              >
                Toggle All
              </button>
            </div>
          </div>
        </div>

        {/* Re-run on failed button */}
        {hasFailures && !isRunning && lastOperation && (
          <div className={styles.rerunSection}>
            <button
              type="button"
              className={styles.rerunButton}
              onClick={handleRerunFailed}
              title={`Re-run "${lastOperation.label}" on ${stats.failed} failed panel${stats.failed > 1 ? 's' : ''}`}
            >
              🔁 Re-run on failed panels ({stats.failed})
            </button>
          </div>
        )}
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
                <th className={styles.statusHeader}>Status</th>
                <th>IP</th>
                <th>Name</th>
                <th>Connection</th>
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
                const batchStatus = panelStatuses.get(panel.ip) ?? "idle";
                const rowStatusClass = batchStatus === "success" 
                  ? styles.batchRowSuccess 
                  : batchStatus === "failed" 
                    ? styles.batchRowFailed 
                    : batchStatus === "in-progress"
                      ? styles.batchRowInProgress
                      : "";

                return (
                  <tr key={panel.ip} className={`${styles.selectedRow} ${rowStatusClass}`}>
                    <td className={styles.checkboxCell}>
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => handleRemovePanel(panel.ip)}
                        className={styles.rowCheckbox}
                        title="Uncheck to remove from batch"
                        disabled={isRunning}
                      />
                    </td>
                    <td className={styles.batchStatusCell}>
                      {getStatusIcon(panel.ip)}
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
