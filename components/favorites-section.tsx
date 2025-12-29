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
 * A single step in a smart flow sequence (legacy format - for backward compatibility)
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
 * Action type for a switch in a flow
 */
export type FlowActionType = 'on' | 'off' | 'toggle' | 'open' | 'close' | 'stop';

/**
 * A single switch action within a flow stage
 */
export interface FlowAction {
  /** ID of the switch to control (format: "ip:type:index") */
  switchId: string;
  /** Action to perform */
  action: FlowActionType;
}

/**
 * A stage in the flow - one or more actions executed simultaneously
 */
export interface FlowStage {
  /** Actions to execute in this stage (all run in parallel) */
  actions: FlowAction[];
}

/**
 * Scheduling type between stages
 */
export type SchedulingType = 'delay' | 'waitForCurtains';

/**
 * Scheduling configuration between flow stages
 */
export interface FlowScheduling {
  /** Type of scheduling: fixed delay or wait for curtains to finish */
  type: SchedulingType;
  /** Delay in milliseconds (only used when type is 'delay') */
  delayMs?: number;
}

/**
 * A smart flow - a user-programmed sequence with stages and scheduling.
 * New format: stages[] with scheduling[] between them
 */
export interface SmartFlow {
  /** Display name for this flow */
  name: string;
  /** Flow stages - each contains 1+ switch actions executed together */
  stages: FlowStage[];
  /** Scheduling between stages - scheduling[i] is between stages[i] and stages[i+1] */
  scheduling: FlowScheduling[];
  /** Legacy steps format (for backward compatibility) - deprecated */
  steps?: FlowStep[];
}

/**
 * Flow execution state
 */
export type FlowExecutionState = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

/**
 * Current flow execution progress
 */
export interface FlowExecutionProgress {
  /** Current execution state */
  state: FlowExecutionState;
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
    // Migrate old format (steps-based) to new format (stages-based)
    const zones = ssObj.zones as Record<string, unknown[]>;
    const migratedZones: Record<string, SmartFlow[]> = {};
    
