'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import styles from './smart-home-control.module.css';
import type { LivePanelState, DiscoveryResult } from '@/lib/discovery/types';
import { getRelayDeviceType, getCurtainDeviceType } from '@/lib/discovery/types';
import { ALL_ZONE_NAME } from '@/lib/constants';
import type {
  SmartAction,
  ActionStage,
  SmartSwitchesData,
  StartActionResponse,
} from '@/lib/types/smart-actions';

// =============================================================================
// Types
// =============================================================================

export type FavoriteType = 'light' | 'shade' | 'venetian';

export interface FavoriteSwitch {
  ip: string;
  index: number;
  type: FavoriteType;
  originalName: string;
  alias: string;
  panelName?: string; // Panel name for display context
}

export interface FavoritesData {
  zones: Record<string, FavoriteSwitch[]>;
}

export interface ProfileData {
  id: number;
  name: string;
  favorites: FavoritesData | Record<string, unknown>;
  smart_switches?: SmartSwitchesData | Record<string, unknown>;
}

export interface ActionExecutionProgress {
  executionId?: string;
  state: 'idle' | 'running' | 'waiting' | 'paused' | 'stopped' | 'completed' | 'failed';
  totalStages?: number;
  currentStage: number;
  isWaiting: boolean;
  waitType?: 'delay' | 'curtains';
  remainingDelayMs?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

/** Represents an active switch from any discovered panel */
export interface ActiveSwitch {
  panelIp: string;
  panelName: string;
  type: 'relay' | 'curtain';
  index: number;
  name: string;
  isOn?: boolean;          // For relays
  curtainState?: string;   // For curtains
}

interface SmartHomeControlProps {
  profile: ProfileData | null;
  livePanelStates: Map<string, LivePanelState>;
  discoveredPanelIps: Set<string>;
  discoveryResults: DiscoveryResult[];
  discoveryCompleted: boolean;
  isLoading: boolean;
  onSwitchToSetup: (openFavoritesFullscreen?: boolean) => void;
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
    const zones = zonesData as Record<string, unknown[]>;
    const migratedZones: Record<string, FavoriteSwitch[]> = {};
    for (const [zoneName, switches] of Object.entries(zones)) {
      migratedZones[zoneName] = (switches || []).map((sw: unknown) => {
        const swObj = sw as Record<string, unknown>;
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
    const zones = zonesData as Record<string, unknown[]>;
    const migratedZones: Record<string, SmartAction[]> = {};
    for (const [zoneName, actionsArr] of Object.entries(zones)) {
      migratedZones[zoneName] = (actionsArr || []).map((actionItem: unknown) => {
        const actionObj = actionItem as Record<string, unknown>;
        if (Array.isArray(actionObj.stages)) {
          return {
            name: actionObj.name as string,
            stages: actionObj.stages as ActionStage[],
            scheduling: (actionObj.scheduling as unknown[]) || [],
          } as SmartAction;
        }
        return {
          name: actionObj.name as string,
          stages: [],
          scheduling: [],
        } as SmartAction;
      });
    }
    return { zones: migratedZones };
  }
  return { zones: {} };
}

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
    console.error('[SmartHomeControl] Command error:', err);
    return false;
  }
}

// =============================================================================
// Icons (inline SVGs for best performance)
// =============================================================================

const LightBulbIcon = ({ on, className }: { on: boolean; className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {on ? (
      <>
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14" fill="currentColor" />
      </>
    ) : (
      <>
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14" />
      </>
    )}
  </svg>
);

const ShadeIcon = ({ state, className }: { state?: string; className?: string }) => {
  const isOpen = state === 'opening' || state === 'open';
  const isClosed = state === 'closing' || state === 'closed';
  
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      className={className}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Window frame */}
      <rect x="3" y="2" width="18" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Shade roller */}
      <rect x="4" y="3" width="16" height="2" rx="1" fill="currentColor" opacity="0.8" />
      {/* Shade fabric */}
      {isClosed ? (
        <>
          <rect x="4" y="5" width="16" height="15" fill="currentColor" opacity="0.3" />
          {/* Slats */}
          <line x1="4" y1="8" x2="20" y2="8" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
          <line x1="4" y1="11" x2="20" y2="11" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
          <line x1="4" y1="14" x2="20" y2="14" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
          <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
        </>
      ) : isOpen ? (
        <rect x="4" y="5" width="16" height="3" fill="currentColor" opacity="0.3" />
      ) : (
        <rect x="4" y="5" width="16" height="9" fill="currentColor" opacity="0.3" />
      )}
      {/* Pull cord */}
      <circle cx="18" cy="20" r="1" fill="currentColor" opacity="0.6" />
      <line x1="18" y1="19" x2="18" y2="8" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
};

