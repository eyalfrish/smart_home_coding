'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import styles from './discovery-dashboard.module.css';
import type { LivePanelState, DiscoveryResult } from '@/lib/discovery/types';
import { getRelayDeviceType, getCurtainDeviceType, type DeviceType } from '@/lib/discovery/types';

// Import shared types for SmartActions (used by both client and server)
import type {
  SmartAction,
  ActionStage,
  StageAction,
  ActionScheduling,
  ActionStep,
  StageActionType,
  SchedulingType,
  SmartSwitchesData,
  ActionExecutionProgress as ServerActionExecutionProgress,
  StartActionResponse,
  StopActionResponse,
} from '@/lib/types/smart-actions';

// Re-export types for backward compatibility with other components
export type {
  SmartAction,
  ActionStage,
  StageAction,
  ActionScheduling,
  ActionStep,
  StageActionType,
  SchedulingType,
  SmartSwitchesData,
};

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
 * Action execution state (client-side compatible)
 */
export type ActionExecutionState = 'idle' | 'running' | 'waiting' | 'paused' | 'stopped' | 'completed' | 'failed';

/**
 * Current action execution progress (client-side view)
 * Compatible with server-side ActionExecutionProgress
 */
export interface ActionExecutionProgress {
  /** Execution ID from server (if running on server) */
  executionId?: string;
  /** Current execution state */
  state: ActionExecutionState;
  /** Total number of stages */
  totalStages?: number;
  /** Currently executing stage index (-1 if not started) */
  currentStage: number;
  /** Whether waiting for scheduling (delay/curtains) */
  isWaiting: boolean;
  /** Type of wait if waiting */
  waitType?: 'delay' | 'curtains';
  /** Remaining delay time in ms (if waiting on delay) */
  remainingDelayMs?: number;
  /** Started at timestamp */
  startedAt?: number;
  /** Completed at timestamp */
  completedAt?: number;
  /** Error message if any */
  error?: string;
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
 * Validation result for switches and actions
 */
interface ValidationResult {
  unreachableSwitchIds: Set<string>;
  unreachableCount: number;
  invalidActionSteps: Map<string, number[]>;
  invalidActionCount: number;
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
  /** Whether this section is in fullscreen mode */
  isFullscreen?: boolean;
  /** Callback to toggle fullscreen mode */
  onFullscreenToggle?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function parseFavorites(favorites: unknown): FavoritesData {
  if (!favorites || typeof favorites !== 'object') {
    return { zones: {} };
  }
  const favObj = favorites as Record<string, unknown>;
  // Support both old 'groups' and new 'zones' property names
  const zonesData = favObj.zones || favObj.groups;
  if (zonesData && typeof zonesData === 'object') {
    // Migrate old format (relayIndex) to new format (index, type)
    const zones = zonesData as Record<string, unknown[]>;
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
  // Support both old 'groups' and new 'zones' property names
  const zonesData = ssObj.zones || ssObj.groups;
  if (zonesData && typeof zonesData === 'object') {
    // Migrate old format (steps-based) to new format (stages-based)
    const zones = zonesData as Record<string, unknown[]>;
    const migratedZones: Record<string, SmartAction[]> = {};
    
    for (const [zoneName, actionsArr] of Object.entries(zones)) {
      migratedZones[zoneName] = (actionsArr || []).map((actionItem: unknown) => {
        const actionObj = actionItem as Record<string, unknown>;
        
        // Check if already in new format (has stages array)
        if (Array.isArray(actionObj.stages)) {
          return {
            name: actionObj.name as string,
            stages: actionObj.stages as ActionStage[],
            scheduling: (actionObj.scheduling as ActionScheduling[]) || [],
          };
        }
        
        // Migrate from old format (steps) to new format (stages)
        const oldSteps = (actionObj.steps as ActionStep[]) || [];
        const stages: ActionStage[] = [];
        const scheduling: ActionScheduling[] = [];
        
        // Each old step becomes a single-action stage
        for (let i = 0; i < oldSteps.length; i++) {
          const step = oldSteps[i];
          stages.push({
            actions: [{
              switchId: step.switchId,
              action: step.action,
            }],
          });
          
          // Add delay scheduling between stages (except after last)
          if (i < oldSteps.length - 1 && step.delayMs > 0) {
            scheduling.push({
              type: 'delay',
              delayMs: step.delayMs,
            });
          } else if (i < oldSteps.length - 1) {
            scheduling.push({ type: 'delay', delayMs: 0 });
          }
        }
        
        return {
          name: actionObj.name as string,
          stages,
          scheduling,
        };
      });
    }
    
    return { zones: migratedZones };
  }
  return { zones: {} };
}

function validateSwitchesAndActions(
  favoritesData: FavoritesData,
  smartSwitchesData: SmartSwitchesData,
  discoveredPanelIps: Set<string>,
  livePanelStates: Map<string, LivePanelState>,
  discoveryCompleted: boolean,
): ValidationResult {
  const unreachableSwitchIds = new Set<string>();
  const invalidActionSteps = new Map<string, number[]>();
  
  if (!discoveryCompleted) {
    return { unreachableSwitchIds, unreachableCount: 0, invalidActionSteps, invalidActionCount: 0 };
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

  for (const [_zoneName, actionsArr] of Object.entries(smartSwitchesData.zones || {})) {
    for (const smartAction of actionsArr) {
      const invalidStageIndices: number[] = [];
      // Check each stage's actions for unreachable switches
      (smartAction.stages || []).forEach((stage: ActionStage, stageIdx: number) => {
        for (const stageAction of stage.actions) {
          const ip = stageAction.switchId.split(':')[0];
          if (!isPanelReachable(ip)) {
            invalidStageIndices.push(stageIdx);
            unreachableSwitchIds.add(stageAction.switchId);
          }
        }
      });
      if (invalidStageIndices.length > 0) {
        invalidActionSteps.set(smartAction.name, [...new Set(invalidStageIndices)]);
      }
    }
  }

  return {
    unreachableSwitchIds,
    unreachableCount: unreachableSwitchIds.size,
    invalidActionSteps,
    invalidActionCount: invalidActionSteps.size,
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
  isFullscreen = false,
  onFullscreenToggle,
}: FavoritesSectionProps) {
  // State
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  
  // Inline editing states
  const [showNewZoneInput, setShowNewZoneInput] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [switchPickerSearch, setSwitchPickerSearch] = useState('');
  const [showActionCreator, setShowActionCreator] = useState(false);
  const [newActionName, setNewActionName] = useState('');
  
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
    type: 'zone' | 'switch' | 'action';
    name: string;
    onConfirm: () => void;
  } | null>(null);
  
  // Drag and drop state for switches
  const [draggedSwitch, setDraggedSwitch] = useState<{ index: number; switch: FavoriteSwitch } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Drag and drop state for actions
  const [draggedAction, setDraggedAction] = useState<{ index: number; action: SmartAction } | null>(null);
  const [actionDropIndicator, setActionDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Drag and drop state for zones
  const [draggedZone, setDraggedZone] = useState<{ index: number; name: string } | null>(null);
  const [zoneDropIndicator, setZoneDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Action builder state
  const [editingAction, setEditingAction] = useState<{ zoneName: string; actionIndex: number } | null>(null);
  const [editingActionData, setEditingActionData] = useState<SmartAction | null>(null);
  const [isEditingActionName, setIsEditingActionName] = useState(false);
  const [editingActionNameValue, setEditingActionNameValue] = useState('');
  
  // Action context menu (right-click on action cards)
  const [actionContextMenu, setActionContextMenu] = useState<{
    x: number;
    y: number;
    zoneName: string;
    actionIndex: number;
    actionName: string;
  } | null>(null);
  const [actionRenameValue, setActionRenameValue] = useState('');
  const actionContextMenuRef = useRef<HTMLDivElement>(null);
  
  // Zone context menu state for renaming zones
  const [zoneContextMenu, setZoneContextMenu] = useState<{
    x: number;
    y: number;
    zoneName: string;
  } | null>(null);
  const [zoneRenameValue, setZoneRenameValue] = useState('');
  const zoneContextMenuRef = useRef<HTMLDivElement>(null);
  
  // Action execution state (now server-driven)
  const [executingAction, setExecutingAction] = useState<SmartAction | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ActionExecutionProgress>({
    state: 'idle',
    currentStage: -1,
    isWaiting: false,
  });
  // Current execution ID from server (for stopping)
  const currentExecutionIdRef = useRef<string | null>(null);
  // EventSource for SSE streaming
  const executionEventSourceRef = useRef<EventSource | null>(null);

  // Cleanup SSE connection on unmount
  useEffect(() => {
    return () => {
      if (executionEventSourceRef.current) {
        executionEventSourceRef.current.close();
        executionEventSourceRef.current = null;
      }
    };
  }, []);

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
  
  // Close action context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionContextMenuRef.current && !actionContextMenuRef.current.contains(e.target as Node)) {
        setActionContextMenu(null);
      }
    };
    if (actionContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [actionContextMenu]);
  
  // Close zone context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (zoneContextMenuRef.current && !zoneContextMenuRef.current.contains(e.target as Node)) {
        setZoneContextMenu(null);
      }
    };
    if (zoneContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [zoneContextMenu]);
  
