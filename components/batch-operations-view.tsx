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

// Types of operations
type DirectOperationType = "restart" | "scenes-all-off" | "toggle-all" | "toggle-backlight";
type VirtualOperationType = "virtual-backlight-on" | "virtual-backlight-off" | "virtual-all-lights-on" | "virtual-all-lights-off" | "virtual-all-switches-off";
type BatchOperationType = DirectOperationType | VirtualOperationType;

interface BatchOperation {
  id: BatchOperationType;
  label: string;
  command?: PanelCommand; // Direct operations have a single command
  isVirtual?: boolean; // Virtual operations are computed
  confirmMessage?: string;
  variant?: "default" | "warning" | "danger";
  tooltip?: string;
}

// Direct operations - map directly to panel commands (no group titles, just buttons with their names)
const DIRECT_OPERATIONS: BatchOperation[] = [
  {
    id: "restart",
    label: "Restart",
    command: { command: "restart" },
    confirmMessage: "Are you sure you want to restart all selected panels? They will be temporarily unavailable.",
    variant: "warning",
  },
  {
    id: "scenes-all-off",
    label: "Scenes All Off",
    command: { command: "all_off" },
    confirmMessage: "Are you sure you want to trigger the 'Scenes All Off' action on all selected panels?",
    variant: "danger",
  },
  {
    id: "toggle-all",
    label: "Toggle All",
    command: { command: "toggle_all" },
    variant: "default",
    tooltip: "If ANY relay is ON → turns all OFF. Only if ALL relays are OFF → turns all ON.",
  },
  {
    id: "toggle-backlight",
    label: "Toggle Backlight",
    // No fixed command - determined per panel based on current state
    variant: "default",
    tooltip: "Toggles backlight on each panel based on its current state",
  },
];

