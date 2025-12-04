'use client';

import { useCallback, useState, type KeyboardEvent, type MouseEvent } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResponse, PanelInfo, LivePanelState, PanelCommand } from "@/lib/discovery/types";

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
  onSendCommand?: (ip: string, command: PanelCommand) => Promise<boolean>;
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
  onSendCommand,
}: DiscoveryResultsProps) {
  const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());

  const handleLightToggle = useCallback(async (
    e: MouseEvent,
    ip: string,
    relayIndex: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!onSendCommand) return;
    
    const key = `${ip}-L${relayIndex}`;
    setPendingCommands(prev => new Set(prev).add(key));
    
    try {
      await onSendCommand(ip, { command: "toggle_relay", index: relayIndex });
    } finally {
      setPendingCommands(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [onSendCommand]);

  const handleShadeAction = useCallback(async (
    e: MouseEvent,
    ip: string,
    curtainIndex: number,
    requestedAction: "open" | "close",
    currentState?: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!onSendCommand) return;
    
    // If shade is currently moving, send "stop" instead
    const isMoving = currentState === "opening" || currentState === "closing";
    const action = isMoving ? "stop" : requestedAction;
    
    const key = `${ip}-S${curtainIndex}-${requestedAction}`;
    setPendingCommands(prev => new Set(prev).add(key));
    
    try {
      await onSendCommand(ip, { command: "curtain", index: curtainIndex, action });
    } finally {
      setPendingCommands(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [onSendCommand]);

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
                        (() => {
                          // Hardware constraints:
                          // - Each panel has 6 relay slots total
                          // - Each LIGHT uses 1 slot
                          // - Each SHADE uses 2 slots (for up/down motors)
                          // So max_shades = floor((6 - light_count) / 2)
                          
                          const TOTAL_RELAY_SLOTS = 6;
                          const SLOTS_PER_SHADE = 2;
                          
                          // A relay is a "light" if its name is NOT a generic "Relay N" pattern
                          const isConfiguredRelay = (relay: { name?: string }) => {
                            if (!relay.name || relay.name.trim() === "") return false;
                            // Generic unconfigured names match "Relay N" where N is a number
                            if (/^Relay\s+\d+$/i.test(relay.name.trim())) return false;
                            return true;
                          };
                          
                          // A curtain is configured if its name is NOT a generic "Curtain N" pattern
                          const isConfiguredCurtain = (curtain: { name?: string }) => {
                            if (!curtain.name || curtain.name.trim() === "") return false;
                            // Generic unconfigured names match "Curtain N" where N is a number
                            if (/^Curtain\s+\d+$/i.test(curtain.name.trim())) return false;
                            return true;
                          };
                          
                          const lightRelays = liveState.fullState.relays.filter(isConfiguredRelay);
                          const configuredCurtains = liveState.fullState.curtains.filter(isConfiguredCurtain);
                          
                          // Calculate max possible shades based on remaining relay slots
                          const usedSlots = lightRelays.length;
                          const availableSlots = TOTAL_RELAY_SLOTS - usedSlots;
                          const maxPossibleShades = Math.floor(availableSlots / SLOTS_PER_SHADE);
                          
                          // Only show curtains up to the max possible (in case of phantom entries)
                          const validCurtains = configuredCurtains.slice(0, maxPossibleShades);
                          
                          return (
                            <div className={styles.entityStates}>
                              {/* Lights (Relays that are actual lights) */}
                              {lightRelays.map((relay) => {
                                const isPending = pendingCommands.has(`${result.ip}-L${relay.index}`);
                                return (
                                  <button
                                    key={`L${relay.index}`}
                                    className={`${styles.lightButton} ${relay.state ? styles.lightOn : styles.lightOff} ${isPending ? styles.pending : ""}`}
                                    title={`${relay.name} - Click to toggle`}
                                    onClick={(e) => handleLightToggle(e, result.ip, relay.index)}
                                    disabled={isPending || !onSendCommand}
                                  >
                                    L{relay.index + 1}
                                  </button>
                                );
                              })}
                              {/* Shades (Curtains) */}
                              {validCurtains.map((curtain) => {
                                const openPending = pendingCommands.has(`${result.ip}-S${curtain.index}-open`);
                                const closePending = pendingCommands.has(`${result.ip}-S${curtain.index}-close`);
                                const isOpen = curtain.state === "open";
                                const isClosed = curtain.state === "closed";
                                const isMoving = curtain.state === "opening" || curtain.state === "closing";
                                return (
                                  <span key={`S${curtain.index}`} className={styles.shadeGroup}>
                                    <button
                                      className={`${styles.shadeButton} ${isOpen ? styles.shadeActive : ""} ${isMoving ? styles.shadeMoving : ""} ${openPending ? styles.pending : ""}`}
                                      title={`${curtain.name} - ${isMoving ? "Stop" : "Open"}`}
                                      onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "open", curtain.state)}
                                      disabled={openPending || !onSendCommand}
                                    >
                                      {isMoving ? "■" : `S${curtain.index + 1}↑`}
                                    </button>
                                    <button
                                      className={`${styles.shadeButton} ${isClosed ? styles.shadeActive : ""} ${isMoving ? styles.shadeMoving : ""} ${closePending ? styles.pending : ""}`}
                                      title={`${curtain.name} - ${isMoving ? "Stop" : "Close"}`}
                                      onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "close", curtain.state)}
                                      disabled={closePending || !onSendCommand}
                                    >
                                      {isMoving ? "■" : `S${curtain.index + 1}↓`}
                                    </button>
                                  </span>
                                );
                              })}
                              {/* Show dash if no configured entities */}
                              {lightRelays.length === 0 && validCurtains.length === 0 && (
                                <span style={{ color: "var(--muted)" }}>—</span>
                              )}
                            </div>
                          );
                        })()
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

