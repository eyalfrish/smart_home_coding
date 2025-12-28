'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import styles from './discovery-dashboard.module.css';
import type { LivePanelState } from '@/lib/discovery/types';

// =============================================================================
// Types
// =============================================================================

/**
 * A single favorite switch entry.
 */
export interface FavoriteSwitch {
  /** IP address of the panel */
  ip: string;
  /** Relay index on the panel (0-based) */
  relayIndex: number;
  /** Display name for this switch */
  name: string;
}

/**
 * Favorites data structure with zones.
 * Stored in profile.favorites.zones
 */
export interface FavoritesData {
  zones: Record<string, FavoriteSwitch[]>;
}

/**
 * A single step in a smart flow sequence.
 */
export interface FlowStep {
  /** ID of the switch to control (format: "ip:relayIndex") */
  switchId: string;
  /** Action to perform: "on", "off", or "toggle" */
  action: 'on' | 'off' | 'toggle';
  /** Delay in milliseconds before executing this step */
  delayMs: number;
}

/**
 * A smart flow - a user-programmed sequence with timers.
 */
export interface SmartFlow {
  /** Display name for this flow */
  name: string;
  /** Sequence of steps to execute */
  steps: FlowStep[];
}

/**
 * Smart switches data structure with zones.
 * Stored in profile.smart_switches.zones
 */
export interface SmartSwitchesData {
  zones: Record<string, SmartFlow[]>;
}

/**
 * Full profile data (subset of what we need)
 */
export interface ProfileData {
  id: number;
  name: string;
  favorites: FavoritesData | Record<string, unknown>;
  smart_switches?: SmartSwitchesData | Record<string, unknown>;
}

/**
 * Validation result for switches and flows
 */
interface ValidationResult {
  /** Set of switch IDs that are unreachable (format: "ip:relayIndex") */
  unreachableSwitchIds: Set<string>;
  /** Count of total unreachable switches */
  unreachableCount: number;
  /** Map of flow names to their invalid step indices */
  invalidFlowSteps: Map<string, number[]>;
  /** Count of flows with at least one invalid step */
  invalidFlowCount: number;
}