// Virtual operations - our implementation using multiple commands
const VIRTUAL_OPERATIONS: BatchOperation[] = [
  {
    id: "virtual-backlight-on",
    label: "Backlight On",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns ON backlight on all selected panels",
  },
  {
    id: "virtual-backlight-off",
    label: "Backlight Off",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns OFF backlight on all selected panels",
  },
  {
    id: "virtual-all-lights-on",
    label: "All Lights On",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns ON all configured light relays on each panel",
  },
  {
    id: "virtual-all-lights-off",
    label: "All Lights Off",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns OFF all configured light relays on each panel",
  },
  {
    id: "virtual-all-switches-off",
    label: "All Switches Off",
    isVirtual: true,
    variant: "danger",
    tooltip: "Turns OFF ALL relays (lights + unconfigured switches) on each panel",
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

// Check if a relay is a configured light (not a generic "Relay N" name)
function isConfiguredRelay(relay: { name?: string }): boolean {
  if (!relay.name || relay.name.trim() === "") return false;
  if (/^Relay\s+\d+$/i.test(relay.name.trim())) return false;
  return true;
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
  const hasAnyStatus = stats.success > 0 || stats.failed > 0 || stats.inProgress > 0;

  const handleRemovePanel = useCallback((ip: string) => {
    onSelectionChange(ip, false);
  }, [onSelectionChange]);

  // Execute a direct batch operation (single command per panel)
  const executeDirectOperation = useCallback(async (
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
        let command = operation.command;
        
        // Special case: Toggle Backlight needs to read current state
        if (operation.id === "toggle-backlight") {
          const panelState = livePanelStates?.get(ip);
          const currentBacklight = panelState?.fullState?.statusLedOn ?? false;
          command = { command: "backlight", state: !currentBacklight };
        }

        if (!command) {
          throw new Error("No command defined");
        }

        const success = await onSendCommand(ip, command);
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
  }, [onSendCommand, livePanelStates]);

  // Execute a virtual batch operation (multiple commands per panel or computed commands)
  const executeVirtualOperation = useCallback(async (
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

    // Execute on each panel
    const promises = targetIps.map(async (ip) => {
      try {
        // Handle backlight operations
        if (operation.id === "virtual-backlight-on" || operation.id === "virtual-backlight-off") {
          const targetState = operation.id === "virtual-backlight-on";
          const success = await onSendCommand(ip, { command: "backlight", state: targetState });
          setPanelStatuses(prev => {
            const next = new Map(prev);
            next.set(ip, success ? "success" : "failed");
            return next;
          });
          return { ip, success };
        }

        // Handle all lights operations (configured relays only)
        if (operation.id === "virtual-all-lights-on" || operation.id === "virtual-all-lights-off") {
          const targetState = operation.id === "virtual-all-lights-on";
          const panelState = livePanelStates?.get(ip);
          const relays = panelState?.fullState?.relays ?? [];
          const configuredRelays = relays.filter(isConfiguredRelay);

          if (configuredRelays.length === 0) {
            // No configured relays, mark as success (nothing to do)
            setPanelStatuses(prev => {
              const next = new Map(prev);
              next.set(ip, "success");
              return next;
            });
            return { ip, success: true };
          }

          // Send set_relay command for each configured relay
          const relayPromises = configuredRelays.map(relay =>
            onSendCommand(ip, { command: "set_relay", index: relay.index, state: targetState })
          );

          const results = await Promise.all(relayPromises);
          const allSuccess = results.every(r => r);

          setPanelStatuses(prev => {
            const next = new Map(prev);
            next.set(ip, allSuccess ? "success" : "failed");
            return next;
          });
          return { ip, success: allSuccess };
        }

        // Handle all switches off (ALL relays, including unconfigured)
        if (operation.id === "virtual-all-switches-off") {
          const panelState = livePanelStates?.get(ip);
          const relays = panelState?.fullState?.relays ?? [];

          if (relays.length === 0) {
            // No relays, mark as success (nothing to do)
            setPanelStatuses(prev => {
              const next = new Map(prev);
              next.set(ip, "success");
              return next;
            });
            return { ip, success: true };
          }

          // Send set_relay OFF command for ALL relays
          const relayPromises = relays.map(relay =>
            onSendCommand(ip, { command: "set_relay", index: relay.index, state: false })
          );

          const results = await Promise.all(relayPromises);
          const allSuccess = results.every(r => r);

          setPanelStatuses(prev => {
            const next = new Map(prev);
            next.set(ip, allSuccess ? "success" : "failed");
            return next;
          });
          return { ip, success: allSuccess };
        }

        // Unknown operation
        throw new Error("Unknown virtual operation");
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
  }, [onSendCommand, livePanelStates]);

  // Handle clicking any batch operation button
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

    if (operation.isVirtual) {
      executeVirtualOperation(operation, targetIps);
    } else {
      executeDirectOperation(operation, targetIps);
    }
  }, [selectedPanels, executeDirectOperation, executeVirtualOperation]);

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
    if (lastOperation.isVirtual) {
      executeVirtualOperation(lastOperation, failedIps);
    } else {
      executeDirectOperation(lastOperation, failedIps);
    }
  }, [lastOperation, hasFailures, selectedPanels, panelStatuses, executeDirectOperation, executeVirtualOperation]);

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

  // Find operations by ID
  const getDirectOp = (id: DirectOperationType) => DIRECT_OPERATIONS.find(op => op.id === id)!;
  const getVirtualOp = (id: VirtualOperationType) => VIRTUAL_OPERATIONS.find(op => op.id === id)!;

  return (
    <div className={styles.batchView}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        ← Back to discovery
      </button>
      
      <div className={styles.batchHeader}>
        <h2>Batch Operations <span className={styles.batchCount}>(batching {count} {count === 1 ? "panel" : "panels"})</span></h2>
        <p className={`${styles.batchProgress} ${hasAnyStatus ? "" : styles.batchProgressHidden}`}>
          {stats.inProgress > 0 && <span className={styles.progressInProgress}>⏳ {stats.inProgress} in progress</span>}
          {stats.success > 0 && <span className={styles.progressSuccess}>✓ {stats.success} succeeded</span>}
          {stats.failed > 0 && <span className={styles.progressFailed}>✗ {stats.failed} failed</span>}
          {!hasAnyStatus && <span className={styles.progressPlaceholder}>&nbsp;</span>}
        </p>
      </div>

      {/* Batch operation controls - two sections */}
      <div className={styles.batchControlsSections}>
        {/* Direct Operations */}
        <div className={styles.batchControlsSection}>
          <div className={styles.batchSectionHeader}>
            <h3>Direct Operations</h3>
            <span className={styles.batchSectionHint}>Native panel commands</span>
          </div>
          <div className={styles.batchControlsArea}>
            <div className={styles.batchControlsRow}>
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlWarning}`}
                onClick={() => handleOperationClick(getDirectOp("restart"))}
                disabled={isRunning || count === 0}
              >
                Restart
              </button>
              <span className={styles.buttonGroupSpacer}></span>
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlDanger}`}
                onClick={() => handleOperationClick(getDirectOp("scenes-all-off"))}
                disabled={isRunning || count === 0}
              >
                Scenes All Off
              </button>
              <span className={styles.buttonGroupSpacer}></span>
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(getDirectOp("toggle-all"))}
                disabled={isRunning || count === 0}
                title={getDirectOp("toggle-all").tooltip}
              >
                Toggle All
              </button>
              <span className={styles.buttonGroupSpacer}></span>
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(getDirectOp("toggle-backlight"))}
                disabled={isRunning || count === 0}
                title={getDirectOp("toggle-backlight").tooltip}
              >
                Toggle Backlight
              </button>
            </div>
          </div>
        </div>

        {/* Virtual Operations */}
        <div className={styles.batchControlsSection}>
          <div className={styles.batchSectionHeader}>
            <h3>Virtual Operations</h3>
            <span className={styles.batchSectionHint}>Aggregated commands</span>
          </div>
          <div className={styles.batchControlsArea}>
            <div className={styles.batchControlsRow}>
              {/* Backlight group */}
              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-backlight-on"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-backlight-on").tooltip}
                >
                  Backlight On
                </button>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-backlight-off"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-backlight-off").tooltip}
                >
                  Backlight Off
                </button>
              </div>
              <span className={styles.buttonGroupSpacer}></span>
              {/* All Lights group */}
              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-all-lights-on"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-all-lights-on").tooltip}
                >
                  All Lights On
                </button>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-all-lights-off"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-all-lights-off").tooltip}
                >
                  All Lights Off
                </button>
              </div>
              <span className={styles.buttonGroupSpacer}></span>
              {/* All Switches Off (standalone) */}
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlDanger}`}
                onClick={() => handleOperationClick(getVirtualOp("virtual-all-switches-off"))}
                disabled={isRunning || count === 0}
                title={getVirtualOp("virtual-all-switches-off").tooltip}
              >
                All Switches Off
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Re-run on failed button - always reserve space */}
      <div className={styles.rerunSection}>
        {hasFailures && !isRunning && lastOperation ? (
          <button
            type="button"
            className={styles.rerunButton}
            onClick={handleRerunFailed}
            title={`Re-run "${lastOperation.label}" on ${stats.failed} failed panel${stats.failed > 1 ? 's' : ''}`}
          >
            🔁 Re-run on failed panels ({stats.failed})
          </button>
        ) : (
          <div className={styles.rerunPlaceholder}></div>
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
                          const relayCount = liveState.fullState.relays?.filter(isConfiguredRelay).length ?? 0;
                          const curtainCount = liveState.fullState.curtains?.filter(
                            c => c.name && !/^Curtain\s+\d+$/i.test(c.name.trim())
                          ).length ?? 0;
                          const onCount = liveState.fullState.relays?.filter(
                            r => r.state && isConfiguredRelay(r)
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
