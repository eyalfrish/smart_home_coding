'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import styles from './discovery-dashboard.module.css';
import type { LivePanelState, DiscoveryResult } from '@/lib/discovery/types';
import { getRelayDeviceType, getCurtainDeviceType, type DeviceType } from '@/lib/discovery/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Type of favorite item: light (relay), shade (curtain), or venetian
 */
export type FavoriteType = 'light' | 'shade' | 'venetian';

/**
 * A single favorite switch entry.
 */
export interface FavoriteSwitch {
  /** IP address of the panel */
  ip: string;
  /** Index on the panel (relay index for lights, curtain index for shades) */
  index: number;
  /** Type of switch: light, shade, or venetian */
  type: FavoriteType;
  /** Original name from the panel */
  originalName: string;
  /** User-defined alias (defaults to originalName) */
  alias: string;
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
  /** ID of the switch to control (format: "ip:type:index") */
  switchId: string;
  /** Action to perform: "on", "off", "toggle", "open", "close", "stop" */
  action: 'on' | 'off' | 'toggle' | 'open' | 'close' | 'stop';
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
  unreachableSwitchIds: Set<string>;
  unreachableCount: number;
  invalidFlowSteps: Map<string, number[]>;
  invalidFlowCount: number;
}

interface FavoritesSectionProps {
  /** Currently selected profile (null if none selected) */
  profile: ProfileData | null;
  /** Set of discovered panel IPs */
  discoveredPanelIps: Set<string>;
  /** Whether discovery is currently running */
  isLoading: boolean;
  /** Whether discovery has completed at least once */
  discoveryCompleted: boolean;
  /** Live panel states from WebSocket connections */
  livePanelStates: Map<string, LivePanelState>;
  /** Discovered panels for switch picker */
  discoveredPanels?: DiscoveryResult[];
  /** Callback when favorites are updated */
  onFavoritesUpdate?: (profileId: number, favorites: FavoritesData) => void;
  /** Callback when smart switches are updated */
  onSmartSwitchesUpdate?: (profileId: number, smartSwitches: SmartSwitchesData) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function parseFavorites(favorites: unknown): FavoritesData {
  if (!favorites || typeof favorites !== 'object') {
    return { zones: {} };
  }
  const favObj = favorites as Record<string, unknown>;
  if (favObj.zones && typeof favObj.zones === 'object') {
    // Migrate old format (relayIndex) to new format (index, type)
    const zones = favObj.zones as Record<string, unknown[]>;
    const migratedZones: Record<string, FavoriteSwitch[]> = {};
    for (const [zoneName, switches] of Object.entries(zones)) {
      migratedZones[zoneName] = (switches || []).map((sw: unknown) => {
        const swObj = sw as Record<string, unknown>;
        // Handle old format with relayIndex
        if ('relayIndex' in swObj && !('index' in swObj)) {
          return {
            ip: swObj.ip as string,
            index: swObj.relayIndex as number,
            type: 'light' as FavoriteType,
            originalName: (swObj.name as string) || '',
            alias: (swObj.name as string) || '',
          };
        }
        return {
          ip: swObj.ip as string,
          index: swObj.index as number,
          type: (swObj.type as FavoriteType) || 'light',
          originalName: swObj.originalName as string || swObj.name as string || '',
          alias: swObj.alias as string || swObj.name as string || '',
        };
      });
    }
    return { zones: migratedZones };
  }
  return { zones: {} };
}

function parseSmartSwitches(smartSwitches: unknown): SmartSwitchesData {
  if (!smartSwitches || typeof smartSwitches !== 'object') {
    return { zones: {} };
  }
  const ssObj = smartSwitches as Record<string, unknown>;
  if (ssObj.zones && typeof ssObj.zones === 'object') {
    return smartSwitches as SmartSwitchesData;
  }
  return { zones: {} };
}

function validateSwitchesAndFlows(
  favoritesData: FavoritesData,
  smartSwitchesData: SmartSwitchesData,
  discoveredPanelIps: Set<string>,
  livePanelStates: Map<string, LivePanelState>,
  discoveryCompleted: boolean,
): ValidationResult {
  const unreachableSwitchIds = new Set<string>();
  const invalidFlowSteps = new Map<string, number[]>();
  
  if (!discoveryCompleted) {
    return { unreachableSwitchIds, unreachableCount: 0, invalidFlowSteps, invalidFlowCount: 0 };
  }

  const isPanelReachable = (ip: string): boolean => {
    if (!discoveredPanelIps.has(ip)) return false;
    const state = livePanelStates.get(ip);
    return !state || state.connectionStatus === 'connected' || state.connectionStatus === 'connecting';
  };

  for (const [_zoneName, switches] of Object.entries(favoritesData.zones || {})) {
    for (const sw of switches) {
      const switchId = `${sw.ip}:${sw.type}:${sw.index}`;
      if (!isPanelReachable(sw.ip)) {
        unreachableSwitchIds.add(switchId);
      }
    }
  }

  for (const [_zoneName, flows] of Object.entries(smartSwitchesData.zones || {})) {
    for (const flow of flows) {
      const invalidSteps: number[] = [];
      flow.steps.forEach((step, idx) => {
        const ip = step.switchId.split(':')[0];
        if (!isPanelReachable(ip)) {
          invalidSteps.push(idx);
          unreachableSwitchIds.add(step.switchId);
        }
      });
      if (invalidSteps.length > 0) {
        invalidFlowSteps.set(flow.name, invalidSteps);
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

// Send command to panel via API
async function sendPanelCommand(
  ip: string,
  command: 'toggle_relay' | 'set_relay' | 'curtain',
  options: { index?: number; state?: boolean; action?: 'open' | 'close' | 'stop' }
): Promise<boolean> {
  try {
    const res = await fetch('/api/panels/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ips: [ip],
        command,
        ...options,
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.successCount > 0;
  } catch (err) {
    console.error('[FavoritesSection] Command error:', err);
    return false;
  }
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
  discoveredPanels = [],
  onFavoritesUpdate,
  onSmartSwitchesUpdate,
}: FavoritesSectionProps) {
  // State
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  
  // Inline editing states
  const [showNewZoneInput, setShowNewZoneInput] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [showFlowCreator, setShowFlowCreator] = useState(false);
  const [newFlowName, setNewFlowName] = useState('');
  
  // Context menu state for renaming
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    switchId: string;
    currentAlias: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'zone' | 'switch' | 'flow';
    name: string;
    onConfirm: () => void;
  } | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  // Reset warning dismissed state when profile changes
  useEffect(() => {
    setWarningDismissed(false);
  }, [profile?.id]);

  // Parse favorites from profile (no placeholders)
  const favoritesData = useMemo(() => {
    if (!profile) return { zones: {} };
    return parseFavorites(profile.favorites);
  }, [profile]);

  // Parse smart switches from profile (no placeholders)
  const smartSwitchesData = useMemo(() => {
    if (!profile) return { zones: {} };
    return parseSmartSwitches(profile.smart_switches);
  }, [profile]);

  // Combine zones from both favorites and smart switches
  const allZones = useMemo(() => {
    const favoriteZones = new Set(Object.keys(favoritesData.zones || {}));
    const smartZones = new Set(Object.keys(smartSwitchesData.zones || {}));
    return [...new Set([...favoriteZones, ...smartZones])];
  }, [favoritesData.zones, smartSwitchesData.zones]);

  const totalSwitches = Object.values(favoritesData.zones || {}).reduce(
    (sum, switches) => sum + switches.length, 0
  );

  const totalFlows = Object.values(smartSwitchesData.zones || {}).reduce(
    (sum, flows) => sum + flows.length, 0
  );

  // Set first zone as active when expanded and no zone is selected
  const effectiveActiveZone = activeZone ?? (allZones.length > 0 ? allZones[0] : null);

  // Get current zone data
  const currentZoneSwitches = effectiveActiveZone 
    ? (favoritesData.zones || {})[effectiveActiveZone] ?? []
    : [];
  const currentZoneFlows = effectiveActiveZone 
    ? (smartSwitchesData.zones || {})[effectiveActiveZone] ?? []
    : [];

  // Validation
  const validation = useMemo(() => {
    return validateSwitchesAndFlows(
      favoritesData,
      smartSwitchesData,
      discoveredPanelIps,
      livePanelStates,
      discoveryCompleted
    );
  }, [favoritesData, smartSwitchesData, discoveredPanelIps, livePanelStates, discoveryCompleted]);

  const isSwitchUnreachable = useCallback((sw: FavoriteSwitch): boolean => {
    return validation.unreachableSwitchIds.has(`${sw.ip}:${sw.type}:${sw.index}`);
  }, [validation.unreachableSwitchIds]);

  const hasInvalidSteps = useCallback((flow: SmartFlow): boolean => {
    return validation.invalidFlowSteps.has(flow.name);
  }, [validation.invalidFlowSteps]);

  const getInvalidStepIndices = useCallback((flow: SmartFlow): number[] => {
    return validation.invalidFlowSteps.get(flow.name) ?? [];
  }, [validation.invalidFlowSteps]);

  // Only show validation warning AFTER discovery completes (not during loading)
  const showValidationWarning = !isLoading && validation.unreachableCount > 0 && !warningDismissed && discoveryCompleted;

  // Get available devices from discovered panels - ONLY direct switches (not hidden)
  const availableDevices = useMemo(() => {
    const devices: Array<{
      id: string;
      ip: string;
      index: number;
      type: FavoriteType;
      name: string;
      panelName: string;
      deviceType: DeviceType;
    }> = [];

    for (const panel of discoveredPanels) {
      if (panel.status !== 'panel') continue;
      const liveState = livePanelStates.get(panel.ip);
      const panelName = liveState?.fullState?.hostname || panel.name || panel.ip;
      const relays = liveState?.fullState?.relays || [];
      const curtains = liveState?.fullState?.curtains || [];
      const relayPairs = panel.settings?.relayPairs;
      
      // Add relays (lights) - only direct switches, not hidden
      for (const relay of relays) {
        const deviceType = getRelayDeviceType(relay.index, relay.name, relayPairs);
        // Only show 'light' type relays (direct switches with proper names)
        if (deviceType === 'light') {
          devices.push({
            id: `${panel.ip}:light:${relay.index}`,
            ip: panel.ip,
            index: relay.index,
            type: 'light',
            name: relay.name || `Light ${relay.index + 1}`,
            panelName,
            deviceType,
          });
        }
      }
      
      // Add curtains (shades/venetians)
      for (const curtain of curtains) {
        const deviceType = getCurtainDeviceType(curtain.index, curtain.name, relayPairs);
        if (deviceType === 'curtain' || deviceType === 'venetian') {
          devices.push({
            id: `${panel.ip}:${deviceType === 'venetian' ? 'venetian' : 'shade'}:${curtain.index}`,
            ip: panel.ip,
            index: curtain.index,
            type: deviceType === 'venetian' ? 'venetian' : 'shade',
            name: curtain.name || `Shade ${curtain.index + 1}`,
            panelName,
            deviceType,
          });
        }
      }
    }
    return devices;
  }, [discoveredPanels, livePanelStates]);

  // Get live state for a switch
  const getSwitchState = useCallback((sw: FavoriteSwitch): { isOn?: boolean; curtainState?: string } => {
    const liveState = livePanelStates.get(sw.ip);
    if (!liveState?.fullState) return {};
    
    if (sw.type === 'light') {
      const relay = liveState.fullState.relays.find(r => r.index === sw.index);
      return { isOn: relay?.state };
    } else {
      const curtain = liveState.fullState.curtains.find(c => c.index === sw.index);
      return { curtainState: curtain?.state };
    }
  }, [livePanelStates]);

  // =============================================================================
  // Handlers
  // =============================================================================

  const handleLightClick = useCallback(async (sw: FavoriteSwitch) => {
    if (sw.type !== 'light') return;
    console.log('[FavoritesSection] Toggle light:', sw.alias);
    await sendPanelCommand(sw.ip, 'toggle_relay', { index: sw.index });
  }, []);

  const handleShadeAction = useCallback(async (sw: FavoriteSwitch, action: 'open' | 'close' | 'stop') => {
    if (sw.type !== 'shade' && sw.type !== 'venetian') return;
    console.log('[FavoritesSection] Shade action:', sw.alias, action);
    await sendPanelCommand(sw.ip, 'curtain', { index: sw.index, action });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, sw: FavoriteSwitch) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      switchId: `${sw.ip}:${sw.type}:${sw.index}`,
      currentAlias: sw.alias,
    });
    setRenameValue(sw.alias);
  }, []);

  const handleRename = useCallback(() => {
    if (!contextMenu || !profile || !effectiveActiveZone || !renameValue.trim()) return;
    
    const [ip, type, indexStr] = contextMenu.switchId.split(':');
    const index = parseInt(indexStr, 10);
    
    const currentSwitches = (favoritesData.zones || {})[effectiveActiveZone] || [];
    const newSwitches = currentSwitches.map(sw => {
      if (sw.ip === ip && sw.type === type && sw.index === index) {
        return { ...sw, alias: renameValue.trim() };
      }
      return sw;
    });
    
    const newFavorites: FavoritesData = {
      zones: {
        ...(favoritesData.zones || {}),
        [effectiveActiveZone]: newSwitches,
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
    setContextMenu(null);
  }, [contextMenu, profile, effectiveActiveZone, renameValue, favoritesData.zones, onFavoritesUpdate]);

  const handleAddZone = useCallback(() => {
    if (!newZoneName.trim() || !profile) return;
    const zoneName = newZoneName.trim();
    
    if (allZones.includes(zoneName)) return;
    
    const newFavorites: FavoritesData = {
      zones: { ...(favoritesData.zones || {}), [zoneName]: [] }
    };
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: { ...(smartSwitchesData.zones || {}), [zoneName]: [] }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    
    setActiveZone(zoneName);
    setNewZoneName('');
    setShowNewZoneInput(false);
  }, [newZoneName, profile, allZones, favoritesData.zones, smartSwitchesData.zones, onFavoritesUpdate, onSmartSwitchesUpdate]);

  const handleDeleteZone = useCallback((zoneName: string) => {
    if (!profile) return;
    
    const { [zoneName]: _, ...restFavorites } = favoritesData.zones || {};
    const { [zoneName]: __, ...restSmartSwitches } = smartSwitchesData.zones || {};
    
    onFavoritesUpdate?.(profile.id, { zones: restFavorites });
    onSmartSwitchesUpdate?.(profile.id, { zones: restSmartSwitches });
    
    if (activeZone === zoneName) {
      const remaining = allZones.filter(z => z !== zoneName);
      setActiveZone(remaining.length > 0 ? remaining[0] : null);
    }
  }, [profile, favoritesData.zones, smartSwitchesData.zones, activeZone, allZones, onFavoritesUpdate, onSmartSwitchesUpdate]);

  const handleAddDevice = useCallback((device: typeof availableDevices[0]) => {
    if (!profile || !effectiveActiveZone) return;
    
    const newSwitch: FavoriteSwitch = {
      ip: device.ip,
      index: device.index,
      type: device.type,
      originalName: device.name,
      alias: device.name,
    };
    
    const currentSwitches = (favoritesData.zones || {})[effectiveActiveZone] || [];
    
    // Check if already exists
    if (currentSwitches.some(s => s.ip === device.ip && s.index === device.index && s.type === device.type)) {
      return;
    }
    
    const newFavorites: FavoritesData = {
      zones: {
        ...(favoritesData.zones || {}),
        [effectiveActiveZone]: [...currentSwitches, newSwitch],
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
  }, [profile, effectiveActiveZone, favoritesData.zones, onFavoritesUpdate]);

  const handleRemoveSwitch = useCallback((sw: FavoriteSwitch) => {
    if (!profile || !effectiveActiveZone) return;
    
    const currentSwitches = (favoritesData.zones || {})[effectiveActiveZone] || [];
    const newSwitches = currentSwitches.filter(
      s => !(s.ip === sw.ip && s.index === sw.index && s.type === sw.type)
    );
    
    const newFavorites: FavoritesData = {
      zones: {
        ...(favoritesData.zones || {}),
        [effectiveActiveZone]: newSwitches,
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
  }, [profile, effectiveActiveZone, favoritesData.zones, onFavoritesUpdate]);

  const handleCreateFlow = useCallback(() => {
    if (!newFlowName.trim() || !profile || !effectiveActiveZone) return;
    
    const newFlow: SmartFlow = {
      name: newFlowName.trim(),
      steps: [],
    };
    
    const currentFlows = (smartSwitchesData.zones || {})[effectiveActiveZone] || [];
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: {
        ...(smartSwitchesData.zones || {}),
        [effectiveActiveZone]: [...currentFlows, newFlow],
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    setNewFlowName('');
    setShowFlowCreator(false);
  }, [newFlowName, profile, effectiveActiveZone, smartSwitchesData.zones, onSmartSwitchesUpdate]);

  const handleDeleteFlow = useCallback((flowIndex: number) => {
    if (!profile || !effectiveActiveZone) return;
    
    const currentFlows = (smartSwitchesData.zones || {})[effectiveActiveZone] || [];
    const newFlows = currentFlows.filter((_, i) => i !== flowIndex);
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: {
        ...(smartSwitchesData.zones || {}),
        [effectiveActiveZone]: newFlows,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
  }, [profile, effectiveActiveZone, smartSwitchesData.zones, onSmartSwitchesUpdate]);

  const handleRunFlow = useCallback((flow: SmartFlow) => {
    // TODO: Implement actual flow execution
    console.log('[FavoritesSection] Would execute flow:', flow.name);
    flow.steps.forEach((step, idx) => {
      console.log(`  Step ${idx + 1}: ${step.switchId} → ${step.action} (delay: ${step.delayMs}ms)`);
    });
  }, []);

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <div className={`${styles.collapsibleSection} ${isExpanded ? styles.collapsibleSectionExpanded : ''}`}>
      {/* Header */}
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
            {profile && allZones.length > 0 && (
              <span className={styles.favoritesBadge}>
                {allZones.length} zone{allZones.length !== 1 ? 's' : ''} · {totalSwitches} switch{totalSwitches !== 1 ? 'es' : ''}
                {totalFlows > 0 && ` · ${totalFlows} flow${totalFlows !== 1 ? 's' : ''}`}
              </span>
            )}
          </h3>
        </div>
      </div>

      {/* Collapsed summary - clickable buttons grouped by zone */}
      {!isExpanded && profile && allZones.length > 0 && (
        <div className={styles.favoritesCollapsedView}>
          {allZones.map((zoneName) => {
            const zoneSwitches = (favoritesData.zones || {})[zoneName] || [];
            const zoneFlows = (smartSwitchesData.zones || {})[zoneName] || [];
            if (zoneSwitches.length === 0 && zoneFlows.length === 0) return null;
            
            return (
              <div key={zoneName} className={styles.favoritesCollapsedZone}>
                <div className={styles.favoritesCollapsedZoneName}>{zoneName}</div>
                <div className={styles.favoritesCollapsedItems}>
                  {zoneSwitches.map((sw, idx) => {
                    const isDiscovered = discoveredPanelIps.has(sw.ip);
                    const isUnreachable = isSwitchUnreachable(sw);
                    const isReachable = isDiscovered && !isUnreachable;
                    // Only show invalid state AFTER discovery completes (not during loading)
                    const showInvalidState = !isLoading && discoveryCompleted && isUnreachable;
                    const switchState = getSwitchState(sw);
                    const isInMotion = switchState.curtainState === 'opening' || switchState.curtainState === 'closing';
                    
                    if (sw.type === 'light') {
                      return (
                        <button
                          key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                          type="button"
                          className={`${styles.favoritesCollapsedButton} ${switchState.isOn ? styles.favoritesCollapsedButtonOn : ''} ${showInvalidState ? styles.favoritesCollapsedButtonInvalid : ''}`}
                          onClick={() => isReachable && handleLightClick(sw)}
                          disabled={isLoading || !isReachable}
                          title={sw.alias}
                        >
                          <span className={styles.favoritesCollapsedIcon}>
                            {showInvalidState ? '⚠️' : switchState.isOn ? '💡' : '⭘'}
                          </span>
                          <span className={styles.favoritesCollapsedLabel}>{sw.alias}</span>
                        </button>
                      );
                    } else {
                      // Shade/Venetian
                      return (
                        <div
                          key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                          className={`${styles.favoritesCollapsedShade} ${showInvalidState ? styles.favoritesCollapsedButtonInvalid : ''}`}
                        >
                          <span className={styles.favoritesCollapsedIcon}>
                            {showInvalidState ? '⚠️' : sw.type === 'venetian' ? '🪟' : '🪞'}
                          </span>
                          <span className={styles.favoritesCollapsedLabel}>{sw.alias}</span>
                          <div className={styles.favoritesCollapsedShadeButtons}>
                            {isInMotion ? (
                              <button
                                type="button"
                                className={styles.favoritesCollapsedShadeStop}
                                onClick={() => isReachable && handleShadeAction(sw, 'stop')}
                                disabled={isLoading || !isReachable}
                              >
                                ⬛
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => isReachable && handleShadeAction(sw, 'open')}
                                  disabled={isLoading || !isReachable}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={() => isReachable && handleShadeAction(sw, 'close')}
                                  disabled={isLoading || !isReachable}
                                >
                                  ▼
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    }
                  })}
                  {zoneFlows.map((flow, idx) => {
                    const flowHasInvalidSteps = hasInvalidSteps(flow);
                    // Only show invalid state AFTER discovery completes (not during loading)
                    const showInvalidState = !isLoading && discoveryCompleted && flowHasInvalidSteps;
                    
                    return (
                      <button
                        key={`flow-${flow.name}-${idx}`}
                        type="button"
                        className={`${styles.favoritesCollapsedButton} ${styles.favoritesCollapsedButtonFlow} ${showInvalidState ? styles.favoritesCollapsedButtonInvalid : ''}`}
                        onClick={() => !showInvalidState && handleRunFlow(flow)}
                        disabled={isLoading || showInvalidState}
                        title={flow.name}
                      >
                        <span className={styles.favoritesCollapsedIcon}>
                          {showInvalidState ? '⚠️' : '⚡'}
                        </span>
                        <span className={styles.favoritesCollapsedLabel}>{flow.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expandable content */}
      <div className={styles.collapsibleSectionContent}>
        {/* Validation warning */}
        {showValidationWarning && profile && (
          <div className={styles.validationWarning}>
            <span className={styles.validationWarningIcon}>⚠️</span>
            <span className={styles.validationWarningText}>
              {validation.unreachableCount} switch{validation.unreachableCount !== 1 ? 'es' : ''} unreachable
              {validation.invalidFlowCount > 0 && (
                <> · {validation.invalidFlowCount} flow{validation.invalidFlowCount !== 1 ? 's' : ''} affected</>
              )}
            </span>
            <button
              type="button"
              className={styles.validationWarningDismiss}
              onClick={() => setWarningDismissed(true)}
            >
              ✕
            </button>
          </div>
        )}

        {/* No profile message */}
        {!profile && (
          <div className={styles.favoritesEmptyState}>
            <div className={styles.favoritesEmptyIcon}>👤</div>
            <p>Select or create a profile to manage your favorites.</p>
          </div>
        )}

        {/* Main content when profile exists */}
        {profile && (
          <>
            {/* Zone Navigation Row */}
            <div className={styles.favZoneNavRow}>
              <div className={styles.favoritesZoneTabs}>
                {allZones.map((zoneName) => (
                  <button
                    key={zoneName}
                    type="button"
                    className={`${styles.favoritesZoneTab} ${effectiveActiveZone === zoneName ? styles.favoritesZoneTabActive : ''}`}
                    onClick={() => setActiveZone(zoneName)}
                  >
                    {zoneName}
                    <span
                      className={styles.favoritesZoneTabDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm({
                          type: 'zone',
                          name: zoneName,
                          onConfirm: () => handleDeleteZone(zoneName),
                        });
                      }}
                      title="Delete zone"
                    >
                      ✕
                    </span>
                  </button>
                ))}
                
                {/* Add Zone - styled as a zone tab */}
                {showNewZoneInput ? (
                  <div className={styles.newZoneInputInline}>
                    <input
                      type="text"
                      value={newZoneName}
                      onChange={(e) => setNewZoneName(e.target.value)}
                      placeholder="Zone name..."
                      className={styles.newZoneInputField}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddZone();
                        if (e.key === 'Escape') {
                          setShowNewZoneInput(false);
                          setNewZoneName('');
                        }
                      }}
                    />
                    <span
                      className={styles.newZoneInputConfirm}
                      onClick={handleAddZone}
                      style={{ opacity: newZoneName.trim() ? 1 : 0.4 }}
                    >
                      ✓
                    </span>
                    <span
                      className={styles.newZoneInputCancel}
                      onClick={() => {
                        setShowNewZoneInput(false);
                        setNewZoneName('');
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${styles.favoritesZoneTab} ${styles.favoritesZoneTabAdd}`}
                    onClick={() => setShowNewZoneInput(true)}
                  >
                    + Add Zone
                  </button>
                )}
              </div>
            </div>

            {/* No zones empty state */}
            {allZones.length === 0 && (
              <div className={styles.favoritesEmptyState}>
                <div className={styles.favoritesEmptyIcon}>🏠</div>
                <p>No zones yet. Create a zone to organize your switches.</p>
                <button
                  type="button"
                  className={styles.favActionButton}
                  onClick={() => setShowNewZoneInput(true)}
                  data-variant="primary"
                >
                  ➕ Create Your First Zone
                </button>
              </div>
            )}

            {/* Active zone content */}
            {effectiveActiveZone && allZones.length > 0 && (
              <div className={styles.favZoneContentWrapper}>
                
                {/* SWITCHES SECTION */}
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

                  <div className={styles.favoritesSwitchGrid}>
                    {currentZoneSwitches.map((sw, idx) => {
                      const isDiscovered = discoveredPanelIps.has(sw.ip);
                      const isUnreachable = isSwitchUnreachable(sw);
                      const isReachable = isDiscovered && !isUnreachable;
                      // Only show invalid state AFTER discovery completes (not during loading)
                      const showInvalidState = !isLoading && discoveryCompleted && isUnreachable;
                      const switchState = getSwitchState(sw);
                      
                      // Render based on type
                      if (sw.type === 'light') {
                        // Light switch - single toggle button
                        return (
                          <div
                            key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                            className={`${styles.favoriteSwitchCard} ${!isReachable ? styles.favoriteSwitchCardDisabled : ''} ${showInvalidState ? styles.favoriteSwitchCardInvalid : ''}`}
                            onContextMenu={(e) => handleContextMenu(e, sw)}
                          >
                            <button
                              type="button"
                              className={`${styles.favoriteSwitchButton} ${switchState.isOn ? styles.favoriteSwitchButtonOn : ''}`}
                              onClick={() => isReachable && handleLightClick(sw)}
                              disabled={isLoading || !isReachable}
                              title={isReachable ? `Toggle ${sw.alias}` : 'Switch not reachable'}
                            >
                              <span className={styles.favoriteSwitchIcon}>
                                {showInvalidState ? '⚠️' : switchState.isOn ? '💡' : '⭘'}
                              </span>
                              <span className={styles.favoriteSwitchName}>{sw.alias}</span>
                            </button>
                            <button
                              type="button"
                              className={styles.favoriteRemoveButton}
                              onClick={() => setDeleteConfirm({
                                type: 'switch',
                                name: sw.alias,
                                onConfirm: () => handleRemoveSwitch(sw),
                              })}
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      } else {
                        // Shade/Venetian - show up/down normally, stop when in motion
                        const isInMotion = switchState.curtainState === 'opening' || switchState.curtainState === 'closing';
                        
                        return (
                          <div
                            key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                            className={`${styles.favoriteShadeCard} ${!isReachable ? styles.favoriteShadeCardDisabled : ''} ${showInvalidState ? styles.favoriteShadeCardInvalid : ''}`}
                            onContextMenu={(e) => handleContextMenu(e, sw)}
                          >
                            <div className={styles.favoriteShadeHeader}>
                              <span className={styles.favoriteShadeIcon}>
                                {showInvalidState ? '⚠️' : sw.type === 'venetian' ? '🪟' : '🪞'}
                              </span>
                              <span className={styles.favoriteShadeName}>{sw.alias}</span>
                            </div>
                            <div className={styles.favoriteShadeButtons}>
                              {isInMotion ? (
                                // Show STOP button when in motion
                                <button
                                  type="button"
                                  className={`${styles.favoriteShadeButton} ${styles.favoriteShadeButtonStop}`}
                                  onClick={() => isReachable && handleShadeAction(sw, 'stop')}
                                  disabled={isLoading || !isReachable}
                                  title="Stop"
                                >
                                  ⬛
                                </button>
                              ) : (
                                // Show UP/DOWN buttons when idle
                                <>
                                  <button
                                    type="button"
                                    className={styles.favoriteShadeButton}
                                    onClick={() => isReachable && handleShadeAction(sw, 'open')}
                                    disabled={isLoading || !isReachable}
                                    title="Open"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.favoriteShadeButton}
                                    onClick={() => isReachable && handleShadeAction(sw, 'close')}
                                    disabled={isLoading || !isReachable}
                                    title="Close"
                                  >
                                    ▼
                                  </button>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              className={styles.favoriteRemoveButton}
                              onClick={() => setDeleteConfirm({
                                type: 'switch',
                                name: sw.alias,
                                onConfirm: () => handleRemoveSwitch(sw),
                              })}
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      }
                    })}
                    
                    {/* Add Switch */}
                    {showSwitchPicker ? (
                      <div className={styles.switchPickerInline}>
                        <div className={styles.switchPickerHeader}>
                          <span>Add Switch</span>
                          <button onClick={() => setShowSwitchPicker(false)}>✕</button>
                        </div>
                        <div className={styles.switchPickerList}>
                          {availableDevices.length === 0 ? (
                            <div className={styles.switchPickerEmpty}>
                              Run discovery to find panels
                            </div>
                          ) : (
                            availableDevices.map(device => {
                              const alreadyAdded = currentZoneSwitches.some(
                                s => s.ip === device.ip && s.index === device.index && s.type === device.type
                              );
                              return (
                                <button
                                  key={device.id}
                                  type="button"
                                  className={`${styles.switchPickerItem} ${alreadyAdded ? styles.switchPickerItemAdded : ''}`}
                                  onClick={() => !alreadyAdded && handleAddDevice(device)}
                                  disabled={alreadyAdded}
                                >
                                  <span className={styles.switchPickerItemIcon}>
                                    {device.type === 'light' ? '💡' : device.type === 'venetian' ? '🪟' : '🪞'}
                                  </span>
                                  <span className={styles.switchPickerItemName}>{device.name}</span>
                                  <span className={styles.switchPickerItemPanel}>{device.panelName}</span>
                                  {alreadyAdded && <span className={styles.switchPickerItemCheck}>✓</span>}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.favAddItemCard}
                        onClick={() => setShowSwitchPicker(true)}
                        title="Add a switch to this zone"
                      >
                        <span className={styles.favAddItemIcon}>➕</span>
                        <span className={styles.favAddItemText}>Add Switch</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* FLOWS SECTION */}
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

                  <div className={styles.smartFlowsGrid}>
                    {currentZoneFlows.map((flow, idx) => {
                      const flowHasInvalidSteps = hasInvalidSteps(flow);
                      const invalidStepIndices = getInvalidStepIndices(flow);
                      // Only show invalid state AFTER discovery completes (not during loading)
                      const showInvalidState = !isLoading && discoveryCompleted && flowHasInvalidSteps;
                      
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
                            <button
                              type="button"
                              className={styles.smartFlowDelete}
                              onClick={() => setDeleteConfirm({
                                type: 'flow',
                                name: flow.name,
                                onConfirm: () => handleDeleteFlow(idx),
                              })}
                              title="Delete flow"
                            >
                              ✕
                            </button>
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
                          <button
                            type="button"
                            className={`${styles.smartFlowRunButton} ${showInvalidState ? styles.smartFlowRunButtonDisabled : ''}`}
                            onClick={() => handleRunFlow(flow)}
                            disabled={isLoading || showInvalidState}
                          >
                            {showInvalidState ? '⚠️ Cannot Run' : '▶ Run'}
                          </button>
                        </div>
                      );
                    })}
                    
                    {/* Create Flow */}
                    {showFlowCreator ? (
                      <div className={styles.flowCreatorInline}>
                        <input
                          type="text"
                          value={newFlowName}
                          onChange={(e) => setNewFlowName(e.target.value)}
                          placeholder="Flow name..."
                          className={styles.flowCreatorInput}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newFlowName.trim()) handleCreateFlow();
                            if (e.key === 'Escape') {
                              setShowFlowCreator(false);
                              setNewFlowName('');
                            }
                          }}
                        />
                        <div className={styles.flowCreatorButtons}>
                          <button
                            type="button"
                            className={styles.flowCreatorConfirm}
                            onClick={handleCreateFlow}
                            disabled={!newFlowName.trim()}
                          >
                            Create
                          </button>
                          <button
                            type="button"
                            className={styles.flowCreatorCancel}
                            onClick={() => {
                              setShowFlowCreator(false);
                              setNewFlowName('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.favAddItemCard} ${styles.favAddItemCardPurple}`}
                        onClick={() => setShowFlowCreator(true)}
                        title="Create a new smart flow"
                      >
                        <span className={styles.favAddItemIcon}>⚡</span>
                        <span className={styles.favAddItemText}>Create Flow</span>
                      </button>
                    )}
                  </div>
                </div>

              </div>
            )}
          </>
        )}
      </div>

      {/* Context Menu for Renaming */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className={styles.contextMenuTitle}>Rename</div>
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className={styles.contextMenuInput}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setContextMenu(null);
            }}
          />
          <div className={styles.contextMenuButtons}>
            <button onClick={handleRename} disabled={!renameValue.trim()}>Save</button>
            <button onClick={() => setContextMenu(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className={styles.deleteConfirmOverlay} onClick={() => setDeleteConfirm(null)}>
          <div className={styles.deleteConfirmModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.deleteConfirmIcon}>🗑️</div>
            <div className={styles.deleteConfirmTitle}>
              Delete {deleteConfirm.type}?
            </div>
            <div className={styles.deleteConfirmMessage}>
              &quot;{deleteConfirm.name}&quot;
              {deleteConfirm.type === 'zone' && (
                <><br /><small>All switches and flows will be removed</small></>
              )}
            </div>
            <div className={styles.deleteConfirmButtons}>
              <button
                type="button"
                className={styles.deleteConfirmButtonCancel}
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.deleteConfirmButtonDelete}
                onClick={() => {
                  deleteConfirm.onConfirm();
                  setDeleteConfirm(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