interface FavoritesSectionProps {
  /** Currently selected profile (null if none selected) */
  profile: ProfileData | null;
  /** Set of discovered panel IPs (for showing which switches are available) */
  discoveredPanelIps: Set<string>;
  /** Whether discovery is currently running */
  isLoading: boolean;
  /** Whether discovery has completed at least once */
  discoveryCompleted: boolean;
  /** Live panel states from WebSocket connections */
  livePanelStates: Map<string, LivePanelState>;
  /** Callback when favorites are updated (for save logic) */
  onFavoritesUpdate?: (profileId: number, favorites: Record<string, unknown>) => void;
  /** Callback when smart switches are updated (for save logic) */
  onSmartSwitchesUpdate?: (profileId: number, smartSwitches: Record<string, unknown>) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse favorites from profile - handles both old and new format.
 */
function parseFavorites(favorites: unknown): FavoritesData {
  if (!favorites || typeof favorites !== 'object') {
    return { zones: {} };
  }

  const favObj = favorites as Record<string, unknown>;
  
  // New format: { zones: { ... } }
  if (favObj.zones && typeof favObj.zones === 'object') {
    return favorites as FavoritesData;
  }

  // Old format or empty: return empty zones
  return { zones: {} };
}

/**
 * Get placeholder data for demo purposes.
 */
function getPlaceholderData(): FavoritesData {
  return {
    zones: {
      "Living Room": [
        { ip: "10.88.99.201", relayIndex: 0, name: "Main Light" },
        { ip: "10.88.99.201", relayIndex: 1, name: "Accent Light" },
        { ip: "10.88.99.205", relayIndex: 0, name: "Wall Sconce" },
      ],
      "Kitchen": [
        { ip: "10.88.99.202", relayIndex: 0, name: "Ceiling Light" },
        { ip: "10.88.99.202", relayIndex: 1, name: "Under Cabinet" },
      ],
      "Bedroom": [
        { ip: "10.88.99.203", relayIndex: 0, name: "Bedside Lamp" },
      ],
    },
  };
}

/**
 * Parse smart_switches from profile - handles both old and new format.
 */
function parseSmartSwitches(smartSwitches: unknown): SmartSwitchesData {
  if (!smartSwitches || typeof smartSwitches !== 'object') {
    return { zones: {} };
  }

  const ssObj = smartSwitches as Record<string, unknown>;
  
  // New format: { zones: { ... } }
  if (ssObj.zones && typeof ssObj.zones === 'object') {
    return smartSwitches as SmartSwitchesData;
  }

  // Old format or empty: return empty zones
  return { zones: {} };
}

/**
 * Get placeholder smart switches data for demo purposes.
 */
function getPlaceholderSmartSwitches(): SmartSwitchesData {
  return {
    zones: {
      "Living Room": [
        {
          name: "Sunset Mode",
          steps: [
            { switchId: "10.88.99.201:0", action: "on", delayMs: 0 },
            { switchId: "10.88.99.201:1", action: "on", delayMs: 2000 },
            { switchId: "10.88.99.205:0", action: "on", delayMs: 4000 },
          ],
        },
        {
          name: "Movie Night",
          steps: [
            { switchId: "10.88.99.201:0", action: "off", delayMs: 0 },
            { switchId: "10.88.99.201:1", action: "on", delayMs: 500 },
          ],
        },
      ],
      "Kitchen": [
        {
          name: "Cooking Mode",
          steps: [
            { switchId: "10.88.99.202:0", action: "on", delayMs: 0 },
            { switchId: "10.88.99.202:1", action: "on", delayMs: 1000 },
          ],
        },
      ],
      "Bedroom": [
        {
          name: "Goodnight",
          steps: [
            { switchId: "10.88.99.203:0", action: "off", delayMs: 0 },
          ],
        },
      ],
    },
  };
}

// =============================================================================
// FavoritesSection Component
// =============================================================================

// =============================================================================
// Validation Helper
// =============================================================================

/**
 * Validate all switches and flows against discovered and connected panels.
 * A switch is considered reachable if its panel IP is discovered AND connected.
 */
function validateSwitchesAndFlows(
  favoritesData: FavoritesData,
  smartSwitchesData: SmartSwitchesData,
  discoveredPanelIps: Set<string>,
  livePanelStates: Map<string, LivePanelState>,
  discoveryCompleted: boolean,
): ValidationResult {
  const unreachableSwitchIds = new Set<string>();
  const invalidFlowSteps = new Map<string, number[]>();
  
  // Don't validate until discovery has completed at least once
  if (!discoveryCompleted) {
    return {
      unreachableSwitchIds,
      unreachableCount: 0,
      invalidFlowSteps,
      invalidFlowCount: 0,
    };
  }

  // Helper to check if a panel IP is reachable (discovered AND connected)
  const isPanelReachable = (ip: string): boolean => {
    if (!discoveredPanelIps.has(ip)) return false;
    const state = livePanelStates.get(ip);
    // Consider reachable if connected OR if we don't have connection status yet
    // This prevents false positives during initial connection phase
    return !state || state.connectionStatus === 'connected' || state.connectionStatus === 'connecting';
  };

  // Validate favorite switches
  for (const [_zoneName, switches] of Object.entries(favoritesData.zones)) {
    for (const sw of switches) {
      const switchId = `${sw.ip}:${sw.relayIndex}`;
      if (!isPanelReachable(sw.ip)) {
        unreachableSwitchIds.add(switchId);
      }
    }
  }

  // Validate smart flow steps
  for (const [_zoneName, flows] of Object.entries(smartSwitchesData.zones)) {
    for (const flow of flows) {
      const invalidSteps: number[] = [];
      flow.steps.forEach((step, idx) => {
        // switchId format: "ip:relayIndex"
        const ip = step.switchId.split(':')[0];
        if (!isPanelReachable(ip)) {
          invalidSteps.push(idx);
          unreachableSwitchIds.add(step.switchId);
        }
      });
      if (invalidSteps.length > 0) {
        // Use zoneName + flowName as key to handle same-named flows in different zones
        const flowKey = `${flow.name}`;
        invalidFlowSteps.set(flowKey, invalidSteps);
      }
    }
  }

  return {
    unreachableSwitchIds,
    unreachableCount: unreachableSwitchIds.size,
    invalidFlowSteps,
    invalidFlowCount: invalidFlowSteps.size,
  };
}

// =============================================================================
// FavoritesSection Component
// =============================================================================

export default function FavoritesSection({
  profile,
  discoveredPanelIps,
  isLoading,
  discoveryCompleted,
  livePanelStates,
  onFavoritesUpdate,
  onSmartSwitchesUpdate,
}: FavoritesSectionProps) {
  // State
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  // Reset warning dismissed state when profile changes
  useEffect(() => {
    setWarningDismissed(false);
  }, [profile?.id]);

  // Parse favorites from profile (or use placeholder if no profile)
  const favoritesData = useMemo(() => {
    if (!profile) {
      // No profile - show placeholder data for demo
      return getPlaceholderData();
    }
    
    const parsed = parseFavorites(profile.favorites);
    
    // If no zones in profile, show placeholder for demo
    if (Object.keys(parsed.zones).length === 0) {
      return getPlaceholderData();
    }
    
    return parsed;
  }, [profile]);

  // Parse smart switches from profile (or use placeholder if no profile)
  const smartSwitchesData = useMemo(() => {
    if (!profile) {
      // No profile - show placeholder data for demo
      return getPlaceholderSmartSwitches();
    }
    
    const parsed = parseSmartSwitches(profile.smart_switches);
    
    // If no zones in profile, show placeholder for demo
    if (Object.keys(parsed.zones).length === 0) {
      return getPlaceholderSmartSwitches();
    }
    
    return parsed;
  }, [profile]);

  // Combine zones from both favorites and smart switches
  const allZones = useMemo(() => {
    const favoriteZones = new Set(Object.keys(favoritesData.zones));
    const smartZones = new Set(Object.keys(smartSwitchesData.zones));
    return [...new Set([...favoriteZones, ...smartZones])];
  }, [favoritesData.zones, smartSwitchesData.zones]);

  const totalSwitches = Object.values(favoritesData.zones).reduce(
    (sum, switches) => sum + switches.length,
    0
  );

  const totalFlows = Object.values(smartSwitchesData.zones).reduce(
    (sum, flows) => sum + flows.length,
    0
  );

  // Set first zone as active when expanded and no zone is selected
  const effectiveActiveZone = activeZone ?? (allZones.length > 0 ? allZones[0] : null);

  // Get current zone data
  const currentZoneSwitches = effectiveActiveZone 
    ? favoritesData.zones[effectiveActiveZone] ?? []
    : [];
  const currentZoneFlows = effectiveActiveZone 
    ? smartSwitchesData.zones[effectiveActiveZone] ?? []
    : [];

  // =============================================================================
  // Validation
  // =============================================================================

  // Run validation whenever dependencies change
  const validation = useMemo(() => {
    return validateSwitchesAndFlows(
      favoritesData,
      smartSwitchesData,
      discoveredPanelIps,
      livePanelStates,
      discoveryCompleted
    );
  }, [favoritesData, smartSwitchesData, discoveredPanelIps, livePanelStates, discoveryCompleted]);

  // Helper to check if a specific switch is unreachable
  const isSwitchUnreachable = useCallback((sw: FavoriteSwitch): boolean => {
    const switchId = `${sw.ip}:${sw.relayIndex}`;
    return validation.unreachableSwitchIds.has(switchId);
  }, [validation.unreachableSwitchIds]);

  // Helper to check if a flow has any invalid steps
  const hasInvalidSteps = useCallback((flow: SmartFlow): boolean => {
    return validation.invalidFlowSteps.has(flow.name);
  }, [validation.invalidFlowSteps]);

  // Get invalid step indices for a flow
  const getInvalidStepIndices = useCallback((flow: SmartFlow): number[] => {
    return validation.invalidFlowSteps.get(flow.name) ?? [];
  }, [validation.invalidFlowSteps]);

  // Show warning when there are unreachable switches (and not dismissed)
  const showValidationWarning = validation.unreachableCount > 0 && !warningDismissed && discoveryCompleted;

  // =============================================================================
  // Handlers
  // =============================================================================

  const handleSwitchClick = useCallback((sw: FavoriteSwitch, isReachable: boolean) => {
    console.log('[FavoritesSection] Switch clicked:', {
      switch: sw,
      isReachable,
      profileId: profile?.id,
    });

    if (!isReachable) {
      console.log('[FavoritesSection] Switch not available - panel not reachable');
      return;
    }

    // TODO: Implement actual switch toggle via panel command
    console.log(`[FavoritesSection] Would toggle relay ${sw.relayIndex} on ${sw.ip}`);
  }, [profile]);

  const handleEditClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditMode(!isEditMode);
    console.log('[FavoritesSection] Edit mode:', !isEditMode);
  }, [isEditMode]);

  const handleAddZoneClick = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    console.log('[FavoritesSection] Add Zone clicked - would open zone creation modal');
    // TODO: Implement zone creation modal
  }, []);

  const handleAddSwitchClick = useCallback((zoneName: string) => {
    console.log('[FavoritesSection] Add Switch clicked:', {
      zoneName,
      profileId: profile?.id,
    });
    // TODO: Implement switch addition modal
    console.log('[FavoritesSection] Would open switch addition modal');
  }, [profile]);

  const handleSaveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!profile || !onFavoritesUpdate) {
      console.log('[FavoritesSection] Cannot save - no profile or callback');
      return;
    }

    console.log('[FavoritesSection] Save clicked - would call PUT /api/profiles/[id]', {
      profileId: profile.id,
      favorites: favoritesData,
      smart_switches: smartSwitchesData,
    });

    // TODO: Implement actual save
    // onFavoritesUpdate(profile.id, favoritesData);
    // onSmartSwitchesUpdate?.(profile.id, smartSwitchesData);
    
    setIsEditMode(false);
  }, [profile, favoritesData, smartSwitchesData, onFavoritesUpdate]);

  const handleRunFlow = useCallback((flow: SmartFlow, zoneName: string) => {
    console.log('[FavoritesSection] Run Flow clicked:', {
      flow,
      zoneName,
      profileId: profile?.id,
    });

    // Log each step that would be executed
    flow.steps.forEach((step, idx) => {
      console.log(`  Step ${idx + 1}: ${step.switchId} → ${step.action} (delay: ${step.delayMs}ms)`);
    });

    // TODO: Implement actual flow execution
    console.log('[FavoritesSection] Would execute flow sequence');
  }, [profile]);

  const handleCreateFlow = useCallback((zoneName: string) => {
    console.log('[FavoritesSection] Create Flow clicked:', {
      zoneName,
      profileId: profile?.id,
    });

    // TODO: Implement flow creation modal
    console.log('[FavoritesSection] Would open flow creation modal');
  }, [profile]);

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <div className={`${styles.collapsibleSection} ${isExpanded ? styles.collapsibleSectionExpanded : ''}`}>
      {/* Header - always visible */}
      <div
        className={styles.collapsibleSectionHeader}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer' }}
      >
        <div className={styles.collapsibleSectionHeaderLeft}>
          <span className={styles.collapsibleSectionToggle}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <h3 className={styles.collapsibleSectionTitle}>
            ⭐ Favorites &amp; Smart Flows
            {/* Zone count badge - only show when profile is selected */}
            {profile && allZones.length > 0 && (
              <span className={styles.favoritesBadge}>
                {allZones.length} zone{allZones.length !== 1 ? 's' : ''} · {totalSwitches} switch{totalSwitches !== 1 ? 'es' : ''}
                {totalFlows > 0 && ` · ${totalFlows} flow${totalFlows !== 1 ? 's' : ''}`}
              </span>
            )}
          </h3>
        </div>
        
        {/* Header actions - only Edit/Save */}
        <div className={styles.collapsibleSectionActions} onClick={(e) => e.stopPropagation()}>
          {isEditMode ? (
            <button
              type="button"
              className={styles.favActionButton}
              onClick={handleSaveClick}
              data-variant="primary"
            >
              <span className={styles.desktopText}>💾 Save</span>
              <span className={styles.mobileText}>💾</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.favActionButton}
              onClick={handleEditClick}
              disabled={!profile}
              title={!profile ? 'Select a profile first' : 'Edit favorites'}
            >
              <span className={styles.desktopText}>✏️ Edit</span>
              <span className={styles.mobileText}>✏️</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsed summary - show zones preview (only when profile selected) */}
      {!isExpanded && profile && allZones.length > 0 && (
        <div className={styles.favoritesSummary}>
          {allZones.slice(0, 4).map((zoneName) => {
            const switchCount = favoritesData.zones[zoneName]?.length ?? 0;
            const flowCount = smartSwitchesData.zones[zoneName]?.length ?? 0;
            return (
              <div key={zoneName} className={styles.favoritesSummaryZone}>
                <span className={styles.favoritesSummaryZoneName}>{zoneName}</span>
                <span className={styles.favoritesSummaryZoneCount}>
                  {switchCount}{flowCount > 0 && `+${flowCount}⚡`}
                </span>
              </div>
            );
          })}
          {allZones.length > 4 && (
            <div className={styles.favoritesSummaryMore}>
              +{allZones.length - 4} more
            </div>
          )}
        </div>
      )}

      {/* Expandable content */}
      <div className={styles.collapsibleSectionContent}>
        {/* Validation warning toast */}
        {showValidationWarning && profile && (
          <div className={styles.validationWarning}>
            <span className={styles.validationWarningIcon}>⚠️</span>
            <span className={styles.validationWarningText}>
              {validation.unreachableCount} switch{validation.unreachableCount !== 1 ? 'es' : ''} no longer reachable
              {validation.invalidFlowCount > 0 && (
                <> · {validation.invalidFlowCount} flow{validation.invalidFlowCount !== 1 ? 's' : ''} affected</>
              )}
            </span>
            <button
              type="button"
              className={styles.validationWarningDismiss}
              onClick={() => setWarningDismissed(true)}
              title="Dismiss warning"
            >
              ✕
            </button>
          </div>
        )}

        {/* No profile message */}
        {!profile && (
          <div className={styles.favoritesEmptyState}>
            <div className={styles.favoritesEmptyIcon}>👤</div>
            <p>Select a profile to view and manage your favorite switches.</p>
          </div>
        )}

        {/* Main content when profile exists */}
        {profile && (
          <>
            {/* Zone Navigation Row */}
            <div className={styles.favZoneNavRow}>
              {allZones.length > 0 && (
                <div className={styles.favoritesZoneTabs}>
                  {allZones.map((zoneName) => {
                    const switchCount = favoritesData.zones[zoneName]?.length ?? 0;
                    const flowCount = smartSwitchesData.zones[zoneName]?.length ?? 0;
                    return (
                      <button
                        key={zoneName}
                        type="button"
                        className={`${styles.favoritesZoneTab} ${effectiveActiveZone === zoneName ? styles.favoritesZoneTabActive : ''}`}
                        onClick={() => setActiveZone(zoneName)}
                      >
                        {zoneName}
                        <span className={styles.favoritesZoneTabCount}>
                          {switchCount + flowCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Add Zone button - aligned right of zone tabs */}
              {isEditMode && (
                <button
                  type="button"
                  className={styles.favActionButton}
                  onClick={handleAddZoneClick}
                  title="Add a new zone"
                >
                  ➕ Add Zone
                </button>
              )}
            </div>

            {/* No zones empty state */}
            {allZones.length === 0 && (
              <div className={styles.favoritesEmptyState}>
                <div className={styles.favoritesEmptyIcon}>🏠</div>
                <p>No zones configured yet. Create zones to organize your favorite switches and flows.</p>
                <button
                  type="button"
                  className={styles.favActionButton}
                  onClick={handleAddZoneClick}
                  data-variant="primary"
                  data-size="large"
                >
                  ➕ Create Your First Zone
                </button>
              </div>
            )}

            {/* Active zone content - Two distinct sub-areas */}
            {effectiveActiveZone && allZones.length > 0 && (
              <div className={styles.favZoneContentWrapper}>
                
                {/* =====================================================
                    SUB-AREA 1: FAVORITE SWITCHES
                   ===================================================== */}
                <div className={styles.favSubSection}>
                  <div className={styles.favSubSectionHeader}>
                    <h4 className={styles.favSubSectionTitle}>
                      <span className={styles.favSubSectionIcon}>💡</span>
                      Switches
                      {currentZoneSwitches.length > 0 && (
                        <span className={styles.favSubSectionCount}>{currentZoneSwitches.length}</span>
                      )}
                    </h4>
                  </div>

                  {/* Switch grid */}
                  {currentZoneSwitches.length > 0 ? (
                    <div className={styles.favoritesSwitchGrid}>
                      {currentZoneSwitches.map((sw, idx) => {
                        const isDiscovered = discoveredPanelIps.has(sw.ip);
                        const isUnreachable = isSwitchUnreachable(sw);
                        // Reachable = discovered AND not marked as unreachable by validation
                        const isReachable = isDiscovered && !isUnreachable;
                        // Show invalid styling only after discovery completes
                        const showInvalidState = discoveryCompleted && isUnreachable;
                        
                        return (
                          <button
                            key={`${sw.ip}-${sw.relayIndex}-${idx}`}
                            type="button"
                            className={`${styles.favoriteSwitchButton} ${!isReachable ? styles.favoriteSwitchButtonDisabled : ''} ${showInvalidState ? styles.favoriteSwitchButtonInvalid : ''}`}
                            onClick={() => handleSwitchClick(sw, isReachable)}
                            disabled={isLoading || !isReachable}
                            title={
                              showInvalidState 
                                ? `${sw.name} - Panel unreachable (${sw.ip})`
                                : isReachable 
                                  ? `${sw.name} (${sw.ip} relay ${sw.relayIndex})` 
                                  : `${sw.name} - Panel not discovered`
                            }
                          >
                            <span className={styles.favoriteSwitchIcon}>
                              {showInvalidState ? '⚠️' : isReachable ? '💡' : '⭘'}
                            </span>
                            <span className={styles.favoriteSwitchName}>{sw.name}</span>
                            <span className={styles.favoriteSwitchIp}>
                              {sw.ip.split('.').slice(-1)[0]}:{sw.relayIndex}
                            </span>
                            {showInvalidState ? (
                              <span className={styles.favoriteSwitchUnreachable}>unreachable</span>
                            ) : !isDiscovered && (
                              <span className={styles.favoriteSwitchOffline}>offline</span>
                            )}
                          </button>
                        );
                      })}
                      {/* Add switch button as last card in edit mode */}
                      {isEditMode && (
                        <button
                          type="button"
                          className={styles.favAddItemCard}
                          onClick={() => handleAddSwitchClick(effectiveActiveZone)}
                          title="Add a switch to this zone"
                        >
                          <span className={styles.favAddItemIcon}>➕</span>
                          <span className={styles.favAddItemText}>Add Switch</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    /* Empty switches state */
                    <div className={styles.favSubSectionEmpty}>
                      <p>No switches in this zone yet.</p>
                      {isEditMode && (
                        <button
                          type="button"
                          className={styles.favActionButton}
                          onClick={() => handleAddSwitchClick(effectiveActiveZone)}
                        >
                          ➕ Add Switch
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* =====================================================
                    SUB-AREA 2: SMART FLOWS
                   ===================================================== */}
                <div className={`${styles.favSubSection} ${styles.favSubSectionFlows}`}>
                  <div className={styles.favSubSectionHeader}>
                    <h4 className={styles.favSubSectionTitle}>
                      <span className={styles.favSubSectionIcon}>⚡</span>
                      Smart Flows
                      {currentZoneFlows.length > 0 && (
                        <span className={`${styles.favSubSectionCount} ${styles.favSubSectionCountPurple}`}>
                          {currentZoneFlows.length}
                        </span>
                      )}
                    </h4>
                  </div>

                  {/* Flows grid */}
                  {currentZoneFlows.length > 0 ? (
                    <div className={styles.smartFlowsGrid}>
                      {currentZoneFlows.map((flow, idx) => {
                        const flowHasInvalidSteps = hasInvalidSteps(flow);
                        const invalidStepIndices = getInvalidStepIndices(flow);
                        const showInvalidState = discoveryCompleted && flowHasInvalidSteps;
                        
                        return (
                          <div
                            key={`flow-${flow.name}-${idx}`}
                            className={`${styles.smartFlowCard} ${showInvalidState ? styles.smartFlowCardInvalid : ''}`}
                          >
                            <div className={styles.smartFlowCardHeader}>
                              <span className={styles.smartFlowIcon}>
                                {showInvalidState ? '⚠️' : '⚡'}
                              </span>
                              <span className={styles.smartFlowName}>{flow.name}</span>
                            </div>
                            <div className={styles.smartFlowMeta}>
                              {flow.steps.length} step{flow.steps.length !== 1 ? 's' : ''}
                              {showInvalidState && (
                                <span className={styles.smartFlowInvalidCount}>
                                  {invalidStepIndices.length} unreachable
                                </span>
                              )}
                              {flow.steps.length > 0 && !showInvalidState && (
                                <span className={styles.smartFlowDuration}>
                                  ~{Math.ceil(flow.steps.reduce((acc, s) => acc + s.delayMs, 0) / 1000)}s
                                </span>
                              )}
                            </div>
                            {/* Show invalid steps preview when flow has issues */}
                            {showInvalidState && (
                              <div className={styles.smartFlowInvalidSteps}>
                                {invalidStepIndices.slice(0, 2).map(stepIdx => {
                                  const step = flow.steps[stepIdx];
                                  const ip = step.switchId.split(':')[0];
                                  return (
                                    <span key={stepIdx} className={styles.smartFlowInvalidStep}>
                                      Step {stepIdx + 1}: {ip.split('.').slice(-1)[0]}
                                    </span>
                                  );
                                })}
                                {invalidStepIndices.length > 2 && (
                                  <span className={styles.smartFlowInvalidStep}>
                                    +{invalidStepIndices.length - 2} more
                                  </span>
                                )}
                              </div>
                            )}
                            <button
                              type="button"
                              className={`${styles.smartFlowRunButton} ${showInvalidState ? styles.smartFlowRunButtonDisabled : ''}`}
                              onClick={() => handleRunFlow(flow, effectiveActiveZone)}
                              disabled={isLoading || showInvalidState}
                              title={showInvalidState ? `Cannot run: ${invalidStepIndices.length} step(s) reference unreachable panels` : undefined}
                            >
                              {showInvalidState ? '⚠️ Cannot Run' : '▶ Run Flow'}
                            </button>
                          </div>
                        );
                      })}
                      {/* Add flow card in edit mode */}
                      {isEditMode && (
                        <button
                          type="button"
                          className={`${styles.favAddItemCard} ${styles.favAddItemCardPurple}`}
                          onClick={() => handleCreateFlow(effectiveActiveZone)}
                          title="Create a new smart flow"
                        >
                          <span className={styles.favAddItemIcon}>⚡</span>
                          <span className={styles.favAddItemText}>Create Flow</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    /* Empty flows state */
                    <div className={styles.favSubSectionEmpty}>
                      <p>No smart flows in this zone yet.</p>
                      {isEditMode && (
                        <button
                          type="button"
                          className={styles.favActionButton}
                          onClick={() => handleCreateFlow(effectiveActiveZone)}
                          data-variant="purple"
                        >
                          ⚡ Create Flow
                        </button>
                      )}
                    </div>
                  )}
                </div>

              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