    for (const [zoneName, flows] of Object.entries(zones)) {
      migratedZones[zoneName] = (flows || []).map((flow: unknown) => {
        const flowObj = flow as Record<string, unknown>;
        
        // Check if already in new format (has stages array)
        if (Array.isArray(flowObj.stages)) {
          return {
            name: flowObj.name as string,
            stages: flowObj.stages as FlowStage[],
            scheduling: (flowObj.scheduling as FlowScheduling[]) || [],
          };
        }
        
        // Migrate from old format (steps) to new format (stages)
        const oldSteps = (flowObj.steps as FlowStep[]) || [];
        const stages: FlowStage[] = [];
        const scheduling: FlowScheduling[] = [];
        
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
          name: flowObj.name as string,
          stages,
          scheduling,
        };
      });
    }
    
    return { zones: migratedZones };
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
      const invalidStageIndices: number[] = [];
      // Check each stage's actions for unreachable switches
      (flow.stages || []).forEach((stage, stageIdx) => {
        for (const action of stage.actions) {
          const ip = action.switchId.split(':')[0];
          if (!isPanelReachable(ip)) {
            invalidStageIndices.push(stageIdx);
            unreachableSwitchIds.add(action.switchId);
          }
        }
      });
      if (invalidStageIndices.length > 0) {
        invalidFlowSteps.set(flow.name, [...new Set(invalidStageIndices)]);
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
  
  // Drag and drop state for switches
  const [draggedSwitch, setDraggedSwitch] = useState<{ index: number; switch: FavoriteSwitch } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Drag and drop state for flows
  const [draggedFlow, setDraggedFlow] = useState<{ index: number; flow: SmartFlow } | null>(null);
  const [flowDropIndicator, setFlowDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  
  // Flow builder state
  const [editingFlow, setEditingFlow] = useState<{ zoneName: string; flowIndex: number } | null>(null);
  const [editingFlowData, setEditingFlowData] = useState<SmartFlow | null>(null);
  const [isEditingFlowName, setIsEditingFlowName] = useState(false);
  const [editingFlowNameValue, setEditingFlowNameValue] = useState('');
  
  // Flow context menu (right-click on flow cards)
  const [flowContextMenu, setFlowContextMenu] = useState<{
    x: number;
    y: number;
    zoneName: string;
    flowIndex: number;
    flowName: string;
  } | null>(null);
  const [flowRenameValue, setFlowRenameValue] = useState('');
  const flowContextMenuRef = useRef<HTMLDivElement>(null);
  
  // Flow execution state
  const [executingFlow, setExecutingFlow] = useState<SmartFlow | null>(null);
  const [executionProgress, setExecutionProgress] = useState<FlowExecutionProgress>({
    state: 'idle',
    currentStage: -1,
    isWaiting: false,
  });
  const executionAbortRef = useRef<boolean>(false);
  const executionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStageActionsRef = useRef<FlowAction[]>([]); // Track current stage's actions for stop

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
  
  // Close flow context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (flowContextMenuRef.current && !flowContextMenuRef.current.contains(e.target as Node)) {
        setFlowContextMenu(null);
      }
    };
    if (flowContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [flowContextMenu]);
  
  // ESC key handler for all modals/popups
  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close modals in order of priority (most recent/top-level first)
        if (deleteConfirm) {
          setDeleteConfirm(null);
        } else if (flowContextMenu) {
          setFlowContextMenu(null);
        } else if (editingFlow) {
          setEditingFlow(null);
          setEditingFlowData(null);
          setIsEditingFlowName(false);
        } else if (contextMenu) {
          setContextMenu(null);
        } else if (showSwitchPicker) {
          setShowSwitchPicker(false);
          setSwitchPickerSearch('');
        } else if (showFlowCreator) {
          setShowFlowCreator(false);
          setNewFlowName('');
        } else if (showNewZoneInput) {
          setShowNewZoneInput(false);
          setNewZoneName('');
        }
      }
    };
    
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [deleteConfirm, flowContextMenu, editingFlow, contextMenu, showSwitchPicker, showFlowCreator, showNewZoneInput]);

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

  // Flow drag and drop handlers
  const handleFlowDragStart = useCallback((e: React.DragEvent, index: number, flow: SmartFlow) => {
    setDraggedFlow({ index, flow });
    e.dataTransfer.effectAllowed = 'move';
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4';
    }
  }, []);

  const handleFlowDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedFlow(null);
    setFlowDropIndicator(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  const handleFlowDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (!draggedFlow) return;
    
    // Determine if dropping before or after based on mouse position
    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const position: 'before' | 'after' = e.clientX < midX ? 'before' : 'after';
    
    setFlowDropIndicator({ index, position });
  }, [draggedFlow]);

  const handleFlowDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setFlowDropIndicator(null);
    }
  }, []);

  const handleFlowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedFlow || !profile || !effectiveActiveZone || !flowDropIndicator) return;
    
    const { index: dragIndex } = draggedFlow;
    let targetIndex = flowDropIndicator.index;
    
    // Adjust target index based on position
    if (flowDropIndicator.position === 'after') {
      targetIndex += 1;
    }
    
    // Adjust for the removal of the dragged item
    if (dragIndex < targetIndex) {
      targetIndex -= 1;
    }
    
    // Don't do anything if dropping at the same position
    if (dragIndex === targetIndex) {
      setDraggedFlow(null);
      setFlowDropIndicator(null);
      return;
    }
    
    // Reorder flows
    const currentFlows = (smartSwitchesData.zones || {})[effectiveActiveZone] || [];
    const newFlows = [...currentFlows];
    const [movedFlow] = newFlows.splice(dragIndex, 1);
    newFlows.splice(targetIndex, 0, movedFlow);
    
    const newSmartSwitches = {
      ...smartSwitchesData,
      zones: {
        ...(smartSwitchesData.zones || {}),
        [effectiveActiveZone]: newFlows,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    setDraggedFlow(null);
    setFlowDropIndicator(null);
  }, [draggedFlow, flowDropIndicator, profile, effectiveActiveZone, smartSwitchesData, onSmartSwitchesUpdate]);

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

  const handleCreateFlow = useCallback(() => {
    if (!newFlowName.trim() || !profile || !effectiveActiveZone) return;
    
    const newFlow: SmartFlow = {
      name: newFlowName.trim(),
      stages: [{ actions: [] }], // Start with one empty stage
      scheduling: [],
    };
    
    const currentFlows = (smartSwitchesData.zones || {})[effectiveActiveZone] || [];
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: {
        ...(smartSwitchesData.zones || {}),
        [effectiveActiveZone]: [...currentFlows, newFlow],
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    
    // Auto-open the flow editor for the newly created flow
    const newFlowIndex = currentFlows.length;
    setEditingFlow({ zoneName: effectiveActiveZone, flowIndex: newFlowIndex });
    setEditingFlowData(JSON.parse(JSON.stringify(newFlow)));
    
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
  
  // Open flow editor
  const handleEditFlow = useCallback((flowIndex: number) => {
    if (!effectiveActiveZone) return;
    
    const flow = currentZoneFlows[flowIndex];
    if (!flow) return;
    
    setEditingFlow({ zoneName: effectiveActiveZone, flowIndex });
    // Deep copy the flow data
    setEditingFlowData(JSON.parse(JSON.stringify(flow)));
  }, [effectiveActiveZone, currentZoneFlows]);
  
  // Close flow editor without saving
  const handleCancelEditFlow = useCallback(() => {
    setEditingFlow(null);
    setEditingFlowData(null);
    setIsEditingFlowName(false);
  }, []);
  
  // Start editing flow name
  const handleStartRenameFlow = useCallback(() => {
    if (editingFlowData) {
      setEditingFlowNameValue(editingFlowData.name);
      setIsEditingFlowName(true);
    }
  }, [editingFlowData]);
  
  // Save flow name
  const handleSaveFlowName = useCallback(() => {
    if (!editingFlowData || !editingFlowNameValue.trim()) return;
    
    setEditingFlowData({
      ...editingFlowData,
      name: editingFlowNameValue.trim(),
    });
    setIsEditingFlowName(false);
  }, [editingFlowData, editingFlowNameValue]);
  
  // Cancel flow name editing
  const handleCancelRenameFlow = useCallback(() => {
    setIsEditingFlowName(false);
    setEditingFlowNameValue('');
  }, []);
  
  // Flow context menu handler (right-click on flow card) - directly starts renaming
  const handleFlowContextMenu = useCallback((e: React.MouseEvent, zoneName: string, flowIndex: number, flowName: string) => {
    e.preventDefault();
    setFlowContextMenu({
      x: e.clientX,
      y: e.clientY,
      zoneName,
      flowIndex,
      flowName,
    });
    setFlowRenameValue(flowName);
  }, []);
  
  // Rename flow directly from context menu (save)
  const handleSaveFlowRenameFromContext = useCallback(() => {
    if (!flowContextMenu || !profile || !flowRenameValue.trim()) return;
    
    const { zoneName, flowIndex } = flowContextMenu;
    const newName = flowRenameValue.trim();
    
    // Check if name changed
    if (newName === flowContextMenu.flowName) {
      setFlowContextMenu(null);
      return;
    }
    
    const currentFlows = (smartSwitchesData.zones || {})[zoneName] || [];
    const updatedFlows = [...currentFlows];
    
    if (updatedFlows[flowIndex]) {
      updatedFlows[flowIndex] = {
        ...updatedFlows[flowIndex],
        name: newName,
      };
      
      onSmartSwitchesUpdate?.(profile.id, {
        ...smartSwitchesData,
        zones: {
          ...(smartSwitchesData.zones || {}),
          [zoneName]: updatedFlows,
        },
      });
    }
    
    setFlowContextMenu(null);
    setFlowRenameValue('');
  }, [flowContextMenu, profile, flowRenameValue, smartSwitchesData, onSmartSwitchesUpdate]);
  
  // Delete flow from context menu
  const handleDeleteFlowFromContext = useCallback(() => {
    if (!flowContextMenu) return;
    
    const { zoneName, flowIndex, flowName } = flowContextMenu;
    
    setDeleteConfirm({
      type: 'flow',
      name: flowName,
      onConfirm: () => {
        if (!profile) return;
        const currentFlows = (smartSwitchesData.zones || {})[zoneName] || [];
        const newFlows = currentFlows.filter((_, i) => i !== flowIndex);
        
        const newSmartSwitches: SmartSwitchesData = {
          zones: {
            ...(smartSwitchesData.zones || {}),
            [zoneName]: newFlows,
          }
        };
        
        onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
      },
    });
    
    setFlowContextMenu(null);
  }, [flowContextMenu, profile, smartSwitchesData.zones, onSmartSwitchesUpdate]);
  
  // Save edited flow
  const handleSaveEditFlow = useCallback(() => {
    if (!profile || !editingFlow || !editingFlowData) return;
    
    const currentFlows = (smartSwitchesData.zones || {})[editingFlow.zoneName] || [];
    const newFlows = [...currentFlows];
    newFlows[editingFlow.flowIndex] = editingFlowData;
    
    const newSmartSwitches: SmartSwitchesData = {
      zones: {
        ...(smartSwitchesData.zones || {}),
        [editingFlow.zoneName]: newFlows,
      }
    };
    
    onSmartSwitchesUpdate?.(profile.id, newSmartSwitches);
    setEditingFlow(null);
    setEditingFlowData(null);
  }, [profile, editingFlow, editingFlowData, smartSwitchesData.zones, onSmartSwitchesUpdate]);
  
  // Add a new stage to the flow
  const handleAddStage = useCallback(() => {
    if (!editingFlowData) return;
    
    const newStages = [...editingFlowData.stages, { actions: [] }];
    const newScheduling = [...editingFlowData.scheduling];
    
    // Add scheduling between previous stage and new stage (if not first)
    if (newStages.length > 1) {
      newScheduling.push({ type: 'delay', delayMs: 1000 });
    }
    
    setEditingFlowData({
      ...editingFlowData,
      stages: newStages,
      scheduling: newScheduling,
    });
  }, [editingFlowData]);
  
  // Remove a stage
  const handleRemoveStage = useCallback((stageIndex: number) => {
    if (!editingFlowData) return;
    
    const newStages = editingFlowData.stages.filter((_, i) => i !== stageIndex);
    const newScheduling = [...editingFlowData.scheduling];
    
    // Remove scheduling at the correct index
    if (stageIndex > 0 && newScheduling.length >= stageIndex) {
      newScheduling.splice(stageIndex - 1, 1);
    } else if (stageIndex === 0 && newScheduling.length > 0) {
      newScheduling.splice(0, 1);
    }
    
    setEditingFlowData({
      ...editingFlowData,
      stages: newStages,
      scheduling: newScheduling,
    });
  }, [editingFlowData]);
  
  // Add a switch to a stage
  const handleAddActionToStage = useCallback((stageIndex: number, sw: typeof availableDevices[0]) => {
    if (!editingFlowData) return;
    
    const newStages = [...editingFlowData.stages];
    const defaultAction: FlowActionType = sw.type === 'light' ? 'toggle' : 'open';
    
    // Check if switch already exists in stage
    const existsInStage = newStages[stageIndex].actions.some(a => a.switchId === sw.id);
    if (existsInStage) return;
    
    newStages[stageIndex] = {
      actions: [
        ...newStages[stageIndex].actions,
        { switchId: sw.id, action: defaultAction },
      ],
    };
    
    setEditingFlowData({
      ...editingFlowData,
      stages: newStages,
    });
  }, [editingFlowData]);
  
  // Remove an action from a stage
  const handleRemoveActionFromStage = useCallback((stageIndex: number, actionIndex: number) => {
    if (!editingFlowData) return;
    
    const newStages = [...editingFlowData.stages];
    newStages[stageIndex] = {
      actions: newStages[stageIndex].actions.filter((_, i) => i !== actionIndex),
    };
    
    setEditingFlowData({
      ...editingFlowData,
      stages: newStages,
    });
  }, [editingFlowData]);
  
  // Update action type
  const handleUpdateActionType = useCallback((stageIndex: number, actionIndex: number, newAction: FlowActionType) => {
    if (!editingFlowData) return;
    
    const newStages = [...editingFlowData.stages];
    const actions = [...newStages[stageIndex].actions];
    actions[actionIndex] = { ...actions[actionIndex], action: newAction };
    newStages[stageIndex] = { actions };
    
    setEditingFlowData({
      ...editingFlowData,
      stages: newStages,
    });
  }, [editingFlowData]);
  
  // Update scheduling between stages
  const handleUpdateScheduling = useCallback((schedIndex: number, updates: Partial<FlowScheduling>) => {
    if (!editingFlowData) return;
    
    const newScheduling = [...editingFlowData.scheduling];
    newScheduling[schedIndex] = { ...newScheduling[schedIndex], ...updates };
    
    setEditingFlowData({
      ...editingFlowData,
      scheduling: newScheduling,
    });
  }, [editingFlowData]);
  
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
  const executeFlowAction = useCallback(async (action: FlowAction): Promise<boolean> => {
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
  const areCurtainsStillMoving = useCallback((actions: FlowAction[]): boolean => {
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
  
  // Run a flow
  const handleRunFlow = useCallback(async (flow: SmartFlow) => {
    if (executingFlow) {
      console.log('[FavoritesSection] Flow already running');
      return;
    }
    
    console.log('[FavoritesSection] Starting flow:', flow.name);
    setExecutingFlow(flow);
    executionAbortRef.current = false;
    
    setExecutionProgress({
      state: 'running',
      currentStage: 0,
      isWaiting: false,
      startedAt: Date.now(),
    });
    
    try {
      for (let stageIdx = 0; stageIdx < flow.stages.length; stageIdx++) {
        // Check for abort
        if (executionAbortRef.current) {
          console.log('[FavoritesSection] Flow aborted at stage', stageIdx);
          setExecutionProgress(prev => ({ ...prev, state: 'stopped' }));
          break;
        }
        
        const stage = flow.stages[stageIdx];
        console.log(`[FavoritesSection] Executing stage ${stageIdx + 1}/${flow.stages.length}:`, 
          stage.actions.map(a => `${a.switchId} → ${a.action}`).join(', '));
        
        // Track current stage actions for stop functionality
        currentStageActionsRef.current = stage.actions;
        
        setExecutionProgress(prev => ({
          ...prev,
          currentStage: stageIdx,
          isWaiting: false,
        }));
        
        // Execute all actions in this stage concurrently
        await Promise.all(stage.actions.map(action => executeFlowAction(action)));
        
        // Check for abort after executing actions
        if (executionAbortRef.current) {
          console.log('[FavoritesSection] Flow aborted after stage execution');
          break;
        }
        
        // Wait for scheduling if not the last stage
        if (stageIdx < flow.stages.length - 1 && flow.scheduling[stageIdx]) {
          const sched = flow.scheduling[stageIdx];
          
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
                  console.log('[FavoritesSection] Max wait time reached, continuing flow');
                  resolve();
                } else if (!stillMoving) {
                  console.log('[FavoritesSection] Curtains stopped, continuing flow');
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
        console.log('[FavoritesSection] Flow completed:', flow.name);
        setExecutionProgress(prev => ({
          ...prev,
          state: 'completed',
          currentStage: flow.stages.length,
          isWaiting: false,
        }));
      }
    } catch (error) {
      console.error('[FavoritesSection] Flow error:', error);
      setExecutionProgress(prev => ({
        ...prev,
        state: 'stopped',
        error: (error as Error).message,
      }));
    }
    
    // Clear executing flow after a delay to show completion state
    setTimeout(() => {
      setExecutingFlow(null);
      setExecutionProgress({
        state: 'idle',
        currentStage: -1,
        isWaiting: false,
      });
    }, 2000);
  }, [executingFlow, executeFlowAction, areCurtainsStillMoving]);
  
  // Stop the running flow - also stops any shades in progress
  const handleStopFlow = useCallback(async () => {
    console.log('[FavoritesSection] Stopping flow immediately...');
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
            ⭐ Favorites &amp; Smart Flows
            {profile && allZones.length > 0 && (
              <span className={styles.favoritesBadge}>
                {allZones.length} zone{allZones.length !== 1 ? 's' : ''} · {totalSwitches} switch{totalSwitches !== 1 ? 'es' : ''}
                {totalFlows > 0 && ` · ${totalFlows} flow${totalFlows !== 1 ? 's' : ''}`}
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

      {/* Collapsed summary - clickable buttons grouped by zone */}
      {!effectivelyExpanded && profile && allZones.length > 0 && (
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
                  {zoneFlows.map((flow, idx) => {
                    const flowHasInvalidSteps = hasInvalidSteps(flow);
                    // Only show invalid state AFTER discovery completes (not during loading)
                    const showInvalidState = !isLoading && discoveryCompleted && flowHasInvalidSteps;
                    // Check if this specific flow is running
                    const isThisFlowRunning = executingFlow?.name === flow.name && 
                      executionProgress.state === 'running';
                    
                    return (
                      <button
                        key={`flow-${flow.name}-${idx}`}
                        type="button"
                        className={`${styles.favoritesCollapsedButton} ${styles.favoritesCollapsedButtonFlow} ${showInvalidState ? styles.favoritesCollapsedButtonInvalid : ''} ${isThisFlowRunning ? styles.favoritesCollapsedButtonRunning : ''}`}
                        onClick={() => {
                          if (isThisFlowRunning) {
                            handleStopFlow();
                          } else if (!showInvalidState && !executingFlow) {
                            handleRunFlow(flow);
                          }
                        }}
                        disabled={isLoading || showInvalidState || (!!executingFlow && !isThisFlowRunning)}
                        title={isThisFlowRunning ? 'Stop flow' : flow.name}
                      >
                        <span className={styles.favoritesCollapsedIcon}>
                          {showInvalidState ? '⚠️' : isThisFlowRunning ? '⏹️' : '▶'}
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
                      
                      // Check if this flow is currently executing
                      const isThisFlowExecuting = executingFlow?.name === flow.name && 
                        executionProgress.state === 'running';
                      const isThisFlowCompleted = executingFlow?.name === flow.name && 
                        executionProgress.state === 'completed';
                      const isThisFlowStopped = executingFlow?.name === flow.name && 
                        executionProgress.state === 'stopped';
                      
                      // Calculate total duration
                      const totalDurationMs = flow.scheduling?.reduce((acc, s) => 
                        acc + (s.type === 'delay' ? (s.delayMs || 0) : 2000), 0) || 0;
                      
                      // Drag and drop indicators
                      const showFlowDropBefore = flowDropIndicator?.index === idx && flowDropIndicator?.position === 'before' && draggedFlow?.index !== idx;
                      const showFlowDropAfter = flowDropIndicator?.index === idx && flowDropIndicator?.position === 'after' && draggedFlow?.index !== idx;
                      
                      return (
                        <div
                          key={`flow-${flow.name}-${idx}`}
                          className={`${styles.smartFlowCard} ${showInvalidState ? styles.smartFlowCardInvalid : ''} ${isThisFlowExecuting ? styles.smartFlowCardExecuting : ''} ${isThisFlowCompleted ? styles.smartFlowCardCompleted : ''} ${isThisFlowStopped ? styles.smartFlowCardStopped : ''} ${showFlowDropBefore ? styles.smartFlowCardDropBefore : ''} ${showFlowDropAfter ? styles.smartFlowCardDropAfter : ''}`}
                          draggable={!isThisFlowExecuting}
                          onDragStart={(e) => handleFlowDragStart(e, idx, flow)}
                          onDragEnd={handleFlowDragEnd}
                          onDragOver={(e) => handleFlowDragOver(e, idx)}
                          onDragLeave={handleFlowDragLeave}
                          onDrop={handleFlowDrop}
                          onContextMenu={(e) => !isThisFlowExecuting && handleFlowContextMenu(e, effectiveActiveZone!, idx, flow.name)}
                        >
                          <div className={styles.smartFlowCardHeader}>
                            <span className={styles.smartFlowIcon}>
                              {isThisFlowExecuting ? '⏳' : isThisFlowCompleted ? '✅' : isThisFlowStopped ? '⏹️' : showInvalidState ? '⚠️' : '⚡'}
                            </span>
                            <span className={styles.smartFlowName}>{flow.name}</span>
                            {!isThisFlowExecuting && (
                              <>
                                <button
                                  type="button"
                                  className={styles.smartFlowEdit}
                                  onClick={() => handleEditFlow(idx)}
                                  title="Edit flow"
                                >
                                  ✏️
                                </button>
                                {/* Desktop: delete button. Mobile: more menu button */}
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
                                  <span className={styles.desktopOnly}>✕</span>
                                </button>
                                <button
                                  type="button"
                                  className={styles.smartFlowMore}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Position context menu near the button on mobile
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setFlowContextMenu({
                                      x: rect.left,
                                      y: rect.bottom + 4,
                                      zoneName: effectiveActiveZone!,
                                      flowIndex: idx,
                                      flowName: flow.name,
                                    });
                                    setFlowRenameValue(flow.name);
                                  }}
                                  title="More options"
                                >
                                  ⋮
                                </button>
                              </>
                            )}
                          </div>
                          
                          {/* Execution Progress */}
                          {isThisFlowExecuting && (
                            <div className={styles.smartFlowProgress}>
                              <div className={styles.smartFlowProgressBar}>
                                <div 
                                  className={styles.smartFlowProgressFill}
                                  style={{ 
                                    width: `${((executionProgress.currentStage + 1) / flow.stages.length) * 100}%` 
                                  }}
                                />
                              </div>
                              <div className={styles.smartFlowProgressText}>
                                Stage {executionProgress.currentStage + 1}/{flow.stages.length}
                                {executionProgress.isWaiting && executionProgress.remainingDelayMs !== undefined && (
                                  <span className={styles.smartFlowWaiting}>
                                    ⏱️ {(executionProgress.remainingDelayMs / 1000).toFixed(1)}s
                                  </span>
                                )}
                                {executionProgress.isWaiting && executionProgress.remainingDelayMs === undefined && (
                                  <span className={styles.smartFlowWaiting}>
                                    🔄 Waiting until done...
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {/* Normal meta info */}
                          {!isThisFlowExecuting && (
                            <div className={styles.smartFlowMeta}>
                              {flow.stages?.length || 0} stage{(flow.stages?.length || 0) !== 1 ? 's' : ''}
                              {showInvalidState && (
                                <span className={styles.smartFlowInvalidCount}>
                                  {invalidStepIndices.length} unreachable
                                </span>
                              )}
                              {(flow.stages?.length || 0) > 0 && !showInvalidState && totalDurationMs > 0 && (
                                <span className={styles.smartFlowDuration}>
                                  &gt; {Math.ceil(totalDurationMs / 1000)}s
                                </span>
                              )}
                            </div>
                          )}
                          
                          {/* Action buttons */}
                          {isThisFlowExecuting ? (
                            <button
                              type="button"
                              className={styles.smartFlowStopButton}
                              onClick={handleStopFlow}
                            >
                              ⏹️ Stop
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`${styles.smartFlowRunButton} ${showInvalidState ? styles.smartFlowRunButtonDisabled : ''}`}
                              onClick={() => handleRunFlow(flow)}
                              disabled={isLoading || showInvalidState || !!executingFlow}
                            >
                              {isThisFlowCompleted ? '✅ Done!' : isThisFlowStopped ? '⏹️ Stopped' : showInvalidState ? '⚠️ Cannot Run' : '▶ Run'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    
                    {/* Create Flow */}
                    {showFlowCreator ? (
                      <div className={styles.flowCreatorCard}>
                        <div className={styles.flowCreatorHeader}>
                          <span className={styles.flowCreatorIcon}>⚡</span>
                          <span className={styles.flowCreatorTitle}>New Flow</span>
                          <button
                            type="button"
                            className={styles.flowCreatorClose}
                            onClick={() => {
                              setShowFlowCreator(false);
                              setNewFlowName('');
                            }}
                            title="Cancel (Esc)"
                          >
                            ✕
                          </button>
                        </div>
                        <input
                          type="text"
                          value={newFlowName}
                          onChange={(e) => setNewFlowName(e.target.value)}
                          placeholder="Enter flow name..."
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
                        <button
                          type="button"
                          className={styles.flowCreatorSubmit}
                          onClick={handleCreateFlow}
                          disabled={!newFlowName.trim()}
                        >
                          ✨ Create &amp; Edit
                        </button>
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
      
      {/* Flow Context Menu (right-click on flow cards) - direct rename */}
      {flowContextMenu && (
        <div
          ref={flowContextMenuRef}
          className={styles.contextMenu}
          style={{ left: flowContextMenu.x, top: flowContextMenu.y }}
        >
          <div className={styles.contextMenuTitle}>Rename Flow</div>
          <input
            type="text"
            value={flowRenameValue}
            onChange={(e) => setFlowRenameValue(e.target.value)}
            className={styles.contextMenuInput}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveFlowRenameFromContext();
              if (e.key === 'Escape') setFlowContextMenu(null);
            }}
          />
          <div className={styles.contextMenuButtons}>
            <button onClick={handleSaveFlowRenameFromContext} disabled={!flowRenameValue.trim()}>Save</button>
            <button onClick={() => setFlowContextMenu(null)}>Cancel</button>
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
      
      {/* Flow Builder Modal */}
      {editingFlow && editingFlowData && (
        <div className={styles.flowBuilderOverlay} onClick={handleCancelEditFlow}>
          <div className={styles.flowBuilderModal} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className={styles.flowBuilderHeader}>
              {isEditingFlowName ? (
                <div className={styles.flowBuilderTitleEdit}>
                  <span className={styles.flowBuilderTitleIcon}>⚡</span>
                  <input
                    type="text"
                    value={editingFlowNameValue}
                    onChange={(e) => setEditingFlowNameValue(e.target.value)}
                    className={styles.flowBuilderNameInput}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && editingFlowNameValue.trim()) handleSaveFlowName();
                      if (e.key === 'Escape') handleCancelRenameFlow();
                    }}
                    onBlur={() => {
                      if (editingFlowNameValue.trim()) handleSaveFlowName();
                      else handleCancelRenameFlow();
                    }}
                  />
                  <button
                    type="button"
                    className={styles.flowBuilderNameSave}
                    onClick={handleSaveFlowName}
                    disabled={!editingFlowNameValue.trim()}
                    title="Save name"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className={styles.flowBuilderNameCancel}
                    onClick={handleCancelRenameFlow}
                    title="Cancel"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <h3 
                  className={styles.flowBuilderTitle}
                  onClick={handleStartRenameFlow}
                  title="Click to rename"
                >
                  <span className={styles.flowBuilderTitleIcon}>⚡</span>
                  <span className={styles.flowBuilderTitleText}>{editingFlowData.name}</span>
                  <span className={styles.flowBuilderTitleEditHint}>✏️</span>
                </h3>
              )}
              <button
                type="button"
                className={styles.flowBuilderClose}
                onClick={handleCancelEditFlow}
              >
                ✕
              </button>
            </div>
            
            {/* Flow Timeline */}
            <div className={styles.flowBuilderContent}>
              <div className={styles.flowTimeline}>
                {editingFlowData.stages.map((stage, stageIdx) => (
                  <div key={`stage-${stageIdx}`} className={styles.flowTimelineSection}>
                    {/* Stage Card */}
                    <div className={styles.flowStageCard}>
                      <div className={styles.flowStageHeader}>
                        <span className={styles.flowStageNumber}>Stage {stageIdx + 1}</span>
                        {editingFlowData.stages.length > 1 && (
                          <button
                            type="button"
                            className={styles.flowStageRemove}
                            onClick={() => handleRemoveStage(stageIdx)}
                            title="Remove stage"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      
                      {/* Actions in this stage */}
                      <div className={styles.flowStageActions}>
                        {stage.actions.length === 0 && (
                          <div className={styles.flowStageEmpty}>
                            No switches selected
                          </div>
                        )}
                        {stage.actions.map((action, actionIdx) => {
                          const [, type] = action.switchId.split(':');
                          const isLight = type === 'light';
                          
                          return (
                            <div key={`action-${actionIdx}`} className={styles.flowActionItem}>
                              <span className={styles.flowActionIcon}>
                                {getSwitchTypeIcon(action.switchId)}
                              </span>
                              <span className={styles.flowActionName}>
                                {getSwitchNameFromId(action.switchId)}
                              </span>
                              <select
                                value={action.action}
                                onChange={(e) => handleUpdateActionType(stageIdx, actionIdx, e.target.value as FlowActionType)}
                                className={styles.flowActionSelect}
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
                                className={styles.flowActionRemove}
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
                      <div className={styles.flowAddSwitch}>
                        <select
                          className={styles.flowAddSwitchSelect}
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
                    {stageIdx < editingFlowData.stages.length - 1 && editingFlowData.scheduling[stageIdx] && (
                      <div className={styles.flowSchedulingCard}>
                        <div className={styles.flowSchedulingIcon}>⏱️</div>
                        <div className={styles.flowSchedulingContent}>
                          <select
                            value={editingFlowData.scheduling[stageIdx].type}
                            onChange={(e) => handleUpdateScheduling(stageIdx, { 
                              type: e.target.value as SchedulingType,
                              delayMs: e.target.value === 'delay' ? 1000 : undefined,
                            })}
                            className={styles.flowSchedulingTypeSelect}
                          >
                            <option value="delay">⏱️ Fixed delay</option>
                            <option value="waitForCurtains">🔄 Wait until done</option>
                          </select>
                          
                          {editingFlowData.scheduling[stageIdx].type === 'delay' && (
                            <div className={styles.flowSchedulingDelay}>
                              <input
                                type="number"
                                min="0"
                                max="300000"
                                step="100"
                                value={editingFlowData.scheduling[stageIdx].delayMs || 0}
                                onChange={(e) => handleUpdateScheduling(stageIdx, { 
                                  delayMs: parseInt(e.target.value, 10) || 0 
                                })}
                                className={styles.flowSchedulingInput}
                              />
                              <span className={styles.flowSchedulingUnit}>ms</span>
                              <div className={styles.flowSchedulingPresets}>
                                {[500, 1000, 2000, 5000].map(ms => (
                                  <button
                                    key={ms}
                                    type="button"
                                    className={`${styles.flowSchedulingPreset} ${editingFlowData.scheduling[stageIdx].delayMs === ms ? styles.flowSchedulingPresetActive : ''}`}
                                    onClick={() => handleUpdateScheduling(stageIdx, { delayMs: ms })}
                                  >
                                    {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {editingFlowData.scheduling[stageIdx].type === 'waitForCurtains' && (
                            <div className={styles.flowSchedulingInfo}>
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
                  className={styles.flowAddStage}
                  onClick={handleAddStage}
                >
                  <span className={styles.flowAddStageIcon}>➕</span>
                  <span className={styles.flowAddStageText}>Add Stage</span>
                </button>
              </div>
            </div>
            
            {/* Footer */}
            <div className={styles.flowBuilderFooter}>
              <button
                type="button"
                className={styles.flowBuilderCancel}
                onClick={handleCancelEditFlow}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.flowBuilderSave}
                onClick={handleSaveEditFlow}
                disabled={editingFlowData.stages.length === 0 || editingFlowData.stages.every(s => s.actions.length === 0)}
              >
                💾 Save Flow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
