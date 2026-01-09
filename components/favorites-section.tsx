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
 * Favorites data structure with groups.
 * Stored in profile.favorites.groups
 */
export interface FavoritesData {
  groups: Record<string, FavoriteSwitch[]>;
}

/**
 * A single step in a smart action sequence (legacy format - for backward compatibility)
 */
export interface ActionStep {
  /** ID of the switch to control (format: "ip:type:index") */
  switchId: string;
  /** Action to perform: "on", "off", "toggle", "open", "close", "stop" */
  action: 'on' | 'off' | 'toggle' | 'open' | 'close' | 'stop';
  /** Delay in milliseconds before executing this step */
  delayMs: number;
}

/**
 * Action type for a switch in an action stage
 */
export type StageActionType = 'on' | 'off' | 'toggle' | 'open' | 'close' | 'stop';

/**
 * A single switch action within an action stage
 */
export interface StageAction {
  /** ID of the switch to control (format: "ip:type:index") */
  switchId: string;
  /** Action to perform */
  action: StageActionType;
}

/**
 * A stage in a smart action - one or more switch actions executed simultaneously
 */
export interface ActionStage {
  /** Actions to execute in this stage (all run in parallel) */
  actions: StageAction[];
}

/**
 * Scheduling type between stages
 */
export type SchedulingType = 'delay' | 'waitForCurtains';

/**
 * Scheduling configuration between action stages
 */
export interface ActionScheduling {
  /** Type of scheduling: fixed delay or wait for curtains to finish */
  type: SchedulingType;
  /** Delay in milliseconds (only used when type is 'delay') */
  delayMs?: number;
}

/**
 * A smart action - a user-programmed sequence with stages and scheduling.
 * New format: stages[] with scheduling[] between them
 */
export interface SmartAction {
  /** Display name for this smart action */
  name: string;
  /** Action stages - each contains 1+ switch actions executed together */
  stages: ActionStage[];
  /** Scheduling between stages - scheduling[i] is between stages[i] and stages[i+1] */
  scheduling: ActionScheduling[];
  /** Legacy steps format (for backward compatibility) - deprecated */
  steps?: ActionStep[];
}

/**
 * Action execution state
 */
export type ActionExecutionState = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

/**
 * Current action execution progress
 */
export interface ActionExecutionProgress {
  /** Current execution state */
  state: ActionExecutionState;
  /** Currently executing stage index (-1 if not started) */
  currentStage: number;
  /** Whether waiting for scheduling (delay/curtains) */
  isWaiting: boolean;
  /** Remaining delay time in ms (if waiting on delay) */
  remainingDelayMs?: number;
  /** Started at timestamp */
  startedAt?: number;
  /** Error message if any */
  error?: string;
}

/**
 * Smart switches data structure with groups.
 * Stored in profile.smart_switches.groups
 */