const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

const StopIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const ChevronUpIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={className}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const SettingsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ZapIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const PowerIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

const EditIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// =============================================================================
// Main Component
// =============================================================================

export default function SmartHomeControl({
  profile,
  livePanelStates,
  discoveredPanelIps,
  discoveryResults,
  discoveryCompleted,
  isLoading,
  onSwitchToSetup,
}: SmartHomeControlProps) {
  // State
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [switchSearch, setSwitchSearch] = useState('');
  const [executingActionName, setExecutingActionName] = useState<string | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ActionExecutionProgress>({
    state: 'idle',
    currentStage: -1,
    isWaiting: false,
  });
  const executionEventSourceRef = useRef<EventSource | null>(null);
  const currentExecutionIdRef = useRef<string | null>(null);
  
  // Haptic feedback for mobile
  const triggerHaptic = useCallback((type: 'light' | 'medium' | 'heavy' = 'light') => {
    if ('vibrate' in navigator) {
      const patterns = { light: [10], medium: [20], heavy: [30] };
      navigator.vibrate(patterns[type]);
    }
  }, []);

  // Parse data
  const favoritesData = useMemo(() => {
    if (!profile) return { zones: {} };
    return parseFavorites(profile.favorites);
  }, [profile]);

  const smartSwitchesData = useMemo(() => {
    if (!profile) return { zones: {} };
    return parseSmartSwitches(profile.smart_switches);
  }, [profile]);

  // Get user-defined zones (excluding the special "All" zone)
  const userDefinedZones = useMemo(() => {
    const favoriteZones = new Set(Object.keys(favoritesData.zones || {}));
    const smartZones = new Set(Object.keys(smartSwitchesData.zones || {}));
    return [...new Set([...favoriteZones, ...smartZones])].filter(z => z !== ALL_ZONE_NAME);
  }, [favoritesData.zones, smartSwitchesData.zones]);

  // All zones including the special "All" zone at the beginning
  const allZones = useMemo(() => {
    return [ALL_ZONE_NAME, ...userDefinedZones];
  }, [userDefinedZones]);

  // Reset activeZone when profile changes, then set first zone as active
  const profileIdRef = useRef<number | null>(null);
  
  useEffect(() => {
    // If profile changed, reset activeZone
    if (profile?.id !== profileIdRef.current) {
      profileIdRef.current = profile?.id ?? null;
      setActiveZone(null);
    }
  }, [profile?.id]);
  
  // Set first user-defined zone as active when data loads or profile changes
  // If there are user-defined zones, prefer them over "All" as the default
  useEffect(() => {
    if (allZones.length > 0 && !activeZone) {
      // Prefer first user-defined zone (index 1) if available, otherwise "All" (index 0)
      const defaultZone = userDefinedZones.length > 0 ? userDefinedZones[0] : allZones[0];
      setActiveZone(defaultZone);
    }
  }, [allZones, userDefinedZones, activeZone]);

  // Default to first user-defined zone if available
  const effectiveActiveZone = activeZone ?? (userDefinedZones.length > 0 ? userDefinedZones[0] : (allZones.length > 0 ? allZones[0] : null));

  // Check if current zone is the special "All" zone
  const isAllZone = effectiveActiveZone === ALL_ZONE_NAME;

  // Create a lookup map from IP to panel name from discovery results
  const panelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of discoveryResults) {
      if (result.status === 'panel' && result.name) {
        map.set(result.ip, result.name);
      }
    }
    return map;
  }, [discoveryResults]);

  // Helper to get panel name from IP (uses discovery results first, then live state as fallback)
  const getPanelName = useCallback((ip: string): string => {
    // First check discovery results (which have the actual panel name)
    const discoveredName = panelNameMap.get(ip);
    if (discoveredName) return discoveredName;
    
    // Fallback to live state
    const panelState = livePanelStates.get(ip);
    if (!panelState?.fullState) return ip;
    return panelState.fullState.mqttDeviceName || 
           panelState.fullState.hostname || 
           ip;
  }, [panelNameMap, livePanelStates]);

  // Get current zone data
  // For the "All" zone, generate FavoriteSwitch[] from all discovered panels
  const currentZoneSwitches = useMemo((): FavoriteSwitch[] => {
    if (!effectiveActiveZone) return [];
    
    // For the "All" zone, generate switches from all discovered panels
    if (effectiveActiveZone === ALL_ZONE_NAME) {
      const allSwitches: FavoriteSwitch[] = [];
      
      for (const [ip, panelState] of livePanelStates.entries()) {
        if (!panelState.fullState) continue;
        
        // Get panel name from discovery results (actual name) or fallback to live state
        const panelName = getPanelName(ip);
        
        const relays = panelState.fullState.relays || [];
        const curtains = panelState.fullState.curtains || [];
        
        // Add relays (lights) - only direct switches, not hidden or linked
        // Note: We pass undefined for relayPairs since it's not available in LivePanelState
        // The function will use legacy name-based detection which works well enough
        for (const relay of relays) {
          const deviceType = getRelayDeviceType(relay.index, relay.name, undefined);
          // Only show 'light' type relays (direct switches with proper names)
          // Filter out any relay with "Link" suffix (linked relays)
          const isLinkedRelay = relay.name && /[-_\s]?link$/i.test(relay.name.trim().toLowerCase());
          if (deviceType === 'light' && relay.name && !isLinkedRelay) {
            allSwitches.push({
              ip,
              index: relay.index,
              type: 'light',
              originalName: relay.name || `Light ${relay.index + 1}`,
              alias: relay.name || `Light ${relay.index + 1}`,
              panelName,
            });
          }
        }
        
        // Add curtains (shades/venetians) - only direct, not linked
        for (const curtain of curtains) {
          const deviceType = getCurtainDeviceType(curtain.index, curtain.name, undefined);
          // Filter out any curtain with "Link" suffix (linked switches)
          const isLinkedCurtain = curtain.name && /[-_\s]?link$/i.test(curtain.name.trim());
          if ((deviceType === 'curtain' || deviceType === 'venetian') && curtain.name && !isLinkedCurtain) {
            allSwitches.push({
              ip,
              index: curtain.index,
              type: deviceType === 'venetian' ? 'venetian' : 'shade',
              originalName: curtain.name || `Shade ${curtain.index + 1}`,
              alias: curtain.name || `Shade ${curtain.index + 1}`,
              panelName,
            });
          }
        }
      }
      
      // Sort by IP address, then by index
      allSwitches.sort((a, b) => {
        const ipCompare = a.ip.localeCompare(b.ip, undefined, { numeric: true });
        if (ipCompare !== 0) return ipCompare;
        return a.index - b.index;
      });
      
      return allSwitches;
    }
    
    // For regular zones, enrich with panel names from live state
    const zoneSwitches = (favoritesData.zones || {})[effectiveActiveZone] ?? [];
    return zoneSwitches.map(sw => ({
      ...sw,
      panelName: sw.panelName || getPanelName(sw.ip),
    }));
  }, [effectiveActiveZone, livePanelStates, favoritesData.zones, getPanelName]);
  
  // Filter switches by search term (smart multi-term search)
  // Each space-separated term must match somewhere in alias, originalName, or panelName
  const filteredZoneSwitches = useMemo(() => {
    if (!switchSearch.trim()) return currentZoneSwitches;
    
    // Split search into individual terms and filter empty ones
    const searchTerms = switchSearch.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
    if (searchTerms.length === 0) return currentZoneSwitches;
    
    return currentZoneSwitches.filter(sw => {
      // Build searchable text combining all fields
      const searchableText = [
        sw.alias,
        sw.originalName,
        sw.panelName || '',
      ].join(' ').toLowerCase();
      
      // All terms must match somewhere in the combined text
      return searchTerms.every(term => searchableText.includes(term));
    });
  }, [currentZoneSwitches, switchSearch]);
  
  // The "All" zone doesn't have actions (only switches)
  const currentZoneActions = useMemo(() => {
    if (effectiveActiveZone === ALL_ZONE_NAME) return [];
    return effectiveActiveZone 
      ? (smartSwitchesData.zones || {})[effectiveActiveZone] ?? []
      : [];
  }, [effectiveActiveZone, smartSwitchesData.zones]);

  // Compute all active relays (lights) from ALL discovered panels (not just favorites)
  // Only include direct switches, ignore linked switches (those with "-Link" in name)
  const activeSwitches = useMemo((): ActiveSwitch[] => {
    const switches: ActiveSwitch[] = [];
    
    for (const [ip, panelState] of livePanelStates.entries()) {
      if (!panelState.fullState) continue;
      
      // Get panel name from discovery results (actual name) or fallback to live state
      const panelName = getPanelName(ip);
      
      // Check relays that are ON (excluding linked switches)
      for (const relay of panelState.fullState.relays) {
        if (relay.state === true) {
          const relayName = relay.name || `Relay ${relay.index + 1}`;
          // Skip linked switches (contain "-Link" in name)
          if (relayName.includes('-Link')) continue;
          
          switches.push({
            panelIp: ip,
            panelName,
            type: 'relay',
            index: relay.index,
            name: relayName,
            isOn: true,
          });
        }
      }
    }
    
    // Sort by panel name, then by name
    return switches.sort((a, b) => {
      if (a.panelName !== b.panelName) return a.panelName.localeCompare(b.panelName);
      return a.name.localeCompare(b.name);
    });
  }, [livePanelStates, getPanelName]);

  // Collapse state for Active Switches section - starts collapsed
  const [isActiveSwitchesExpanded, setIsActiveSwitchesExpanded] = useState(false);

  // Get switch state
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

  // Check if switch is reachable
  const isSwitchReachable = useCallback((sw: FavoriteSwitch): boolean => {
    if (!discoveryCompleted) return true; // Assume reachable until discovery completes
    if (!discoveredPanelIps.has(sw.ip)) return false;
    const state = livePanelStates.get(sw.ip);
    return !state || state.connectionStatus === 'connected' || state.connectionStatus === 'connecting';
  }, [discoveredPanelIps, livePanelStates, discoveryCompleted]);

  // Handlers
  const handleLightToggle = useCallback(async (sw: FavoriteSwitch) => {
    console.log('[SmartHomeControl] Light toggle clicked:', sw.alias, sw.ip, sw.index);
    if (sw.type !== 'light') {
      console.log('[SmartHomeControl] Not a light, ignoring');
      return;
    }
    triggerHaptic('medium');
    const result = await sendPanelCommand(sw.ip, 'toggle_relay', { index: sw.index });
    console.log('[SmartHomeControl] Toggle result:', result);
  }, [triggerHaptic]);

  const handleShadeAction = useCallback(async (sw: FavoriteSwitch, action: 'open' | 'close' | 'stop') => {
    console.log('[SmartHomeControl] Shade action clicked:', sw.alias, action, sw.ip, sw.index);
    if (sw.type !== 'shade' && sw.type !== 'venetian') {
      console.log('[SmartHomeControl] Not a shade/venetian, ignoring');
      return;
    }
    triggerHaptic('light');
    const result = await sendPanelCommand(sw.ip, 'curtain', { index: sw.index, action });
    console.log('[SmartHomeControl] Shade action result:', result);
  }, [triggerHaptic]);

  // Turn off an active switch (relay)
  const handleTurnOffActiveSwitch = useCallback(async (sw: ActiveSwitch) => {
    console.log('[SmartHomeControl] Turning off active switch:', sw.name, sw.panelIp);
    triggerHaptic('medium');
    
    const result = await sendPanelCommand(sw.panelIp, 'set_relay', { 
      index: sw.index, 
      state: false 
    });
    console.log('[SmartHomeControl] Turn off relay result:', result);
  }, [triggerHaptic]);

  // Turn off all active switches
  const handleTurnOffAllActive = useCallback(async () => {
    if (activeSwitches.length === 0) return;
    
    console.log('[SmartHomeControl] Turning off all active switches:', activeSwitches.length);
    triggerHaptic('heavy');
    
    // Turn off all in parallel
    await Promise.all(activeSwitches.map(sw => handleTurnOffActiveSwitch(sw)));
  }, [activeSwitches, handleTurnOffActiveSwitch, triggerHaptic]);

  // Action execution
  const handleRunAction = useCallback(async (action: SmartAction) => {
    if (executingActionName) return; // Already running
    
    triggerHaptic('heavy');
    setExecutingActionName(action.name);
    setExecutionProgress({
      state: 'running',
      currentStage: 0,
      isWaiting: false,
      totalStages: action.stages.length,
    });

    try {
      const res = await fetch('/api/actions/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        throw new Error('Failed to start action');
      }

      const data: StartActionResponse = await res.json();
      
      if (!data.success || !data.executionId) {
        throw new Error(data.error || 'Failed to start action');
      }

      currentExecutionIdRef.current = data.executionId;

      // Connect to SSE for progress updates
      const eventSource = new EventSource(`/api/actions/${data.executionId}`);
      executionEventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const progress = JSON.parse(event.data);
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

          if (['completed', 'failed', 'stopped'].includes(progress.state)) {
            eventSource.close();
            executionEventSourceRef.current = null;
            currentExecutionIdRef.current = null;
            
            setTimeout(() => {
              setExecutingActionName(null);
              setExecutionProgress({ state: 'idle', currentStage: -1, isWaiting: false });
            }, 1500);
          }
        } catch (err) {
          console.error('[SmartHomeControl] SSE parse error:', err);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        executionEventSourceRef.current = null;
        setExecutingActionName(null);
        setExecutionProgress({ state: 'idle', currentStage: -1, isWaiting: false });
      };
    } catch (err) {
      console.error('[SmartHomeControl] Action error:', err);
      setExecutingActionName(null);
      setExecutionProgress({ state: 'idle', currentStage: -1, isWaiting: false });
    }
  }, [executingActionName, triggerHaptic]);

  const handleStopAction = useCallback(async () => {
    if (!currentExecutionIdRef.current) return;
    
    triggerHaptic('medium');
    
    try {
      await fetch(`/api/actions/${currentExecutionIdRef.current}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('[SmartHomeControl] Stop action error:', err);
    }
  }, [triggerHaptic]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (executionEventSourceRef.current) {
        executionEventSourceRef.current.close();
      }
    };
  }, []);

  // Loading state - show when loading profile or during discovery
  if (isLoading) {
    const panelCount = discoveredPanelIps.size;
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} />
          <p className={styles.loadingText}>
            {panelCount === 0 
              ? 'Discovering panels...' 
              : `Found ${panelCount} panel${panelCount !== 1 ? 's' : ''}...`}
          </p>
          {panelCount > 0 && (
            <p className={styles.loadingSubtext}>Connecting to switches</p>
          )}
        </div>
      </div>
    );
  }

  // Empty state - only show after loading completes and there's no profile
  if (!profile) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>🏠</div>
          <h2 className={styles.emptyStateTitle}>Welcome to Your Smart Home</h2>
          <p className={styles.emptyStateText}>
            Set up your profile, zones, and switches to get started
          </p>
          <button 
            className={styles.setupButton}
            onClick={() => onSwitchToSetup()}
          >
            <SettingsIcon className={styles.setupButtonIcon} />
            <span>Open Setup</span>
          </button>
        </div>
      </div>
    );
  }

  if (allZones.length === 0) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <span className={styles.profileBadge}>{profile.name}</span>
            <button 
              className={styles.settingsButton}
              onClick={() => onSwitchToSetup()}
              aria-label="Open setup"
            >
              <SettingsIcon className={styles.settingsIcon} />
            </button>
          </div>
        </header>
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>📍</div>
          <h2 className={styles.emptyStateTitle}>No Zones Yet</h2>
          <p className={styles.emptyStateText}>
            Create zones like &ldquo;Living Room&rdquo; or &ldquo;Bedroom&rdquo; to organize your switches
          </p>
          <button 
            className={styles.setupButton}
            onClick={() => onSwitchToSetup()}
          >
            <SettingsIcon className={styles.setupButtonIcon} />
            <span>Add Zones</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <span className={styles.profileBadge}>{profile.name}</span>
          <div className={styles.headerActions}>
            <button 
              className={styles.modifyZoneHeaderButton}
              onClick={() => {
                triggerHaptic('light');
                onSwitchToSetup(true); // Open favorites fullscreen
              }}
              aria-label="Modify zones"
            >
              <EditIcon className={styles.modifyZoneHeaderIcon} />
              <span>Modify</span>
            </button>
            <button 
              className={styles.settingsButton}
              onClick={() => onSwitchToSetup(false)}
              aria-label="Open setup"
            >
              <SettingsIcon className={styles.settingsIcon} />
            </button>
          </div>
        </div>
      </header>

      {/* Zone Tabs */}
      <nav className={styles.zoneTabs}>
        <div className={styles.zoneTabsScroll}>
          {allZones.map((zone) => {
            const isAllZoneTab = zone === ALL_ZONE_NAME;
            return (
              <button
                key={zone}
                className={`${styles.zoneTab} ${effectiveActiveZone === zone ? styles.zoneTabActive : ''} ${isAllZoneTab ? styles.zoneTabSystem : ''}`}
                onClick={() => {
                  triggerHaptic('light');
                  setActiveZone(zone);
                }}
              >
                {isAllZoneTab && <span className={styles.zoneTabSystemIcon}>⭐</span>}
                {zone}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content */}
      <main className={styles.content}>
        {/* Quick Actions */}
        {currentZoneActions.length > 0 && (
          <section className={styles.actionsSection}>
            <h3 className={styles.sectionTitle}>
              <ZapIcon className={styles.sectionIcon} />
              Quick Actions
            </h3>
            <div className={styles.cardsGrid}>
              {currentZoneActions.map((action, idx) => {
                const isExecuting = executingActionName === action.name;
                const progress = isExecuting ? executionProgress : null;
                const stageCount = action.stages?.length || 0;
                const isCompleted = progress?.state === 'completed';
                const isStopped = progress?.state === 'stopped';
                
                return (
                  <button
                    key={`${action.name}-${idx}`}
                    className={`${styles.card} ${styles.actionCard} ${isExecuting ? styles.actionCardExecuting : ''} ${isCompleted ? styles.actionCardCompleted : ''} ${isStopped ? styles.actionCardStopped : ''}`}
                    onClick={() => isExecuting ? handleStopAction() : handleRunAction(action)}
                    disabled={executingActionName !== null && !isExecuting}
                  >
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>
                        {isExecuting ? '⏳' : isCompleted ? '✅' : isStopped ? '⏹️' : '⚡'}
                      </span>
                      <span className={styles.cardName}>{action.name}</span>
                    </div>
                    
                    {/* Progress when executing */}
                    {isExecuting && progress && (
                      <div className={styles.actionProgressSection}>
                        <div className={styles.actionProgressBar}>
                          <div 
                            className={styles.actionProgressFill}
                            style={{ 
                              width: `${((progress.currentStage + 1) / (progress.totalStages || 1)) * 100}%` 
                            }}
                          />
                        </div>
                        <span className={styles.actionProgressText}>
                          Stage {progress.currentStage + 1}/{progress.totalStages || stageCount}
                          {progress.isWaiting && progress.remainingDelayMs !== undefined && (
                            <span className={styles.actionWaiting}> ⏱️ {(progress.remainingDelayMs / 1000).toFixed(1)}s</span>
                          )}
                          {progress.isWaiting && progress.waitType === 'curtains' && (
                            <span className={styles.actionWaiting}> 🔄 Moving...</span>
                          )}
                        </span>
                      </div>
                    )}
                    
                    {/* Meta info when not executing */}
                    {!isExecuting && (
                      <div className={styles.cardMeta}>
                        <span>{stageCount} stage{stageCount !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    
                    {/* Action button */}
                    <div className={styles.actionButton}>
                      {isExecuting ? (
                        <>
                          <StopIcon className={styles.actionButtonIcon} />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <PlayIcon className={styles.actionButtonIcon} />
                          <span>Run</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Switches */}
        {(currentZoneSwitches.length > 0 || switchSearch.trim()) && (
          <section className={styles.switchesSection}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <LightBulbIcon on={false} className={styles.sectionIcon} />
                Switches
                {currentZoneSwitches.length > 0 && (
                  <span className={styles.sectionCount}>{filteredZoneSwitches.length}/{currentZoneSwitches.length}</span>
                )}
              </h3>
              <div className={styles.switchSearchWrapper}>
                <input
                  type="text"
                  value={switchSearch}
                  onChange={(e) => setSwitchSearch(e.target.value)}
                  placeholder="Search..."
                  className={styles.switchSearchInput}
                />
                {switchSearch && (
                  <button
                    type="button"
                    className={styles.switchSearchClear}
                    onClick={() => setSwitchSearch('')}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            {filteredZoneSwitches.length === 0 ? (
              <div className={styles.noSearchResults}>
                <p>No switches matching &ldquo;{switchSearch}&rdquo;</p>
              </div>
            ) : (
            <div className={styles.cardsGrid}>
              {filteredZoneSwitches.map((sw, idx) => {
                const state = getSwitchState(sw);
                const isReachable = isSwitchReachable(sw);
                
                if (sw.type === 'light') {
                  const isOn = state.isOn === true;
                  return (
                    <button
                      key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                      className={`${styles.card} ${styles.lightCard} ${isOn ? styles.lightCardOn : ''} ${!isReachable ? styles.cardUnreachable : ''}`}
                      onClick={() => handleLightToggle(sw)}
                      disabled={!isReachable}
                    >
                      <div className={styles.cardHeader}>
                        <span className={styles.cardIcon}>💡</span>
                        <span className={styles.cardName}>
                          {sw.alias}
                          {sw.panelName && <span className={styles.cardPanelName}> ({sw.panelName})</span>}
                        </span>
                      </div>
                      <div className={styles.cardMeta}>
                        <span className={`${styles.statusIndicator} ${isOn ? styles.statusOn : styles.statusOff}`}>
                          {!isReachable ? '⚫ Offline' : isOn ? '🟢 On' : '⚪ Off'}
                        </span>
                      </div>
                      <div className={styles.lightButton}>
                        <LightBulbIcon on={isOn} className={styles.lightButtonIcon} />
                        <span>{isOn ? 'Turn Off' : 'Turn On'}</span>
                      </div>
                    </button>
                  );
                } else {
                  // Shade or Venetian
                  const curtainState = state.curtainState || 'stopped';
                  return (
                    <div 
                      key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                      className={`${styles.card} ${styles.shadeCard} ${!isReachable ? styles.cardUnreachable : ''}`}
                    >
                      <div className={styles.cardHeader}>
                        <span className={styles.cardIcon}>{sw.type === 'venetian' ? '🪟' : '🪞'}</span>
                        <span className={styles.cardName}>
                          {sw.alias}
                          {sw.panelName && <span className={styles.cardPanelName}> ({sw.panelName})</span>}
                        </span>
                      </div>
                      <div className={styles.cardMeta}>
                        <span className={styles.statusIndicator}>
                          {!isReachable ? '⚫ Offline' : 
                            curtainState === 'opening' ? '⬆️ Opening' :
                            curtainState === 'closing' ? '⬇️ Closing' :
                            curtainState === 'open' ? '🔼 Open' :
                            curtainState === 'closed' ? '🔽 Closed' : '⏸️ Stopped'}
                        </span>
                      </div>
                      <div className={styles.shadeControls}>
                        <button
                          className={styles.shadeControlButton}
                          onClick={() => handleShadeAction(sw, 'open')}
                          disabled={!isReachable}
                          aria-label="Open"
                        >
                          <ChevronUpIcon className={styles.shadeControlIcon} />
                          <span>Up</span>
                        </button>
                        <button
                          className={`${styles.shadeControlButton} ${styles.shadeControlStop}`}
                          onClick={() => handleShadeAction(sw, 'stop')}
                          disabled={!isReachable}
                          aria-label="Stop"
                        >
                          <StopIcon className={styles.shadeControlIcon} />
                          <span>Stop</span>
                        </button>
                        <button
                          className={styles.shadeControlButton}
                          onClick={() => handleShadeAction(sw, 'close')}
                          disabled={!isReachable}
                          aria-label="Close"
                        >
                          <ChevronDownIcon className={styles.shadeControlIcon} />
                          <span>Down</span>
                        </button>
                      </div>
                    </div>
                  );
                }
              })}
            </div>
            )}
          </section>
        )}

        {/* Empty zone state */}
        {currentZoneSwitches.length === 0 && currentZoneActions.length === 0 && (
          <div className={styles.emptyZone}>
            <div className={styles.emptyZoneIcon}>{isAllZone ? '🔍' : '📦'}</div>
            <p className={styles.emptyZoneText}>
              {isAllZone ? 'No switches discovered' : 'This zone is empty'}
            </p>
            <p className={styles.emptyZoneHint}>
              {isAllZone 
                ? 'Run discovery to find your panels and switches'
                : 'Tap "Modify" above to add switches'
              }
            </p>
          </div>
        )}

        {/* Active Switches Section - Shows ALL active switches across all discovered panels */}
        {activeSwitches.length > 0 && (
          <section className={styles.activeSwitchesSection}>
            <div 
              className={styles.activeSwitchesHeader}
              onClick={() => setIsActiveSwitchesExpanded(!isActiveSwitchesExpanded)}
            >
              <div className={styles.activeSwitchesHeaderLeft}>
                <span className={`${styles.activeSwitchesToggle} ${isActiveSwitchesExpanded ? styles.activeSwitchesToggleExpanded : ''}`}>
                  ▶
                </span>
                <h3 className={styles.activeSwitchesSectionTitle}>
                  <PowerIcon className={styles.sectionIcon} />
                  Active Switches
                  <span className={styles.activeSwitchesCount}>{activeSwitches.length}</span>
                </h3>
              </div>
              <button
                className={styles.turnOffAllButton}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTurnOffAllActive();
                }}
                title="Turn off all active switches"
              >
                <PowerIcon className={styles.turnOffAllIcon} />
                <span>All Off</span>
              </button>
            </div>
            
            {isActiveSwitchesExpanded && (
              <div className={styles.activeSwitchesList}>
                {activeSwitches.map((sw, idx) => (
                  <button 
                    key={`${sw.panelIp}-${sw.type}-${sw.index}-${idx}`}
                    className={styles.activeSwitchItem}
                    onClick={() => handleTurnOffActiveSwitch(sw)}
                    title="Click to turn off"
                  >
                    <span className={styles.activeSwitchIcon}>💡</span>
                    <div className={styles.activeSwitchDetails}>
                      <span className={styles.activeSwitchName}>{sw.name}</span>
                      <span className={styles.activeSwitchPanel}>{sw.panelName}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Loading overlay */}
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingSpinner} />
          <span>Connecting...</span>
        </div>
      )}
    </div>
  );
}