  // ESC key handler for all modals/popups
  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close modals in order of priority (most recent/top-level first)
        if (deleteConfirm) {
          setDeleteConfirm(null);
        } else if (actionContextMenu) {
          setActionContextMenu(null);
        } else if (zoneContextMenu) {
          setZoneContextMenu(null);
        } else if (editingAction) {
          setEditingAction(null);
          setEditingActionData(null);
          setIsEditingActionName(false);
        } else if (contextMenu) {
          setContextMenu(null);
        } else if (showSwitchPicker) {
          setShowSwitchPicker(false);
          setSwitchPickerSearch('');
        } else if (showActionCreator) {
          setShowActionCreator(false);
          setNewActionName('');
        } else if (showNewZoneInput) {
          setShowNewZoneInput(false);
          setNewZoneName('');
        }
      }
    };
    
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [deleteConfirm, actionContextMenu, zoneContextMenu, editingAction, contextMenu, showSwitchPicker, showActionCreator, showNewZoneInput]);

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

  const totalActions = Object.values(smartSwitchesData.zones || {}).reduce(
    (sum, actions) => sum + actions.length, 0
  );

  // Set first zone as active when expanded and no zone is selected
  const effectiveActiveZone = activeZone ?? (allZones.length > 0 ? allZones[0] : null);

  // Get current zone data
  const currentZoneSwitches = effectiveActiveZone 
    ? (favoritesData.zones || {})[effectiveActiveZone] ?? []
    : [];

  const currentZoneActions = useMemo(() => effectiveActiveZone 
    ? (smartSwitchesData.zones || {})[effectiveActiveZone] ?? []
    : [], [effectiveActiveZone, smartSwitchesData.zones]);

  // Validation
  const validation = useMemo(() => {
    return validateSwitchesAndActions(
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

  const hasInvalidSteps = useCallback((smartAction: SmartAction): boolean => {
    return validation.invalidActionSteps.has(smartAction.name);
  }, [validation.invalidActionSteps]);

  const getInvalidStepIndices = useCallback((smartAction: SmartAction): number[] => {
    return validation.invalidActionSteps.get(smartAction.name) ?? [];
  }, [validation.invalidActionSteps]);

  // Only show validation warning AFTER discovery completes (not during loading)
  const showValidationWarning = !isLoading && validation.unreachableCount > 0 && !warningDismissed && discoveryCompleted;

  // Get available switches from discovered panels - ONLY direct switches (not hidden)
  const availableDevices = useMemo(() => {
    const switches: Array<{
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
      
      // Add relays (lights) - only direct switches, not hidden or linked
      for (const relay of relays) {
        const deviceType = getRelayDeviceType(relay.index, relay.name, relayPairs);
        // Only show 'light' type relays (direct switches with proper names)
        // Filter out any relay with "Link" suffix (linked relays) - uses same pattern as dashboard
        const isLinkedRelay = relay.name && /[-_\s]?link$/i.test(relay.name.trim().toLowerCase());
        if (deviceType === 'light' && relay.name && !isLinkedRelay) {
          switches.push({
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
      
      // Add curtains (shades/venetians) - only direct, not linked
      for (const curtain of curtains) {
        const deviceType = getCurtainDeviceType(curtain.index, curtain.name, relayPairs);
        // Filter out any curtain with "Link" suffix (linked switches)
        const isLinkedCurtain = curtain.name && /[-_\s]?link$/i.test(curtain.name.trim());
        if ((deviceType === 'curtain' || deviceType === 'venetian') && curtain.name && !isLinkedCurtain) {
          switches.push({
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
    return switches;
  }, [discoveredPanels, livePanelStates]);

  // Filter available switches based on search - smart multi-term search
  const filteredAvailableSwitches = useMemo(() => {
    if (!switchPickerSearch.trim()) return availableDevices;
    
    // Split search into terms and normalize
    const searchTerms = switchPickerSearch
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 0);
    
    if (searchTerms.length === 0) return availableDevices;
    
    return availableDevices.filter(sw => {
      // Combine panel name and switch name for searching
      const searchableText = `${sw.panelName} ${sw.name}`.toLowerCase();
      
      // All terms must match somewhere in the searchable text
      return searchTerms.every(term => searchableText.includes(term));
    });
  }, [availableDevices, switchPickerSearch]);

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

  // Sync original names when panel switches are renamed
  // This keeps the originalName in sync with the actual panel while preserving user aliases
  useEffect(() => {
    if (!profile || !discoveryCompleted || availableDevices.length === 0) return;
    
    // Build a map of current switch names from discovered panels: ip:type:index -> currentName
    const currentNameMap = new Map<string, string>();
    for (const device of availableDevices) {
      currentNameMap.set(`${device.ip}:${device.type}:${device.index}`, device.name);
    }
    
    // Check if any favorites need their originalName updated
    let needsUpdate = false;
    const newZones: Record<string, FavoriteSwitch[]> = {};
    
    for (const [zoneName, switches] of Object.entries(favoritesData.zones || {})) {
      const updatedSwitches: FavoriteSwitch[] = [];
      
      for (const sw of switches) {
        const switchKey = `${sw.ip}:${sw.type}:${sw.index}`;
        const currentName = currentNameMap.get(switchKey);
        
        if (currentName && currentName !== sw.originalName) {
          // The real switch name has changed
          needsUpdate = true;
          
          // If alias equals originalName (user hasn't customized), update both
          // If alias differs (user has customized), only update originalName
          const aliasWasDefault = sw.alias === sw.originalName;
          
          updatedSwitches.push({
            ...sw,
            originalName: currentName,
            alias: aliasWasDefault ? currentName : sw.alias,
          });
        } else {
          updatedSwitches.push(sw);
        }
      }
      
      newZones[zoneName] = updatedSwitches;
    }
    
    // Only trigger update if something changed
    if (needsUpdate) {
      console.log('[FavoritesSection] Syncing original names with panel data');
      onFavoritesUpdate?.(profile.id, { zones: newZones });
    }
  }, [profile, discoveryCompleted, availableDevices, favoritesData.zones, onFavoritesUpdate]);

  // =============================================================================
  // Handlers
  // =============================================================================

  const handleLightClick = useCallback(async (sw: FavoriteSwitch) => {
    if (sw.type !== 'light') return;
    console.log('[FavoritesSection] Toggle light:', sw.alias);
    await sendPanelCommand(sw.ip, 'toggle_relay', { index: sw.index });
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, index: number, sw: FavoriteSwitch) => {
    setDraggedSwitch({ index, switch: sw });
    e.dataTransfer.effectAllowed = 'move';
    // Add some visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedSwitch(null);
    setDropIndicator(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (!draggedSwitch) return;
    
    // Determine if dropping before or after based on mouse position
    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const position: 'before' | 'after' = e.clientX < midX ? 'before' : 'after';
    
    setDropIndicator({ index, position });
  }, [draggedSwitch]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the container entirely
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      // Don't clear immediately - let the next dragOver set it
    }
  }, []);

  const handleGridDragLeave = useCallback(() => {
    setDropIndicator(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedSwitch || !profile || !effectiveActiveZone || !dropIndicator) return;
    
    const { index: dragIndex } = draggedSwitch;
    let targetIndex = dropIndicator.index;
    
    // Adjust target index based on position
    if (dropIndicator.position === 'after') {
      targetIndex += 1;
    }
    
    // Adjust for the removal of the dragged item
    if (dragIndex < targetIndex) {
      targetIndex -= 1;
    }
    
    if (dragIndex === targetIndex) {
      setDraggedSwitch(null);
      setDropIndicator(null);
      return;
    }
    
    const currentSwitches = [...((favoritesData.zones || {})[effectiveActiveZone] || [])];
    const [removed] = currentSwitches.splice(dragIndex, 1);
    currentSwitches.splice(targetIndex, 0, removed);
    
    const newFavorites: FavoritesData = {
      zones: {
        ...(favoritesData.zones || {}),
        [effectiveActiveZone]: currentSwitches,
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
    setDraggedSwitch(null);
    setDropIndicator(null);
  }, [draggedSwitch, dropIndicator, profile, effectiveActiveZone, favoritesData.zones, onFavoritesUpdate]);

  // Action drag and drop handlers
  const handleActionDragStart = useCallback((e: React.DragEvent, index: number, smartAction: SmartAction) => {
    setDraggedAction({ index, action: smartAction });
    e.dataTransfer.effectAllowed = 'move';
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4';
    }
  }, []);

  const handleActionDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedAction(null);
    setActionDropIndicator(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  const handleActionDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (!draggedAction) return;
    
    // Determine if dropping before or after based on mouse position
    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const position: 'before' | 'after' = e.clientX < midX ? 'before' : 'after';
    
    setActionDropIndicator({ index, position });
  }, [draggedAction]);

  const handleActionDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setActionDropIndicator(null);
    }
  }, []);

  const handleActionDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedAction || !profile || !effectiveActiveZone || !actionDropIndicator) return;
    
    const { index: dragIndex } = draggedAction;
    let targetIndex = actionDropIndicator.index;
    
    // Adjust target index based on position
    if (actionDropIndicator.position === 'after') {
      targetIndex += 1;
    }
    
    // Adjust for the removal of the dragged item
    if (dragIndex < targetIndex) {
      targetIndex -= 1;
    }
    
    // Don't do anything if dropping at the same position
    if (dragIndex === targetIndex) {
      setDraggedAction(null);
      setActionDropIndicator(null);
      return;
    }
    
    // Reorder actions
    const currentActions = (smartSwitchesData.zones || {})[effectiveActiveZone] || [];
    const newActions = [...currentActions];
    const [movedAction] = newActions.splice(dragIndex, 1);
    newActions.splice(targetIndex, 0, movedAction);
    
    const newSmartSwitches = {
      ...smartSwitchesData,
      zones: {
        ...(smartSwitchesData.zones || {}),
        [effectiveActiveZone]: newActions,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    setDraggedAction(null);
    setActionDropIndicator(null);
  }, [draggedAction, actionDropIndicator, profile, effectiveActiveZone, smartSwitchesData, onSmartSwitchesUpdate]);

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

  // Zone context menu handler for renaming
  const handleZoneContextMenu = useCallback((e: React.MouseEvent, zoneName: string) => {
    e.preventDefault();
    setZoneContextMenu({
      x: e.clientX,
      y: e.clientY,
      zoneName,
    });
    setZoneRenameValue(zoneName);
  }, []);

  // Rename zone handler
  const handleRenameZone = useCallback(() => {
    if (!zoneContextMenu || !profile || !zoneRenameValue.trim()) return;
    
    const oldName = zoneContextMenu.zoneName;
    const newName = zoneRenameValue.trim();
    
    // Don't rename if the name didn't change
    if (oldName === newName) {
      setZoneContextMenu(null);
      return;
    }
    
    // Don't allow duplicate names
    if (allZones.includes(newName)) {
      return;
    }
    
    // Create new zones with renamed key for favorites
    const newFavoritesZones: Record<string, FavoriteSwitch[]> = {};
    for (const [key, value] of Object.entries(favoritesData.zones || {})) {
      if (key === oldName) {
        newFavoritesZones[newName] = value;
      } else {
        newFavoritesZones[key] = value;
      }
    }
    
    // Create new zones with renamed key for smart switches
    const newSmartSwitchesZones: Record<string, SmartAction[]> = {};
    for (const [key, value] of Object.entries(smartSwitchesData.zones || {})) {
      if (key === oldName) {
        newSmartSwitchesZones[newName] = value;
      } else {
        newSmartSwitchesZones[key] = value;
      }
    }
    
    onFavoritesUpdate?.(profile.id, { zones: newFavoritesZones });
    onSmartSwitchesUpdate?.(profile.id, { zones: newSmartSwitchesZones });
    
    // Update active zone if it was the one renamed
    if (activeZone === oldName) {
      setActiveZone(newName);
    }
    
    setZoneContextMenu(null);
  }, [zoneContextMenu, profile, zoneRenameValue, allZones, favoritesData.zones, smartSwitchesData.zones, activeZone, onFavoritesUpdate, onSmartSwitchesUpdate]);

  // Zone drag and drop handlers
  const handleZoneDragStart = useCallback((e: React.DragEvent, index: number, zoneName: string) => {
    setDraggedZone({ index, name: zoneName });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', zoneName);
    
    // Style the dragged element
    const target = e.currentTarget as HTMLElement;
    setTimeout(() => target.classList.add(styles.zoneTabDragging), 0);
  }, []);

  const handleZoneDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedZone(null);
    setZoneDropIndicator(null);
    (e.currentTarget as HTMLElement).classList.remove(styles.zoneTabDragging);
  }, []);

  const handleZoneDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (!draggedZone || draggedZone.index === index) return;
    
    // Determine drop position (before/after) based on mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const position: 'before' | 'after' = e.clientX < midX ? 'before' : 'after';
    
    setZoneDropIndicator({ index, position });
  }, [draggedZone]);

  const handleZoneDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setZoneDropIndicator(null);
    }
  }, []);

  const handleZoneDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    
    if (!draggedZone || !zoneDropIndicator || !profile) {
      setZoneDropIndicator(null);
      setDraggedZone(null);
      return;
    }
    
    const dragIndex = draggedZone.index;
    let dropIndex = targetIndex;
    
    // Adjust drop index based on position
    if (zoneDropIndicator.position === 'after') {
      dropIndex += 1;
    }
    
    // Adjust for removal of dragged item
    if (dragIndex < dropIndex) {
      dropIndex -= 1;
    }
    
    // No change needed
    if (dragIndex === dropIndex) {
      setZoneDropIndicator(null);
      setDraggedZone(null);
      return;
    }
    
    // Reorder zones - create new ordered arrays
    const newZoneOrder = [...allZones];
    const [removed] = newZoneOrder.splice(dragIndex, 1);
    newZoneOrder.splice(dropIndex, 0, removed);
    
    // Rebuild favorites zones with new order
    const newFavoritesZones: Record<string, FavoriteSwitch[]> = {};
    for (const zoneName of newZoneOrder) {
      newFavoritesZones[zoneName] = (favoritesData.zones || {})[zoneName] || [];
    }
    
    // Rebuild smart switches zones with new order
    const newSmartSwitchesZones: Record<string, SmartAction[]> = {};
    for (const zoneName of newZoneOrder) {
      newSmartSwitchesZones[zoneName] = (smartSwitchesData.zones || {})[zoneName] || [];
    }
    
    onFavoritesUpdate?.(profile.id, { zones: newFavoritesZones });
    onSmartSwitchesUpdate?.(profile.id, { zones: newSmartSwitchesZones });
    
    setZoneDropIndicator(null);
    setDraggedZone(null);
  }, [draggedZone, zoneDropIndicator, profile, allZones, favoritesData.zones, smartSwitchesData.zones, onFavoritesUpdate, onSmartSwitchesUpdate]);

  const handleAddSwitch = useCallback((sw: typeof availableDevices[0]) => {
    if (!profile || !effectiveActiveZone) return;
    
    const newSwitch: FavoriteSwitch = {
      ip: sw.ip,
      index: sw.index,
      type: sw.type,
      originalName: sw.name,
      alias: sw.name,
    };
    
    const currentSwitches = (favoritesData.zones || {})[effectiveActiveZone] || [];
    
    // Check if already exists
    if (currentSwitches.some(s => s.ip === sw.ip && s.index === sw.index && s.type === sw.type)) {
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

  const handleCreateAction = useCallback(() => {
    if (!newActionName.trim() || !profile || !effectiveActiveZone) return;
    
    const newSmartAction: SmartAction = {
      name: newActionName.trim(),
      stages: [{ actions: [] }], // Start with one empty stage
      scheduling: [],
    };
    
    const currentActions = (smartSwitchesData.zones || {})[effectiveActiveZone] || [];
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: {
        ...(smartSwitchesData.zones || {}),
        [effectiveActiveZone]: [...currentActions, newSmartAction],
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    
    // Auto-open the action editor for the newly created action
    const newSmartActionIndex = currentActions.length;
    setEditingAction({ zoneName: effectiveActiveZone, actionIndex: newSmartActionIndex });
    setEditingActionData(JSON.parse(JSON.stringify(newSmartAction)));
    
    setNewActionName('');
    setShowActionCreator(false);
  }, [newActionName, profile, effectiveActiveZone, smartSwitchesData.zones, onSmartSwitchesUpdate]);

  const handleDeleteAction = useCallback((actionIndex: number) => {
    if (!profile || !effectiveActiveZone) return;
    
    const currentActions = (smartSwitchesData.zones || {})[effectiveActiveZone] || [];
    const newActions = currentActions.filter((_, i) => i !== actionIndex);
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: {
        ...(smartSwitchesData.zones || {}),
        [effectiveActiveZone]: newActions,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
  }, [profile, effectiveActiveZone, smartSwitchesData.zones, onSmartSwitchesUpdate]);
  
  // Open action editor
  const handleEditAction = useCallback((actionIndex: number) => {
    if (!effectiveActiveZone) return;
    
    const actionToEdit = currentZoneActions[actionIndex];
    if (!actionToEdit) return;
    
    setEditingAction({ zoneName: effectiveActiveZone, actionIndex });
    // Deep copy the action data
    setEditingActionData(JSON.parse(JSON.stringify(actionToEdit)));
  }, [effectiveActiveZone, currentZoneActions]);
  
  // Close action editor without saving
  const handleCancelEditAction = useCallback(() => {
    setEditingAction(null);
    setEditingActionData(null);
    setIsEditingActionName(false);
  }, []);
  
  // Start editing action name
  const handleStartRenameAction = useCallback(() => {
    if (editingActionData) {
      setEditingActionNameValue(editingActionData.name);
      setIsEditingActionName(true);
    }
  }, [editingActionData]);
  
  // Save action name
  const handleSaveActionName = useCallback(() => {
    if (!editingActionData || !editingActionNameValue.trim()) return;
    
    setEditingActionData({
      ...editingActionData,
      name: editingActionNameValue.trim(),
    });
    setIsEditingActionName(false);
  }, [editingActionData, editingActionNameValue]);
  
  // Cancel action name editing
  const handleCancelRenameAction = useCallback(() => {
    setIsEditingActionName(false);
    setEditingActionNameValue('');
  }, []);
  
  // Action context menu handler (right-click on action card) - directly starts renaming
  const handleActionContextMenu = useCallback((e: React.MouseEvent, zoneName: string, actionIndex: number, actionName: string) => {
    e.preventDefault();
    setActionContextMenu({
      x: e.clientX,
      y: e.clientY,
      zoneName,
      actionIndex,
      actionName,
    });
    setActionRenameValue(actionName);
  }, []);
  
  // Rename action directly from context menu (save)
  const handleSaveActionRenameFromContext = useCallback(() => {
    if (!actionContextMenu || !profile || !actionRenameValue.trim()) return;
    
    const { zoneName, actionIndex } = actionContextMenu;
    const newName = actionRenameValue.trim();
    
    // Check if name changed
    if (newName === actionContextMenu.actionName) {
      setActionContextMenu(null);
      return;
    }
    
    const currentActions = (smartSwitchesData.zones || {})[zoneName] || [];
    const updatedActions = [...currentActions];
    
    if (updatedActions[actionIndex]) {
      updatedActions[actionIndex] = {
        ...updatedActions[actionIndex],
        name: newName,
      };
      
      onSmartSwitchesUpdate?.(profile.id, {
        ...smartSwitchesData,
        zones: {
          ...(smartSwitchesData.zones || {}),
          [zoneName]: updatedActions,
        },
      });
    }
    
    setActionContextMenu(null);
    setActionRenameValue('');
  }, [actionContextMenu, profile, actionRenameValue, smartSwitchesData, onSmartSwitchesUpdate]);
  
  // Delete action from context menu
  const handleDeleteActionFromContext = useCallback(() => {
    if (!actionContextMenu) return;
    
    const { zoneName, actionIndex, actionName } = actionContextMenu;
    
    setDeleteConfirm({
      type: 'action',
      name: actionName,
      onConfirm: () => {
        if (!profile) return;
        const currentActions = (smartSwitchesData.zones || {})[zoneName] || [];
        const newActions = currentActions.filter((_, i) => i !== actionIndex);
        
        const newSmartSwitches: SmartSwitchesData = {
          zones: {
            ...(smartSwitchesData.zones || {}),
            [zoneName]: newActions,
          }
        };
        
        onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
      },
    });
    
    setActionContextMenu(null);
  }, [actionContextMenu, profile, smartSwitchesData.zones, onSmartSwitchesUpdate]);
  
  // Save edited action
  const handleSaveEditAction = useCallback(() => {
    if (!profile || !editingAction || !editingActionData) return;
    
    const currentActions = (smartSwitchesData.zones || {})[editingAction.zoneName] || [];
    const newActions = [...currentActions];
    newActions[editingAction.actionIndex] = editingActionData;
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: {
        ...(smartSwitchesData.zones || {}),
        [editingAction.zoneName]: newActions,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    setEditingAction(null);
    setEditingActionData(null);
  }, [profile, editingAction, editingActionData, smartSwitchesData.zones, onSmartSwitchesUpdate]);
  
  // Add a new stage to the action
  const handleAddStage = useCallback(() => {
    if (!editingActionData) return;
    
    const newStages = [...editingActionData.stages, { actions: [] }];
    const newScheduling = [...editingActionData.scheduling];
    
    // Add scheduling between previous stage and new stage (if not first)
    if (newStages.length > 1) {
      newScheduling.push({ type: 'delay', delayMs: 1000 });
    }
    
    setEditingActionData({
      ...editingActionData,
      stages: newStages,
      scheduling: newScheduling,
    });
  }, [editingActionData]);
  
  // Remove a stage
  const handleRemoveStage = useCallback((stageIndex: number) => {
    if (!editingActionData) return;
    
    const newStages = editingActionData.stages.filter((_, i) => i !== stageIndex);
    const newScheduling = [...editingActionData.scheduling];
    
    // Remove scheduling at the correct index
    if (stageIndex > 0 && newScheduling.length >= stageIndex) {
      newScheduling.splice(stageIndex - 1, 1);
    } else if (stageIndex === 0 && newScheduling.length > 0) {
      newScheduling.splice(0, 1);
    }
    
    setEditingActionData({
      ...editingActionData,
      stages: newStages,
      scheduling: newScheduling,
    });
  }, [editingActionData]);
  
  // Add a switch to a stage
  const handleAddActionToStage = useCallback((stageIndex: number, sw: typeof availableDevices[0]) => {
    if (!editingActionData) return;
    
    const newStages = [...editingActionData.stages];
    const defaultAction: StageActionType = sw.type === 'light' ? 'toggle' : 'open';
    
    // Check if switch already exists in stage
    const existsInStage = newStages[stageIndex].actions.some(a => a.switchId === sw.id);
    if (existsInStage) return;
    
    newStages[stageIndex] = {
      actions: [
        ...newStages[stageIndex].actions,
        { switchId: sw.id, action: defaultAction },
      ],
    };
    
    setEditingActionData({
      ...editingActionData,
      stages: newStages,
    });
  }, [editingActionData]);
  
  // Remove an action from a stage
  const handleRemoveActionFromStage = useCallback((stageIndex: number, actionIndex: number) => {
    if (!editingActionData) return;
    
    const newStages = [...editingActionData.stages];
    newStages[stageIndex] = {
      actions: newStages[stageIndex].actions.filter((_, i) => i !== actionIndex),
    };
    
    setEditingActionData({
      ...editingActionData,
      stages: newStages,
    });
  }, [editingActionData]);
  
  // Update action type
  const handleUpdateActionType = useCallback((stageIndex: number, actionIndex: number, newAction: StageActionType) => {
    if (!editingActionData) return;
    
    const newStages = [...editingActionData.stages];
    const actions = [...newStages[stageIndex].actions];
    actions[actionIndex] = { ...actions[actionIndex], action: newAction };
    newStages[stageIndex] = { actions };
    
    setEditingActionData({
      ...editingActionData,
      stages: newStages,
    });
  }, [editingActionData]);
  
  // Update scheduling between stages
  const handleUpdateScheduling = useCallback((schedIndex: number, updates: Partial<ActionScheduling>) => {
    if (!editingActionData) return;
    
    const newScheduling = [...editingActionData.scheduling];
    newScheduling[schedIndex] = { ...newScheduling[schedIndex], ...updates };
    
    setEditingActionData({
      ...editingActionData,
      scheduling: newScheduling,
    });
  }, [editingActionData]);
  
  // Get switch name from switchId
  const getSwitchNameFromId = useCallback((switchId: string): string => {
    const sw = availableDevices.find(d => d.id === switchId);
    return sw?.name || switchId.split(':').pop() || 'Unknown';
  }, [availableDevices]);
  
  // Get switch type icon
  const getSwitchTypeIcon = useCallback((switchId: string): string => {
    const [, type] = switchId.split(':');
    if (type === 'light') return '💡';
    if (type === 'venetian') return '🪟';
    return '🪞';
  }, []);

  // Run an action (now server-driven - action continues even if browser closes)
  const handleRunAction = useCallback(async (smartAction: SmartAction) => {
    if (executingAction) {
      console.log('[FavoritesSection] Action already running');
      return;
    }
    
    console.log('[FavoritesSection] Starting server-side action:', smartAction.name);
    setExecutingAction(smartAction);
    
    // Set initial progress
    setExecutionProgress({
      state: 'running',
      currentStage: 0,
      totalStages: smartAction.stages.length,
      isWaiting: false,
      startedAt: Date.now(),
    });
    
    try {
      // Call server API to start the action
      const response = await fetch('/api/actions/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: profile?.id ?? 0,
          action: smartAction,
        }),
      });
      
      const result = await response.json() as StartActionResponse;
      
      if (!result.success || !result.executionId) {
        console.error('[FavoritesSection] Failed to start action:', result.error);
        setExecutionProgress(prev => ({
          ...prev,
          state: 'failed',
          error: result.error || 'Failed to start action',
        }));
        setTimeout(() => {
          setExecutingAction(null);
          setExecutionProgress({ state: 'idle', currentStage: -1, isWaiting: false });
        }, 3000);
        return;
      }
      
      const executionId = result.executionId;
      console.log('[FavoritesSection] Action started with ID:', executionId);
      currentExecutionIdRef.current = executionId;
      
      // Subscribe to SSE stream for progress updates
      const eventSource = new EventSource(`/api/actions/${executionId}/stream`);
      executionEventSourceRef.current = eventSource;
      
      eventSource.addEventListener('progress', (event) => {
        try {
          const progress = JSON.parse(event.data) as ServerActionExecutionProgress;
          setExecutionProgress({
            executionId: progress.executionId,
            state: progress.state,
            totalStages: progress.totalStages,
            currentStage: progress.currentStage,
            isWaiting: progress.isWaiting,
            waitType: progress.waitType,
            remainingDelayMs: progress.remainingDelayMs,
            startedAt: progress.startedAt,
            completedAt: progress.completedAt,
            error: progress.error,
          });
        } catch (e) {
          console.error('[FavoritesSection] Error parsing progress:', e);
        }
      });
      
      eventSource.addEventListener('complete', (event) => {
        try {
          const progress = JSON.parse(event.data) as ServerActionExecutionProgress;
          console.log('[FavoritesSection] Action completed/stopped:', progress.state);
          setExecutionProgress({
            executionId: progress.executionId,
            state: progress.state,
            totalStages: progress.totalStages,
            currentStage: progress.currentStage,
            isWaiting: false,
            completedAt: progress.completedAt,
            error: progress.error,
          });
          
          // Cleanup
          eventSource.close();
          executionEventSourceRef.current = null;
          currentExecutionIdRef.current = null;
          
          // Clear UI after showing completion state
          setTimeout(() => {
            setExecutingAction(null);
            setExecutionProgress({ state: 'idle', currentStage: -1, isWaiting: false });
          }, 2000);
        } catch (e) {
          console.error('[FavoritesSection] Error parsing complete:', e);
        }
      });
      
      eventSource.onerror = () => {
        // Connection lost - but action continues on server!
        console.log('[FavoritesSection] SSE connection lost (action continues on server)');
        eventSource.close();
        executionEventSourceRef.current = null;
        // Don't clear executing state - action might still be running
        // User can check status via GET /api/actions/:id if needed
      };
      
    } catch (error) {
      console.error('[FavoritesSection] Error starting action:', error);
      setExecutionProgress(prev => ({
        ...prev,
        state: 'failed',
        error: (error as Error).message,
      }));
      setTimeout(() => {
        setExecutingAction(null);
        setExecutionProgress({ state: 'idle', currentStage: -1, isWaiting: false });
      }, 3000);
    }
  }, [executingAction, profile?.id]);
  
  // Stop the running action - server handles stopping curtains
  const handleStopAction = useCallback(async () => {
    const executionId = currentExecutionIdRef.current;
    if (!executionId) {
      console.log('[FavoritesSection] No action to stop');
      return;
    }
    
    console.log('[FavoritesSection] Stopping action:', executionId);
    
    try {
      // Close SSE connection
      if (executionEventSourceRef.current) {
        executionEventSourceRef.current.close();
        executionEventSourceRef.current = null;
      }
      
      // Call server API to stop the action
      const response = await fetch(`/api/actions/${executionId}?stopCurtains=true`, {
        method: 'DELETE',
      });
      
      const result = await response.json() as StopActionResponse;
      
      if (result.success) {
        console.log('[FavoritesSection] Action stopped successfully');
        setExecutionProgress(prev => ({
          ...prev,
          state: 'stopped',
        }));
      } else {
        console.error('[FavoritesSection] Failed to stop action:', result.error);
      }
      
    } catch (error) {
      console.error('[FavoritesSection] Error stopping action:', error);
    }
    
    // Clear state
    currentExecutionIdRef.current = null;
    
    setTimeout(() => {
      setExecutingAction(null);
      setExecutionProgress({ state: 'idle', currentStage: -1, isWaiting: false });
    }, 1000);
  }, []);

  // =============================================================================
  // Render
  // =============================================================================

  // Auto-expand when in fullscreen mode
  const effectivelyExpanded = isFullscreen || isExpanded;

  return (
    <div className={`${styles.collapsibleSection} ${effectivelyExpanded ? styles.collapsibleSectionExpanded : ''} ${isFullscreen ? styles.collapsibleSectionFullscreen : ''}`}>
      {/* Header */}
      <div
        className={styles.collapsibleSectionHeader}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer' }}
      >
        <div className={styles.collapsibleSectionHeaderLeft}>
          <span className={styles.collapsibleSectionToggle}>
            {effectivelyExpanded ? '▼' : '▶'}
          </span>
          <h3 className={styles.collapsibleSectionTitle}>
            ⭐ Favorites &amp; Smart Actions
            {profile && allZones.length > 0 && (
              <span className={styles.favoritesBadge}>
                {allZones.length} zone{allZones.length !== 1 ? 's' : ''} · {totalSwitches} switch{totalSwitches !== 1 ? 'es' : ''}
                {totalActions > 0 && ` · ${totalActions} action${totalActions !== 1 ? 's' : ''}`}
              </span>
            )}
          </h3>
        </div>
        <div className={styles.collapsibleSectionActions} onClick={(e) => e.stopPropagation()}>
          {onFullscreenToggle && (
            <button
              type="button"
              className={`${styles.fullscreenToggleButton} ${isFullscreen ? styles.fullscreenToggleButtonActive : ''}`}
              onClick={onFullscreenToggle}
              title={isFullscreen ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
            >
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Collapsed summary - clickable buttons grouped by zone */}
      {!effectivelyExpanded && profile && allZones.length > 0 && (
        <div className={styles.favoritesCollapsedView}>
          {allZones.map((zoneName) => {
            const zoneSwitches = (favoritesData.zones || {})[zoneName] || [];
            const zoneActions = (smartSwitchesData.zones || {})[zoneName] || [];
            if (zoneSwitches.length === 0 && zoneActions.length === 0) return null;
            
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
                      // Shade/Venetian - use teal color for venetians, blue for shades
                      const isVenetian = sw.type === 'venetian';
                      return (
                        <div
                          key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                          className={`${styles.favoritesCollapsedShade} ${isVenetian ? styles.favoritesCollapsedShadeVenetian : ''} ${showInvalidState ? styles.favoritesCollapsedButtonInvalid : ''}`}
                        >
                          <span className={styles.favoritesCollapsedIcon}>
                            {showInvalidState ? '⚠️' : isVenetian ? '🪟' : '🪞'}
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
                  {zoneActions.map((smartAction, idx) => {
                    const actionHasInvalidSteps = hasInvalidSteps(smartAction);
                    // Only show invalid state AFTER discovery completes (not during loading)
                    const showInvalidState = !isLoading && discoveryCompleted && actionHasInvalidSteps;
                    // Check if this specific action is running
                    const isThisActionRunning = executingAction?.name === smartAction.name && 
                      executionProgress.state === 'running';
                    
                    return (
                      <button
                        key={`action-${smartAction.name}-${idx}`}
                        type="button"
                        className={`${styles.favoritesCollapsedButton} ${styles.favoritesCollapsedButtonAction} ${showInvalidState ? styles.favoritesCollapsedButtonInvalid : ''} ${isThisActionRunning ? styles.favoritesCollapsedButtonRunning : ''}`}
                        onClick={() => {
                          if (isThisActionRunning) {
                            handleStopAction();
                          } else if (!showInvalidState && !executingAction) {
                            handleRunAction(smartAction);
                          }
                        }}
                        disabled={isLoading || showInvalidState || (!!executingAction && !isThisActionRunning)}
                        title={isThisActionRunning ? 'Stop action' : smartAction.name}
                      >
                        <span className={styles.favoritesCollapsedIcon}>
                          {showInvalidState ? '⚠️' : isThisActionRunning ? '⏹️' : '▶'}
                        </span>
                        <span className={styles.favoritesCollapsedLabel}>{smartAction.name}</span>
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
              {validation.invalidActionCount > 0 && (
                <> · {validation.invalidActionCount} action{validation.invalidActionCount !== 1 ? 's' : ''} affected</>
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
                {allZones.map((zoneName, idx) => {
                  const isDragging = draggedZone?.name === zoneName;
                  const showDropBefore = zoneDropIndicator?.index === idx && zoneDropIndicator?.position === 'before' && draggedZone?.index !== idx;
                  const showDropAfter = zoneDropIndicator?.index === idx && zoneDropIndicator?.position === 'after' && draggedZone?.index !== idx;
                  
                  return (
                    <button
                      key={zoneName}
                      type="button"
                      className={`${styles.favoritesZoneTab} ${effectiveActiveZone === zoneName ? styles.favoritesZoneTabActive : ''} ${isDragging ? styles.zoneTabDragging : ''} ${showDropBefore ? styles.zoneTabDropBefore : ''} ${showDropAfter ? styles.zoneTabDropAfter : ''}`}
                      onClick={() => setActiveZone(zoneName)}
                      draggable
                      onDragStart={(e) => handleZoneDragStart(e, idx, zoneName)}
                      onDragEnd={handleZoneDragEnd}
                      onDragOver={(e) => handleZoneDragOver(e, idx)}
                      onDragLeave={handleZoneDragLeave}
                      onDrop={(e) => handleZoneDrop(e, idx)}
                      onContextMenu={(e) => handleZoneContextMenu(e, zoneName)}
                    >
                      <span className={styles.zoneTabDragHandle} title="Drag to reorder">⋮⋮</span>
                      {zoneName}
                      <>
                          <span
                            className={styles.favoritesZoneTabEdit}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Position context menu below the button
                              const rect = e.currentTarget.getBoundingClientRect();
                              setZoneContextMenu({
                                x: rect.left,
                                y: rect.bottom + 4,
                                zoneName,
                              });
                              setZoneRenameValue(zoneName);
                            }}
                            title="Rename zone"
                          >
                            ✏️
                          </span>
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
                      </>
                    </button>
                  );
                })}
                
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
                  // Only show "Add Zone" button when zones already exist
                  allZones.length > 0 && (
                    <button
                      type="button"
                      className={`${styles.favoritesZoneTab} ${styles.favoritesZoneTabAdd}`}
                      onClick={() => setShowNewZoneInput(true)}
                    >
                      + Add Zone
                    </button>
                  )
                )}
              </div>
            </div>

            {/* No zones empty state - shown when no zones exist */}
            {allZones.length === 0 && !showNewZoneInput && (
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

                  <div className={styles.favoritesSwitchGrid} onDragLeave={handleGridDragLeave}>
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
                        const showDropBefore = dropIndicator?.index === idx && dropIndicator?.position === 'before' && draggedSwitch?.index !== idx;
                        const showDropAfter = dropIndicator?.index === idx && dropIndicator?.position === 'after' && draggedSwitch?.index !== idx;
                        
                        return (
                          <div
                            key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                            className={`${styles.favoriteSwitchCard} ${!isReachable ? styles.favoriteSwitchCardDisabled : ''} ${showInvalidState ? styles.favoriteSwitchCardInvalid : ''} ${showDropBefore ? styles.favoriteSwitchCardDropBefore : ''} ${showDropAfter ? styles.favoriteSwitchCardDropAfter : ''}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, idx, sw)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, idx)}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
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
                        const showDropBefore = dropIndicator?.index === idx && dropIndicator?.position === 'before' && draggedSwitch?.index !== idx;
                        const showDropAfter = dropIndicator?.index === idx && dropIndicator?.position === 'after' && draggedSwitch?.index !== idx;
                        
                        return (
                          <div
                            key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                            className={`${styles.favoriteShadeCard} ${!isReachable ? styles.favoriteShadeCardDisabled : ''} ${showInvalidState ? styles.favoriteShadeCardInvalid : ''} ${showDropBefore ? styles.favoriteShadeCardDropBefore : ''} ${showDropAfter ? styles.favoriteShadeCardDropAfter : ''}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, idx, sw)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, idx)}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
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
                            <button onClick={() => { setShowSwitchPicker(false); setSwitchPickerSearch(''); }}>✕</button>
                          </div>
                          <div className={styles.switchPickerSearchWrapper}>
                            <input
                              type="text"
                              value={switchPickerSearch}
                              onChange={(e) => setSwitchPickerSearch(e.target.value)}
                              placeholder="Search... (e.g. Entr Spot)"
                              className={styles.switchPickerSearchInput}
                              autoFocus
                            />
                            {switchPickerSearch && (
                              <button
                                type="button"
                                className={styles.switchPickerSearchClear}
                                onClick={() => setSwitchPickerSearch('')}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          <div className={styles.switchPickerList}>
                            {availableDevices.length === 0 ? (
                              <div className={styles.switchPickerEmpty}>
                                Run discovery to find panels
                              </div>
                            ) : filteredAvailableSwitches.length === 0 ? (
                              <div className={styles.switchPickerEmpty}>
                                No matches for &quot;{switchPickerSearch}&quot;
                              </div>
                            ) : (
                              filteredAvailableSwitches.map(sw => {
                                const alreadyAdded = currentZoneSwitches.some(
                                  s => s.ip === sw.ip && s.index === sw.index && s.type === sw.type
                                );
                                return (
                                  <button
                                    key={sw.id}
                                    type="button"
                                    className={`${styles.switchPickerItem} ${alreadyAdded ? styles.switchPickerItemAdded : ''}`}
                                    onClick={() => !alreadyAdded && handleAddSwitch(sw)}
                                    disabled={alreadyAdded}
                                  >
                                    <span className={styles.switchPickerItemIcon}>
                                      {sw.type === 'light' ? '💡' : sw.type === 'venetian' ? '🪟' : '🪞'}
                                    </span>
                                    <span className={styles.switchPickerItemName}>{sw.name}</span>
                                    <span className={styles.switchPickerItemPanel}>{sw.panelName}</span>
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
                <div className={`${styles.favSubSection} ${styles.favSubSectionActions}`}>
                  <div className={styles.favSubSectionHeader}>
                    <h4 className={styles.favSubSectionTitle}>
                      <span className={styles.favSubSectionIcon}>⚡</span>
                      Smart Actions
                      {currentZoneActions.length > 0 && (
                        <span className={`${styles.favSubSectionCount} ${styles.favSubSectionCountPurple}`}>
                          {currentZoneActions.length}
                        </span>
                      )}
                    </h4>
                  </div>

                  <div className={styles.smartActionsGrid}>
                    {currentZoneActions.map((smartAction, idx) => {
                      const actionHasInvalidSteps = hasInvalidSteps(smartAction);
                      const invalidStepIndices = getInvalidStepIndices(smartAction);
                      // Only show invalid state AFTER discovery completes (not during loading)
                      const showInvalidState = !isLoading && discoveryCompleted && actionHasInvalidSteps;
                      
                      // Check if this action is currently executing
                      const isThisActionExecuting = executingAction?.name === smartAction.name && 
                        executionProgress.state === 'running';
                      const isThisActionCompleted = executingAction?.name === smartAction.name && 
                        executionProgress.state === 'completed';
                      const isThisActionStopped = executingAction?.name === smartAction.name && 
                        executionProgress.state === 'stopped';
                      
                      // Calculate total duration
                      const totalDurationMs = smartAction.scheduling?.reduce((acc, s) => 
                        acc + (s.type === 'delay' ? (s.delayMs || 0) : 2000), 0) || 0;
                      
                      // Drag and drop indicators
                      const showActionDropBefore = actionDropIndicator?.index === idx && actionDropIndicator?.position === 'before' && draggedAction?.index !== idx;
                      const showActionDropAfter = actionDropIndicator?.index === idx && actionDropIndicator?.position === 'after' && draggedAction?.index !== idx;
                      
                      return (
                        <div
                          key={`action-${smartAction.name}-${idx}`}
                          className={`${styles.smartActionCard} ${showInvalidState ? styles.smartActionCardInvalid : ''} ${isThisActionExecuting ? styles.smartActionCardExecuting : ''} ${isThisActionCompleted ? styles.smartActionCardCompleted : ''} ${isThisActionStopped ? styles.smartActionCardStopped : ''} ${showActionDropBefore ? styles.smartActionCardDropBefore : ''} ${showActionDropAfter ? styles.smartActionCardDropAfter : ''}`}
                          draggable={!isThisActionExecuting}
                          onDragStart={(e) => handleActionDragStart(e, idx, smartAction)}
                          onDragEnd={handleActionDragEnd}
                          onDragOver={(e) => handleActionDragOver(e, idx)}
                          onDragLeave={handleActionDragLeave}
                          onDrop={handleActionDrop}
                          onContextMenu={(e) => !isThisActionExecuting && handleActionContextMenu(e, effectiveActiveZone!, idx, smartAction.name)}
                        >
                          <div className={styles.smartActionCardHeader}>
                            <span className={styles.smartActionIcon}>
                              {isThisActionExecuting ? '⏳' : isThisActionCompleted ? '✅' : isThisActionStopped ? '⏹️' : showInvalidState ? '⚠️' : '⚡'}
                            </span>
                            <span className={styles.smartActionName}>{smartAction.name}</span>
                            {!isThisActionExecuting && (
                              <>
                                <button
                                  type="button"
                                  className={styles.smartActionEdit}
                                  onClick={() => handleEditAction(idx)}
                                  title="Edit action"
                                >
                                  ✏️
                                </button>
                                {/* Desktop: delete button. Mobile: more menu button */}
                                <button
                                  type="button"
                                  className={styles.smartActionDelete}
                                  onClick={() => setDeleteConfirm({
                                    type: 'action',
                                    name: smartAction.name,
                                    onConfirm: () => handleDeleteAction(idx),
                                  })}
                                  title="Delete action"
                                >
                                  <span className={styles.desktopOnly}>✕</span>
                                </button>
                                <button
                                  type="button"
                                  className={styles.smartActionMore}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Position context menu near the button on mobile
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setActionContextMenu({
                                      x: rect.left,
                                      y: rect.bottom + 4,
                                      zoneName: effectiveActiveZone!,
                                      actionIndex: idx,
                                      actionName: smartAction.name,
                                    });
                                    setActionRenameValue(smartAction.name);
                                  }}
                                  title="More options"
                                >
                                  ⋮
                                </button>
                              </>
                            )}
                          </div>
                          
                          {/* Execution Progress */}
                          {isThisActionExecuting && (
                            <div className={styles.smartActionProgress}>
                              <div className={styles.smartActionProgressBar}>
                                <div 
                                  className={styles.smartActionProgressFill}
                                  style={{ 
                                    width: `${((executionProgress.currentStage + 1) / smartAction.stages.length) * 100}%` 
                                  }}
                                />
                              </div>
                              <div className={styles.smartActionProgressText}>
                                Stage {executionProgress.currentStage + 1}/{smartAction.stages.length}
                                {executionProgress.isWaiting && executionProgress.remainingDelayMs !== undefined && (
                                  <span className={styles.smartActionWaiting}>
                                    ⏱️ {(executionProgress.remainingDelayMs / 1000).toFixed(1)}s
                                  </span>
                                )}
                                {executionProgress.isWaiting && executionProgress.remainingDelayMs === undefined && (
                                  <span className={styles.smartActionWaiting}>
                                    🔄 Waiting until done...
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {/* Normal meta info */}
                          {!isThisActionExecuting && (
                            <div className={styles.smartActionMeta}>
                              {smartAction.stages?.length || 0} stage{(smartAction.stages?.length || 0) !== 1 ? 's' : ''}
                              {showInvalidState && (
                                <span className={styles.smartActionInvalidCount}>
                                  {invalidStepIndices.length} unreachable
                                </span>
                              )}
                              {(smartAction.stages?.length || 0) > 0 && !showInvalidState && totalDurationMs > 0 && (
                                <span className={styles.smartActionDuration}>
                                  &gt; {Math.ceil(totalDurationMs / 1000)}s
                                </span>
                              )}
                            </div>
                          )}
                          
                          {/* Action buttons */}
                          {isThisActionExecuting ? (
                            <button
                              type="button"
                              className={styles.smartActionStopButton}
                              onClick={handleStopAction}
                            >
                              ⏹️ Stop
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`${styles.smartActionRunButton} ${showInvalidState ? styles.smartActionRunButtonDisabled : ''}`}
                              onClick={() => handleRunAction(smartAction)}
                              disabled={isLoading || showInvalidState || !!executingAction}
                            >
                              {isThisActionCompleted ? '✅ Done!' : isThisActionStopped ? '⏹️ Stopped' : showInvalidState ? '⚠️ Cannot Run' : '▶ Run'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    
                    {/* Create Action */}
                    {showActionCreator ? (
                      <div className={styles.actionCreatorCard}>
                        <div className={styles.actionCreatorHeader}>
                          <span className={styles.actionCreatorIcon}>⚡</span>
                          <span className={styles.actionCreatorTitle}>New Action</span>
                          <button
                            type="button"
                            className={styles.actionCreatorClose}
                            onClick={() => {
                              setShowActionCreator(false);
                              setNewActionName('');
                            }}
                            title="Cancel (Esc)"
                          >
                            ✕
                          </button>
                        </div>
                        <input
                          type="text"
                          value={newActionName}
                          onChange={(e) => setNewActionName(e.target.value)}
                          placeholder="Enter action name..."
                          className={styles.actionCreatorInput}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newActionName.trim()) handleCreateAction();
                            if (e.key === 'Escape') {
                              setShowActionCreator(false);
                              setNewActionName('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          className={styles.actionCreatorSubmit}
                          onClick={handleCreateAction}
                          disabled={!newActionName.trim()}
                        >
                          ✨ Create &amp; Edit
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.favAddItemCard} ${styles.favAddItemCardPurple}`}
                        onClick={() => setShowActionCreator(true)}
                        title="Create a new smart action"
                      >
                        <span className={styles.favAddItemIcon}>⚡</span>
                        <span className={styles.favAddItemText}>Create Action</span>
                      </button>
                    )}
                  </div>
                </div>

              </div>
            )}
          </>
        )}
      </div>

      {/* Context Menu for Renaming Switches */}
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
      
      {/* Action Context Menu (right-click on action cards) - direct rename */}
      {actionContextMenu && (
        <div
          ref={actionContextMenuRef}
          className={styles.contextMenu}
          style={{ left: actionContextMenu.x, top: actionContextMenu.y }}
        >
          <div className={styles.contextMenuTitle}>Rename Action</div>
          <input
            type="text"
            value={actionRenameValue}
            onChange={(e) => setActionRenameValue(e.target.value)}
            className={styles.contextMenuInput}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveActionRenameFromContext();
              if (e.key === 'Escape') setActionContextMenu(null);
            }}
          />
          <div className={styles.contextMenuButtons}>
            <button onClick={handleSaveActionRenameFromContext} disabled={!actionRenameValue.trim()}>Save</button>
            <button onClick={() => setActionContextMenu(null)}>Cancel</button>
          </div>
        </div>
      )}
      
      {/* Zone Context Menu (right-click on zone tabs) - rename zone */}
      {zoneContextMenu && (
        <div
          ref={zoneContextMenuRef}
          className={styles.contextMenu}
          style={{ left: zoneContextMenu.x, top: zoneContextMenu.y }}
        >
          <div className={styles.contextMenuTitle}>Rename Zone</div>
          <input
            type="text"
            value={zoneRenameValue}
            onChange={(e) => setZoneRenameValue(e.target.value)}
            className={styles.contextMenuInput}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameZone();
              if (e.key === 'Escape') setZoneContextMenu(null);
            }}
          />
          <div className={styles.contextMenuButtons}>
            <button onClick={handleRenameZone} disabled={!zoneRenameValue.trim() || allZones.includes(zoneRenameValue.trim()) && zoneRenameValue.trim() !== zoneContextMenu.zoneName}>Save</button>
            <button onClick={() => setZoneContextMenu(null)}>Cancel</button>
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
                <><br /><small>All switches and actions will be removed</small></>
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
      
      {/* Action Builder Modal */}
      {editingAction && editingActionData && (
        <div className={styles.actionBuilderOverlay} onClick={handleCancelEditAction}>
          <div className={styles.actionBuilderModal} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className={styles.actionBuilderHeader}>
              {isEditingActionName ? (
                <div className={styles.actionBuilderTitleEdit}>
                  <span className={styles.actionBuilderTitleIcon}>⚡</span>
                  <input
                    type="text"
                    value={editingActionNameValue}
                    onChange={(e) => setEditingActionNameValue(e.target.value)}
                    className={styles.actionBuilderNameInput}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && editingActionNameValue.trim()) handleSaveActionName();
                      if (e.key === 'Escape') handleCancelRenameAction();
                    }}
                    onBlur={() => {
                      if (editingActionNameValue.trim()) handleSaveActionName();
                      else handleCancelRenameAction();
                    }}
                  />
                  <button
                    type="button"
                    className={styles.actionBuilderNameSave}
                    onClick={handleSaveActionName}
                    disabled={!editingActionNameValue.trim()}
                    title="Save name"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className={styles.actionBuilderNameCancel}
                    onClick={handleCancelRenameAction}
                    title="Cancel"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <h3 
                  className={styles.actionBuilderTitle}
                  onClick={handleStartRenameAction}
                  title="Click to rename"
                >
                  <span className={styles.actionBuilderTitleIcon}>⚡</span>
                  <span className={styles.actionBuilderTitleText}>{editingActionData.name}</span>
                  <span className={styles.actionBuilderTitleEditHint}>✏️</span>
                </h3>
              )}
              <button
                type="button"
                className={styles.actionBuilderClose}
                onClick={handleCancelEditAction}
              >
                ✕
              </button>
            </div>
            
            {/* Action Timeline */}
            <div className={styles.actionBuilderContent}>
              <div className={styles.actionTimeline}>
                {editingActionData.stages.map((stage, stageIdx) => (
                  <div key={`stage-${stageIdx}`} className={styles.actionTimelineSection}>
                    {/* Stage Card */}
                    <div className={styles.actionStageCard}>
                      <div className={styles.actionStageHeader}>
                        <span className={styles.actionStageNumber}>Stage {stageIdx + 1}</span>
                        {editingActionData.stages.length > 1 && (
                          <button
                            type="button"
                            className={styles.actionStageRemove}
                            onClick={() => handleRemoveStage(stageIdx)}
                            title="Remove stage"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      
                      {/* Actions in this stage */}
                      <div className={styles.actionStageActions}>
                        {stage.actions.length === 0 && (
                          <div className={styles.actionStageEmpty}>
                            No switches selected
                          </div>
                        )}
                        {stage.actions.map((action, actionIdx) => {
                          const [, type] = action.switchId.split(':');
                          const isLight = type === 'light';
                          
                          return (
                            <div key={`action-${actionIdx}`} className={styles.actionActionItem}>
                              <span className={styles.actionActionIcon}>
                                {getSwitchTypeIcon(action.switchId)}
                              </span>
                              <span className={styles.actionActionName}>
                                {getSwitchNameFromId(action.switchId)}
                              </span>
                              <select
                                value={action.action}
                                onChange={(e) => handleUpdateActionType(stageIdx, actionIdx, e.target.value as StageActionType)}
                                className={styles.actionActionSelect}
                              >
                                {isLight ? (
                                  <>
                                    <option value="on">Turn On</option>
                                    <option value="off">Turn Off</option>
                                    <option value="toggle">Toggle</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="open">Open</option>
                                    <option value="close">Close</option>
                                    <option value="stop">Stop</option>
                                  </>
                                )}
                              </select>
                              <button
                                type="button"
                                className={styles.actionActionRemove}
                                onClick={() => handleRemoveActionFromStage(stageIdx, actionIdx)}
                                title="Remove"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Add Switch Dropdown */}
                      <div className={styles.actionAddSwitch}>
                        <select
                          className={styles.actionAddSwitchSelect}
                          value=""
                          onChange={(e) => {
                            const sw = availableDevices.find(d => d.id === e.target.value);
                            if (sw) handleAddActionToStage(stageIdx, sw);
                          }}
                        >
                          <option value="">
                            {availableDevices.length === 0 
                              ? '⚠️ Run discovery first...' 
                              : `+ Add switch... (${availableDevices.filter(d => !stage.actions.some(a => a.switchId === d.id)).length} available)`}
                          </option>
                          {availableDevices
                            .filter(d => !stage.actions.some(a => a.switchId === d.id))
                            .map(sw => (
                              <option key={sw.id} value={sw.id}>
                                {sw.type === 'light' ? '💡' : sw.type === 'venetian' ? '🪟' : '🪞'} {sw.name} ({sw.panelName})
                              </option>
                            ))
                          }
                        </select>
                      </div>
                    </div>
                    
                    {/* Scheduling between stages */}
                    {stageIdx < editingActionData.stages.length - 1 && editingActionData.scheduling[stageIdx] && (
                      <div className={styles.actionSchedulingCard}>
                        <div className={styles.actionSchedulingIcon}>⏱️</div>
                        <div className={styles.actionSchedulingContent}>
                          <select
                            value={editingActionData.scheduling[stageIdx].type}
                            onChange={(e) => handleUpdateScheduling(stageIdx, { 
                              type: e.target.value as SchedulingType,
                              delayMs: e.target.value === 'delay' ? 1000 : undefined,
                            })}
                            className={styles.actionSchedulingTypeSelect}
                          >
                            <option value="delay">⏱️ Fixed delay</option>
                            <option value="waitForCurtains">🔄 Wait until done</option>
                          </select>
                          
                          {editingActionData.scheduling[stageIdx].type === 'delay' && (
                            <div className={styles.actionSchedulingDelay}>
                              <input
                                type="number"
                                min="0"
                                max="300000"
                                step="100"
                                value={editingActionData.scheduling[stageIdx].delayMs || 0}
                                onChange={(e) => handleUpdateScheduling(stageIdx, { 
                                  delayMs: parseInt(e.target.value, 10) || 0 
                                })}
                                className={styles.actionSchedulingInput}
                              />
                              <span className={styles.actionSchedulingUnit}>ms</span>
                              <div className={styles.actionSchedulingPresets}>
                                {[500, 1000, 2000, 5000].map(ms => (
                                  <button
                                    key={ms}
                                    type="button"
                                    className={`${styles.actionSchedulingPreset} ${editingActionData.scheduling[stageIdx].delayMs === ms ? styles.actionSchedulingPresetActive : ''}`}
                                    onClick={() => handleUpdateScheduling(stageIdx, { delayMs: ms })}
                                  >
                                    {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {editingActionData.scheduling[stageIdx].type === 'waitForCurtains' && (
                            <div className={styles.actionSchedulingInfo}>
                              Waits for shades/curtains to stop moving before continuing
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                
                {/* Add Stage Button */}
                <button
                  type="button"
                  className={styles.actionAddStage}
                  onClick={handleAddStage}
                >
                  <span className={styles.actionAddStageIcon}>➕</span>
                  <span className={styles.actionAddStageText}>Add Stage</span>
                </button>
              </div>
            </div>
            
            {/* Footer */}
            <div className={styles.actionBuilderFooter}>
              <button
                type="button"
                className={styles.actionBuilderCancel}
                onClick={handleCancelEditAction}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.actionBuilderSave}
                onClick={handleSaveEditAction}
                disabled={editingActionData.stages.length === 0 || editingActionData.stages.every(s => s.actions.length === 0)}
              >
                💾 Save Action
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