export interface SmartSwitchesData {
  groups: Record<string, SmartAction[]>;
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
    return { groups: {} };
  }
  const favObj = favorites as Record<string, unknown>;
  const groupsData = favObj.groups;
  if (groupsData && typeof groupsData === 'object') {
    // Migrate old format (relayIndex) to new format (index, type)
    const groups = groupsData as Record<string, unknown[]>;
    const migratedGroups: Record<string, FavoriteSwitch[]> = {};
    for (const [groupName, switches] of Object.entries(groups)) {
      migratedGroups[groupName] = (switches || []).map((sw: unknown) => {
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
    return { groups: migratedGroups };
  }
  return { groups: {} };
}

function parseSmartSwitches(smartSwitches: unknown): SmartSwitchesData {
  if (!smartSwitches || typeof smartSwitches !== 'object') {
    return { groups: {} };
  }
  const ssObj = smartSwitches as Record<string, unknown>;
  const groupsData = ssObj.groups;
  if (groupsData && typeof groupsData === 'object') {
    // Migrate old format (steps-based) to new format (stages-based)
    const groups = groupsData as Record<string, unknown[]>;
    const migratedGroups: Record<string, SmartAction[]> = {};
    
    for (const [groupName, actionsArr] of Object.entries(groups)) {
      migratedGroups[groupName] = (actionsArr || []).map((actionItem: unknown) => {
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
    
    return { groups: migratedGroups };
  }
  return { groups: {} };
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

  for (const [_groupName, switches] of Object.entries(favoritesData.groups || {})) {
    for (const sw of switches) {
      const switchId = `${sw.ip}:${sw.type}:${sw.index}`;
      if (!isPanelReachable(sw.ip)) {
        unreachableSwitchIds.add(switchId);
      }
    }
  }

  for (const [_groupName, actionsArr] of Object.entries(smartSwitchesData.groups || {})) {
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
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  
  // Inline editing states
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
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
    type: 'group' | 'switch' | 'action';
    name: string;
    onConfirm: () => void;
  } | null>(null);
  
  // Drag and drop state for switches
  const [draggedSwitch, setDraggedSwitch] = useState<{ index: number; switch: FavoriteSwitch } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Drag and drop state for actions
  const [draggedAction, setDraggedAction] = useState<{ index: number; action: SmartAction } | null>(null);
  const [actionDropIndicator, setActionDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Drag and drop state for groups
  const [draggedGroup, setDraggedGroup] = useState<{ index: number; name: string } | null>(null);
  const [groupDropIndicator, setGroupDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Action builder state
  const [editingAction, setEditingAction] = useState<{ groupName: string; actionIndex: number } | null>(null);
  const [editingActionData, setEditingActionData] = useState<SmartAction | null>(null);
  const [isEditingActionName, setIsEditingActionName] = useState(false);
  const [editingActionNameValue, setEditingActionNameValue] = useState('');
  
  // Action context menu (right-click on action cards)
  const [actionContextMenu, setActionContextMenu] = useState<{
    x: number;
    y: number;
    groupName: string;
    actionIndex: number;
    actionName: string;
  } | null>(null);
  const [actionRenameValue, setActionRenameValue] = useState('');
  const actionContextMenuRef = useRef<HTMLDivElement>(null);
  
  // Action execution state
  const [executingAction, setExecutingAction] = useState<SmartAction | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ActionExecutionProgress>({
    state: 'idle',
    currentStage: -1,
    isWaiting: false,
  });
  const executionAbortRef = useRef<boolean>(false);
  const executionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStageActionsRef = useRef<StageAction[]>([]); // Track current stage's actions for stop

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
  
  // ESC key handler for all modals/popups
  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close modals in order of priority (most recent/top-level first)
        if (deleteConfirm) {
          setDeleteConfirm(null);
        } else if (actionContextMenu) {
          setActionContextMenu(null);
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
        } else if (showNewGroupInput) {
          setShowNewGroupInput(false);
          setNewGroupName('');
        }
      }
    };
    
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [deleteConfirm, actionContextMenu, editingAction, contextMenu, showSwitchPicker, showActionCreator, showNewGroupInput]);

  // Reset warning dismissed state when profile changes
  useEffect(() => {
    setWarningDismissed(false);
  }, [profile?.id]);

  // Parse favorites from profile (no placeholders)
  const favoritesData = useMemo(() => {
    if (!profile) return { groups: {} };
    return parseFavorites(profile.favorites);
  }, [profile]);

  // Parse smart switches from profile (no placeholders)
  const smartSwitchesData = useMemo(() => {
    if (!profile) return { groups: {} };
    return parseSmartSwitches(profile.smart_switches);
  }, [profile]);

  // Combine groups from both favorites and smart switches
  const allGroups = useMemo(() => {
    const favoriteGroups = new Set(Object.keys(favoritesData.groups || {}));
    const smartGroups = new Set(Object.keys(smartSwitchesData.groups || {}));
    return [...new Set([...favoriteGroups, ...smartGroups])];
  }, [favoritesData.groups, smartSwitchesData.groups]);

  const totalSwitches = Object.values(favoritesData.groups || {}).reduce(
    (sum, switches) => sum + switches.length, 0
  );

  const totalActions = Object.values(smartSwitchesData.groups || {}).reduce(
    (sum, actions) => sum + actions.length, 0
  );

  // Set first group as active when expanded and no group is selected
  const effectiveActiveGroup = activeGroup ?? (allGroups.length > 0 ? allGroups[0] : null);

  // Get current group data
  const currentGroupSwitches = effectiveActiveGroup 
    ? (favoritesData.groups || {})[effectiveActiveGroup] ?? []
    : [];
  const currentGroupActions = useMemo(() => effectiveActiveGroup 
    ? (smartSwitchesData.groups || {})[effectiveActiveGroup] ?? []
    : [], [effectiveActiveGroup, smartSwitchesData.groups]);

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
    if (!draggedSwitch || !profile || !effectiveActiveGroup || !dropIndicator) return;
    
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
    
    const currentSwitches = [...((favoritesData.groups || {})[effectiveActiveGroup] || [])];
    const [removed] = currentSwitches.splice(dragIndex, 1);
    currentSwitches.splice(targetIndex, 0, removed);
    
    const newFavorites: FavoritesData = {
      groups: {
        ...(favoritesData.groups || {}),
        [effectiveActiveGroup]: currentSwitches,
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
    setDraggedSwitch(null);
    setDropIndicator(null);
  }, [draggedSwitch, dropIndicator, profile, effectiveActiveGroup, favoritesData.groups, onFavoritesUpdate]);

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
    if (!draggedAction || !profile || !effectiveActiveGroup || !actionDropIndicator) return;
    
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
    const currentActions = (smartSwitchesData.groups || {})[effectiveActiveGroup] || [];
    const newActions = [...currentActions];
    const [movedAction] = newActions.splice(dragIndex, 1);
    newActions.splice(targetIndex, 0, movedAction);
    
    const newSmartSwitches = {
      ...smartSwitchesData,
      groups: {
        ...(smartSwitchesData.groups || {}),
        [effectiveActiveGroup]: newActions,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    setDraggedAction(null);
    setActionDropIndicator(null);
  }, [draggedAction, actionDropIndicator, profile, effectiveActiveGroup, smartSwitchesData, onSmartSwitchesUpdate]);

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
    if (!contextMenu || !profile || !effectiveActiveGroup || !renameValue.trim()) return;
    
    const [ip, type, indexStr] = contextMenu.switchId.split(':');
    const index = parseInt(indexStr, 10);
    
    const currentSwitches = (favoritesData.groups || {})[effectiveActiveGroup] || [];
    const newSwitches = currentSwitches.map(sw => {
      if (sw.ip === ip && sw.type === type && sw.index === index) {
        return { ...sw, alias: renameValue.trim() };
      }
      return sw;
    });
    
    const newFavorites: FavoritesData = {
      groups: {
        ...(favoritesData.groups || {}),
        [effectiveActiveGroup]: newSwitches,
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
    setContextMenu(null);
  }, [contextMenu, profile, effectiveActiveGroup, renameValue, favoritesData.groups, onFavoritesUpdate]);

  const handleAddGroup = useCallback(() => {
    if (!newGroupName.trim() || !profile) return;
    const groupName = newGroupName.trim();
    
    if (allGroups.includes(groupName)) return;
    
    const newFavorites: FavoritesData = {
      groups: { ...(favoritesData.groups || {}), [groupName]: [] }
    };
    
    const newSmartSwitches: SmartSwitchesData = {
      groups: { ...(smartSwitchesData.groups || {}), [groupName]: [] }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    
    setActiveGroup(groupName);
    setNewGroupName('');
    setShowNewGroupInput(false);
  }, [newGroupName, profile, allGroups, favoritesData.groups, smartSwitchesData.groups, onFavoritesUpdate, onSmartSwitchesUpdate]);

  const handleDeleteGroup = useCallback((groupName: string) => {
    if (!profile) return;
    
    const { [groupName]: _, ...restFavorites } = favoritesData.groups || {};
    const { [groupName]: __, ...restSmartSwitches } = smartSwitchesData.groups || {};
    
    onFavoritesUpdate?.(profile.id, { groups: restFavorites });
    onSmartSwitchesUpdate?.(profile.id, { groups: restSmartSwitches });
    
    if (activeGroup === groupName) {
      const remaining = allGroups.filter(z => z !== groupName);
      setActiveGroup(remaining.length > 0 ? remaining[0] : null);
    }
  }, [profile, favoritesData.groups, smartSwitchesData.groups, activeGroup, allGroups, onFavoritesUpdate, onSmartSwitchesUpdate]);

  // Group drag and drop handlers
  const handleGroupDragStart = useCallback((e: React.DragEvent, index: number, groupName: string) => {
    setDraggedGroup({ index, name: groupName });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', groupName);
    
    // Style the dragged element
    const target = e.currentTarget as HTMLElement;
    setTimeout(() => target.classList.add(styles.groupTabDragging), 0);
  }, []);

  const handleGroupDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedGroup(null);
    setGroupDropIndicator(null);
    (e.currentTarget as HTMLElement).classList.remove(styles.groupTabDragging);
  }, []);

  const handleGroupDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (!draggedGroup || draggedGroup.index === index) return;
    
    // Determine drop position (before/after) based on mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const position: 'before' | 'after' = e.clientX < midX ? 'before' : 'after';
    
    setGroupDropIndicator({ index, position });
  }, [draggedGroup]);

  const handleGroupDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setGroupDropIndicator(null);
    }
  }, []);

  const handleGroupDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    
    if (!draggedGroup || !groupDropIndicator || !profile) {
      setGroupDropIndicator(null);
      setDraggedGroup(null);
      return;
    }
    
    const dragIndex = draggedGroup.index;
    let dropIndex = targetIndex;
    
    // Adjust drop index based on position
    if (groupDropIndicator.position === 'after') {
      dropIndex += 1;
    }
    
    // Adjust for removal of dragged item
    if (dragIndex < dropIndex) {
      dropIndex -= 1;
    }
    
    // No change needed
    if (dragIndex === dropIndex) {
      setGroupDropIndicator(null);
      setDraggedGroup(null);
      return;
    }
    
    // Reorder groups - create new ordered arrays
    const newGroupOrder = [...allGroups];
    const [removed] = newGroupOrder.splice(dragIndex, 1);
    newGroupOrder.splice(dropIndex, 0, removed);
    
    // Rebuild favorites groups with new order
    const newFavoritesGroups: Record<string, FavoriteSwitch[]> = {};
    for (const groupName of newGroupOrder) {
      newFavoritesGroups[groupName] = (favoritesData.groups || {})[groupName] || [];
    }
    
    // Rebuild smart switches groups with new order
    const newSmartSwitchesGroups: Record<string, SmartAction[]> = {};
    for (const groupName of newGroupOrder) {
      newSmartSwitchesGroups[groupName] = (smartSwitchesData.groups || {})[groupName] || [];
    }
    
    onFavoritesUpdate?.(profile.id, { groups: newFavoritesGroups });
    onSmartSwitchesUpdate?.(profile.id, { groups: newSmartSwitchesGroups });
    
    setGroupDropIndicator(null);
    setDraggedGroup(null);
  }, [draggedGroup, groupDropIndicator, profile, allGroups, favoritesData.groups, smartSwitchesData.groups, onFavoritesUpdate, onSmartSwitchesUpdate]);

  const handleAddSwitch = useCallback((sw: typeof availableDevices[0]) => {
    if (!profile || !effectiveActiveGroup) return;
    
    const newSwitch: FavoriteSwitch = {
      ip: sw.ip,
      index: sw.index,
      type: sw.type,
      originalName: sw.name,
      alias: sw.name,
    };
    
    const currentSwitches = (favoritesData.groups || {})[effectiveActiveGroup] || [];
    
    // Check if already exists
    if (currentSwitches.some(s => s.ip === sw.ip && s.index === sw.index && s.type === sw.type)) {
      return;
    }
    
    const newFavorites: FavoritesData = {
      groups: {
        ...(favoritesData.groups || {}),
        [effectiveActiveGroup]: [...currentSwitches, newSwitch],
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
  }, [profile, effectiveActiveGroup, favoritesData.groups, onFavoritesUpdate]);

  const handleRemoveSwitch = useCallback((sw: FavoriteSwitch) => {
    if (!profile || !effectiveActiveGroup) return;
    
    const currentSwitches = (favoritesData.groups || {})[effectiveActiveGroup] || [];
    const newSwitches = currentSwitches.filter(
      s => !(s.ip === sw.ip && s.index === sw.index && s.type === sw.type)
    );
    
    const newFavorites: FavoritesData = {
      groups: {
        ...(favoritesData.groups || {}),
        [effectiveActiveGroup]: newSwitches,
      }
    };
    
    onFavoritesUpdate?.(profile.id, newFavorites);
  }, [profile, effectiveActiveGroup, favoritesData.groups, onFavoritesUpdate]);

  const handleCreateAction = useCallback(() => {
    if (!newActionName.trim() || !profile || !effectiveActiveGroup) return;
    
    const newSmartAction: SmartAction = {
      name: newActionName.trim(),
      stages: [{ actions: [] }], // Start with one empty stage
      scheduling: [],
    };
    
    const currentActions = (smartSwitchesData.groups || {})[effectiveActiveGroup] || [];
    
    const newSmartSwitches: SmartSwitchesData = {
      groups: {
        ...(smartSwitchesData.groups || {}),
        [effectiveActiveGroup]: [...currentActions, newSmartAction],
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    
    // Auto-open the action editor for the newly created action
    const newSmartActionIndex = currentActions.length;
    setEditingAction({ groupName: effectiveActiveGroup, actionIndex: newSmartActionIndex });
    setEditingActionData(JSON.parse(JSON.stringify(newSmartAction)));
    
    setNewActionName('');
    setShowActionCreator(false);
  }, [newActionName, profile, effectiveActiveGroup, smartSwitchesData.groups, onSmartSwitchesUpdate]);

  const handleDeleteAction = useCallback((actionIndex: number) => {
    if (!profile || !effectiveActiveGroup) return;
    
    const currentActions = (smartSwitchesData.groups || {})[effectiveActiveGroup] || [];
    const newActions = currentActions.filter((_, i) => i !== actionIndex);
    
    const newSmartSwitches: SmartSwitchesData = {
      groups: {
        ...(smartSwitchesData.groups || {}),
        [effectiveActiveGroup]: newActions,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
  }, [profile, effectiveActiveGroup, smartSwitchesData.groups, onSmartSwitchesUpdate]);
  
  // Open action editor
  const handleEditAction = useCallback((actionIndex: number) => {
    if (!effectiveActiveGroup) return;
    
    const actionToEdit = currentGroupActions[actionIndex];
    if (!actionToEdit) return;
    
    setEditingAction({ groupName: effectiveActiveGroup, actionIndex });
    // Deep copy the action data
    setEditingActionData(JSON.parse(JSON.stringify(actionToEdit)));
  }, [effectiveActiveGroup, currentGroupActions]);
  
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
  const handleActionContextMenu = useCallback((e: React.MouseEvent, groupName: string, actionIndex: number, actionName: string) => {
    e.preventDefault();
    setActionContextMenu({
      x: e.clientX,
      y: e.clientY,
      groupName,
      actionIndex,
      actionName,
    });
    setActionRenameValue(actionName);
  }, []);
  
  // Rename action directly from context menu (save)
  const handleSaveActionRenameFromContext = useCallback(() => {
    if (!actionContextMenu || !profile || !actionRenameValue.trim()) return;
    
    const { groupName, actionIndex } = actionContextMenu;
    const newName = actionRenameValue.trim();
    
    // Check if name changed
    if (newName === actionContextMenu.actionName) {
      setActionContextMenu(null);
      return;
    }
    
    const currentActions = (smartSwitchesData.groups || {})[groupName] || [];
    const updatedActions = [...currentActions];
    
    if (updatedActions[actionIndex]) {
      updatedActions[actionIndex] = {
        ...updatedActions[actionIndex],
        name: newName,
      };
      
      onSmartSwitchesUpdate?.(profile.id, {
        ...smartSwitchesData,
        groups: {
          ...(smartSwitchesData.groups || {}),
          [groupName]: updatedActions,
        },
      });
    }
    
    setActionContextMenu(null);
    setActionRenameValue('');
  }, [actionContextMenu, profile, actionRenameValue, smartSwitchesData, onSmartSwitchesUpdate]);
  
  // Delete action from context menu
  const handleDeleteActionFromContext = useCallback(() => {
    if (!actionContextMenu) return;
    
    const { groupName, actionIndex, actionName } = actionContextMenu;
    
    setDeleteConfirm({
      type: 'action',
      name: actionName,
      onConfirm: () => {
        if (!profile) return;
        const currentActions = (smartSwitchesData.groups || {})[groupName] || [];
        const newActions = currentActions.filter((_, i) => i !== actionIndex);
        
        const newSmartSwitches: SmartSwitchesData = {
          groups: {
            ...(smartSwitchesData.groups || {}),
            [groupName]: newActions,
          }
        };
        
        onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
      },
    });
    
    setActionContextMenu(null);
  }, [actionContextMenu, profile, smartSwitchesData.groups, onSmartSwitchesUpdate]);
  
  // Save edited action
  const handleSaveEditAction = useCallback(() => {
    if (!profile || !editingAction || !editingActionData) return;
    
    const currentActions = (smartSwitchesData.groups || {})[editingAction.groupName] || [];
    const newActions = [...currentActions];
    newActions[editingAction.actionIndex] = editingActionData;
    
    const newSmartSwitches: SmartSwitchesData = {
      groups: {
        ...(smartSwitchesData.groups || {}),
        [editingAction.groupName]: newActions,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    setEditingAction(null);
    setEditingActionData(null);
  }, [profile, editingAction, editingActionData, smartSwitchesData.groups, onSmartSwitchesUpdate]);
  
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

  // Execute a single action (send command to panel)
  const executeActionAction = useCallback(async (action: StageAction): Promise<boolean> => {
    const [ip, type, indexStr] = action.switchId.split(':');
    const index = parseInt(indexStr, 10);
    
    if (type === 'light') {
      // Light actions: on, off, toggle
      if (action.action === 'toggle') {
        return sendPanelCommand(ip, 'toggle_relay', { index });
      } else {
        return sendPanelCommand(ip, 'set_relay', { index, state: action.action === 'on' });
      }
    } else {
      // Shade/Venetian actions: open, close, stop
      const curtainAction = action.action as 'open' | 'close' | 'stop';
      return sendPanelCommand(ip, 'curtain', { index, action: curtainAction });
    }
  }, []);
  
  // Check if any curtain in the given actions is still moving
  const areCurtainsStillMoving = useCallback((actions: StageAction[]): boolean => {
    for (const action of actions) {
      const [ip, type, indexStr] = action.switchId.split(':');
      if (type === 'shade' || type === 'venetian') {
        const index = parseInt(indexStr, 10);
        const liveState = livePanelStates.get(ip);
        const curtain = liveState?.fullState?.curtains.find(c => c.index === index);
        if (curtain?.state === 'opening' || curtain?.state === 'closing') {
          return true;
        }
      }
    }
    return false;
  }, [livePanelStates]);
  
  // Run an action
  const handleRunAction = useCallback(async (smartAction: SmartAction) => {
    if (executingAction) {
      console.log('[FavoritesSection] Action already running');
      return;
    }
    
    console.log('[FavoritesSection] Starting action:', smartAction.name);
    setExecutingAction(smartAction);
    executionAbortRef.current = false;
    
    setExecutionProgress({
      state: 'running',
      currentStage: 0,
      isWaiting: false,
      startedAt: Date.now(),
    });
    
    try {
      for (let stageIdx = 0; stageIdx < smartAction.stages.length; stageIdx++) {
        // Check for abort
        if (executionAbortRef.current) {
          console.log('[FavoritesSection] Action aborted at stage', stageIdx);
          setExecutionProgress(prev => ({ ...prev, state: 'stopped' }));
          break;
        }
        
        const stage = smartAction.stages[stageIdx];
        console.log(`[FavoritesSection] Executing stage ${stageIdx + 1}/${smartAction.stages.length}:`, 
          stage.actions.map(a => `${a.switchId} → ${a.action}`).join(', '));
        
        // Track current stage actions for stop functionality
        currentStageActionsRef.current = stage.actions;
        
        setExecutionProgress(prev => ({
          ...prev,
          currentStage: stageIdx,
          isWaiting: false,
        }));
        
        // Execute all actions in this stage concurrently
        await Promise.all(stage.actions.map(action => executeActionAction(action)));
        
        // Check for abort after executing actions
        if (executionAbortRef.current) {
          console.log('[FavoritesSection] Action aborted after stage execution');
          break;
        }
        
        // Wait for scheduling if not the last stage
        if (stageIdx < smartAction.stages.length - 1 && smartAction.scheduling[stageIdx]) {
          const sched = smartAction.scheduling[stageIdx];
          
          if (sched.type === 'delay' && sched.delayMs && sched.delayMs > 0) {
            // Delay scheduling
            console.log(`[FavoritesSection] Waiting ${sched.delayMs}ms...`);
            setExecutionProgress(prev => ({
              ...prev,
              isWaiting: true,
              remainingDelayMs: sched.delayMs,
            }));
            
            // Count down delay with updates
            const delayMs = sched.delayMs;
            const startTime = Date.now();
            const updateInterval = 100; // Update every 100ms
            
            await new Promise<void>((resolve) => {
              const checkDelay = () => {
                if (executionAbortRef.current) {
                  resolve();
                  return;
                }
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, delayMs - elapsed);
                
                setExecutionProgress(prev => ({
                  ...prev,
                  remainingDelayMs: remaining,
                }));
                
                if (remaining <= 0) {
                  resolve();
                } else {
                  executionTimeoutRef.current = setTimeout(checkDelay, updateInterval);
                }
              };
              executionTimeoutRef.current = setTimeout(checkDelay, updateInterval);
            });
          } else if (sched.type === 'waitForCurtains') {
            // Wait for curtains/shades to finish their operation
            console.log('[FavoritesSection] Waiting for continuous operations to complete...');
            setExecutionProgress(prev => ({
              ...prev,
              isWaiting: true,
              remainingDelayMs: undefined,
            }));
            
            // Poll until curtains stop moving (max 5 minutes for slow curtains)
            const maxWait = 300000; // 5 minutes
            const startTime = Date.now();
            const pollInterval = 500; // Check every 500ms
            
            // Small initial delay to let the curtain state update
            await new Promise(r => setTimeout(r, 1000));
            
            await new Promise<void>((resolve) => {
              const checkCurtains = () => {
                if (executionAbortRef.current) {
                  console.log('[FavoritesSection] Aborted while waiting for curtains');
                  resolve();
                  return;
                }
                
                const elapsed = Date.now() - startTime;
                const stillMoving = areCurtainsStillMoving(stage.actions);
                
                console.log(`[FavoritesSection] Checking curtains: stillMoving=${stillMoving}, elapsed=${elapsed}ms`);
                
                if (elapsed >= maxWait) {
                  console.log('[FavoritesSection] Max wait time reached, continuing action');
                  resolve();
                } else if (!stillMoving) {
                  console.log('[FavoritesSection] Curtains stopped, continuing action');
                  resolve();
                } else {
                  executionTimeoutRef.current = setTimeout(checkCurtains, pollInterval);
                }
              };
              // Start checking
              checkCurtains();
            });
          }
        }
      }
      
      // Completed
      if (!executionAbortRef.current) {
        console.log('[FavoritesSection] Action completed:', smartAction.name);
        setExecutionProgress(prev => ({
          ...prev,
          state: 'completed',
          currentStage: smartAction.stages.length,
          isWaiting: false,
        }));
      }
    } catch (error) {
      console.error('[FavoritesSection] Action error:', error);
      setExecutionProgress(prev => ({
        ...prev,
        state: 'stopped',
        error: (error as Error).message,
      }));
    }
    
    // Clear executing action after a delay to show completion state
    setTimeout(() => {
      setExecutingAction(null);
      setExecutionProgress({
        state: 'idle',
        currentStage: -1,
        isWaiting: false,
      });
    }, 2000);
  }, [executingAction, executeActionAction, areCurtainsStillMoving]);
  
  // Stop the running action - also stops any shades in progress
  const handleStopAction = useCallback(async () => {
    console.log('[FavoritesSection] Stopping action immediately...');
    executionAbortRef.current = true;
    
    // Clear any pending timeout
    if (executionTimeoutRef.current) {
      clearTimeout(executionTimeoutRef.current);
      executionTimeoutRef.current = null;
    }
    
    // Stop all shades/curtains from the current stage
    const currentActions = currentStageActionsRef.current;
    if (currentActions.length > 0) {
      console.log('[FavoritesSection] Stopping all shades from current stage...');
      const stopPromises: Promise<boolean>[] = [];
      
      for (const action of currentActions) {
        const [ip, type, indexStr] = action.switchId.split(':');
        if (type === 'shade' || type === 'venetian') {
          const index = parseInt(indexStr, 10);
          console.log(`[FavoritesSection] Sending stop to ${action.switchId}`);
          stopPromises.push(sendPanelCommand(ip, 'curtain', { index, action: 'stop' }));
        }
      }
      
      // Wait for stop commands to be sent (don't wait too long)
      if (stopPromises.length > 0) {
        await Promise.race([
          Promise.all(stopPromises),
          new Promise(r => setTimeout(r, 2000)) // Max 2 seconds
        ]);
      }
    }
    
    setExecutionProgress(prev => ({
      ...prev,
      state: 'stopped',
    }));
    
    // Clear current actions
    currentStageActionsRef.current = [];
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
            {profile && allGroups.length > 0 && (
              <span className={styles.favoritesBadge}>
                {allGroups.length} group{allGroups.length !== 1 ? 's' : ''} · {totalSwitches} switch{totalSwitches !== 1 ? 'es' : ''}
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
              {isFullscreen ? '⊠' : '⊡'}
            </button>
          )}
        </div>
      </div>

      {/* Collapsed summary - clickable buttons grouped by group */}
      {!effectivelyExpanded && profile && allGroups.length > 0 && (
        <div className={styles.favoritesCollapsedView}>
          {allGroups.map((groupName) => {
            const groupSwitches = (favoritesData.groups || {})[groupName] || [];
            const groupActions = (smartSwitchesData.groups || {})[groupName] || [];
            if (groupSwitches.length === 0 && groupActions.length === 0) return null;
            
            return (
              <div key={groupName} className={styles.favoritesCollapsedGroup}>
                <div className={styles.favoritesCollapsedGroupName}>{groupName}</div>
                <div className={styles.favoritesCollapsedItems}>
                  {groupSwitches.map((sw, idx) => {
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
                  {groupActions.map((smartAction, idx) => {
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
            {/* Group Navigation Row */}
            <div className={styles.favGroupNavRow}>
              <div className={styles.favoritesGroupTabs}>
                {allGroups.map((groupName, idx) => {
                  const isDragging = draggedGroup?.name === groupName;
                  const showDropBefore = groupDropIndicator?.index === idx && groupDropIndicator?.position === 'before' && draggedGroup?.index !== idx;
                  const showDropAfter = groupDropIndicator?.index === idx && groupDropIndicator?.position === 'after' && draggedGroup?.index !== idx;
                  
                  return (
                    <button
                      key={groupName}
                      type="button"
                      className={`${styles.favoritesGroupTab} ${effectiveActiveGroup === groupName ? styles.favoritesGroupTabActive : ''} ${isDragging ? styles.groupTabDragging : ''} ${showDropBefore ? styles.groupTabDropBefore : ''} ${showDropAfter ? styles.groupTabDropAfter : ''}`}
                      onClick={() => setActiveGroup(groupName)}
                      draggable
                      onDragStart={(e) => handleGroupDragStart(e, idx, groupName)}
                      onDragEnd={handleGroupDragEnd}
                      onDragOver={(e) => handleGroupDragOver(e, idx)}
                      onDragLeave={handleGroupDragLeave}
                      onDrop={(e) => handleGroupDrop(e, idx)}
                    >
                      <span className={styles.groupTabDragHandle} title="Drag to reorder">⋮⋮</span>
                      {groupName}
                      <span
                        className={styles.favoritesGroupTabDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm({
                            type: 'group',
                            name: groupName,
                            onConfirm: () => handleDeleteGroup(groupName),
                          });
                        }}
                        title="Delete group"
                      >
                        ✕
                      </span>
                    </button>
                  );
                })}
                
                {/* Add Group - styled as a group tab */}
                {showNewGroupInput ? (
                  <div className={styles.newGroupInputInline}>
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="Group name..."
                      className={styles.newGroupInputField}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddGroup();
                        if (e.key === 'Escape') {
                          setShowNewGroupInput(false);
                          setNewGroupName('');
                        }
                      }}
                    />
                    <span
                      className={styles.newGroupInputConfirm}
                      onClick={handleAddGroup}
                      style={{ opacity: newGroupName.trim() ? 1 : 0.4 }}
                    >
                      ✓
                    </span>
                    <span
                      className={styles.newGroupInputCancel}
                      onClick={() => {
                        setShowNewGroupInput(false);
                        setNewGroupName('');
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${styles.favoritesGroupTab} ${styles.favoritesGroupTabAdd}`}
                    onClick={() => setShowNewGroupInput(true)}
                  >
                    + Add Group
                  </button>
                )}
              </div>
            </div>

            {/* No groups empty state */}
            {allGroups.length === 0 && (
              <div className={styles.favoritesEmptyState}>
                <div className={styles.favoritesEmptyIcon}>🏠</div>
                <p>No groups yet. Create a group to organize your switches.</p>
                <button
                  type="button"
                  className={styles.favActionButton}
                  onClick={() => setShowNewGroupInput(true)}
                  data-variant="primary"
                >
                  ➕ Create Your First Group
                </button>
              </div>
            )}

            {/* Active group content */}
            {effectiveActiveGroup && allGroups.length > 0 && (
              <div className={styles.favGroupContentWrapper}>
                
                {/* SWITCHES SECTION */}
                <div className={styles.favSubSection}>
                  <div className={styles.favSubSectionHeader}>
                    <h4 className={styles.favSubSectionTitle}>
                      <span className={styles.favSubSectionIcon}>💡</span>
                      Switches
                      {currentGroupSwitches.length > 0 && (
                        <span className={styles.favSubSectionCount}>{currentGroupSwitches.length}</span>
                      )}
                    </h4>
                  </div>

                  <div className={styles.favoritesSwitchGrid} onDragLeave={handleGridDragLeave}>
                    {currentGroupSwitches.map((sw, idx) => {
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
                              const alreadyAdded = currentGroupSwitches.some(
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
                        title="Add a switch to this group"
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
                      {currentGroupActions.length > 0 && (
                        <span className={`${styles.favSubSectionCount} ${styles.favSubSectionCountPurple}`}>
                          {currentGroupActions.length}
                        </span>
                      )}
                    </h4>
                  </div>

                  <div className={styles.smartActionsGrid}>
                    {currentGroupActions.map((smartAction, idx) => {
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
                          onContextMenu={(e) => !isThisActionExecuting && handleActionContextMenu(e, effectiveActiveGroup!, idx, smartAction.name)}
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
                                      groupName: effectiveActiveGroup!,
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
              {deleteConfirm.type === 'group' && (
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
