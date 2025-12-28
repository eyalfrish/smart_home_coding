'use client';

import { useState, useMemo, useCallback } from 'react';
import styles from './discovery-dashboard.module.css';

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

interface FavoritesSectionProps {
  /** Currently selected profile (null if none selected) */
  profile: ProfileData | null;
  /** Set of discovered panel IPs (for showing which switches are available) */
  discoveredPanelIps: Set<string>;
  /** Whether discovery is currently running */
  isLoading: boolean;
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

export default function FavoritesSection({
  profile,
  discoveredPanelIps,
  isLoading,
  onFavoritesUpdate,
  onSmartSwitchesUpdate,
}: FavoritesSectionProps) {
  // State
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeZone, setActiveZone] = useState<string | null>(null);

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
  // Handlers
  // =============================================================================

  const handleSwitchClick = useCallback((sw: FavoriteSwitch, isDiscovered: boolean) => {
    console.log('[FavoritesSection] Switch clicked:', {
      switch: sw,
      isDiscovered,
      profileId: profile?.id,
    });

    if (!isDiscovered) {
      console.log('[FavoritesSection] Switch not available - panel not discovered');
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
                        return (
                          <button
                            key={`${sw.ip}-${sw.relayIndex}-${idx}`}
                            type="button"
                            className={`${styles.favoriteSwitchButton} ${isDiscovered ? '' : styles.favoriteSwitchButtonDisabled}`}
                            onClick={() => handleSwitchClick(sw, isDiscovered)}
                            disabled={isLoading}
                            title={isDiscovered ? `${sw.name} (${sw.ip} relay ${sw.relayIndex})` : `${sw.name} - Panel not discovered`}
                          >
                            <span className={styles.favoriteSwitchIcon}>
                              {isDiscovered ? '💡' : '⭘'}
                            </span>
                            <span className={styles.favoriteSwitchName}>{sw.name}</span>
                            <span className={styles.favoriteSwitchIp}>
                              {sw.ip.split('.').slice(-1)[0]}:{sw.relayIndex}
                            </span>
                            {!isDiscovered && (
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
                      {currentZoneFlows.map((flow, idx) => (
                        <div
                          key={`flow-${flow.name}-${idx}`}
                          className={styles.smartFlowCard}
                        >
                          <div className={styles.smartFlowCardHeader}>
                            <span className={styles.smartFlowIcon}>⚡</span>
                            <span className={styles.smartFlowName}>{flow.name}</span>
                          </div>
                          <div className={styles.smartFlowMeta}>
                            {flow.steps.length} step{flow.steps.length !== 1 ? 's' : ''}
                            {flow.steps.length > 0 && (
                              <span className={styles.smartFlowDuration}>
                                ~{Math.ceil(flow.steps.reduce((acc, s) => acc + s.delayMs, 0) / 1000)}s
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className={styles.smartFlowRunButton}
                            onClick={() => handleRunFlow(flow, effectiveActiveZone)}
                            disabled={isLoading}
                          >
                            ▶ Run Flow
                          </button>
                        </div>
                      ))}
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
