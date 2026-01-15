'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import styles from './smart-home-control.module.css';
import type { LivePanelState } from '@/lib/discovery/types';
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
}

export interface FavoritesData {
  groups: Record<string, FavoriteSwitch[]>;
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

/** Represents an active device from any discovered panel */
export interface ActiveDevice {
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
  discoveryCompleted: boolean;
  isLoading: boolean;
  onSwitchToSetup: (openFavoritesFullscreen?: boolean) => void;
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
    const groups = groupsData as Record<string, unknown[]>;
    const migratedGroups: Record<string, FavoriteSwitch[]> = {};
    for (const [groupName, switches] of Object.entries(groups)) {
      migratedGroups[groupName] = (switches || []).map((sw: unknown) => {
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
    const groups = groupsData as Record<string, unknown[]>;
    const migratedGroups: Record<string, SmartAction[]> = {};
    for (const [groupName, actionsArr] of Object.entries(groups)) {
      migratedGroups[groupName] = (actionsArr || []).map((actionItem: unknown) => {
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
    return { groups: migratedGroups };
  }
  return { groups: {} };
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
  discoveryCompleted,
  isLoading,
  onSwitchToSetup,
}: SmartHomeControlProps) {
  // State
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
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
    if (!profile) return { groups: {} };
    return parseFavorites(profile.favorites);
  }, [profile]);

  const smartSwitchesData = useMemo(() => {
    if (!profile) return { groups: {} };
    return parseSmartSwitches(profile.smart_switches);
  }, [profile]);

  // Get all groups
  const allGroups = useMemo(() => {
    const favoriteGroups = new Set(Object.keys(favoritesData.groups || {}));
    const smartGroups = new Set(Object.keys(smartSwitchesData.groups || {}));
    return [...new Set([...favoriteGroups, ...smartGroups])];
  }, [favoritesData.groups, smartSwitchesData.groups]);

  // Reset activeGroup when profile changes, then set first group as active
  const profileIdRef = useRef<number | null>(null);
  
  useEffect(() => {
    // If profile changed, reset activeGroup
    if (profile?.id !== profileIdRef.current) {
      profileIdRef.current = profile?.id ?? null;
      setActiveGroup(null);
    }
  }, [profile?.id]);
  
  // Set first group as active when data loads or profile changes
  useEffect(() => {
    if (allGroups.length > 0 && !activeGroup) {
      setActiveGroup(allGroups[0]);
    }
  }, [allGroups, activeGroup]);

  const effectiveActiveGroup = activeGroup ?? (allGroups.length > 0 ? allGroups[0] : null);

  // Get current group data
  const currentGroupSwitches = effectiveActiveGroup 
    ? (favoritesData.groups || {})[effectiveActiveGroup] ?? []
    : [];
  
  const currentGroupActions = effectiveActiveGroup 
    ? (smartSwitchesData.groups || {})[effectiveActiveGroup] ?? []
    : [];

  // Compute all active relays (lights) from ALL discovered panels (not just favorites)
  // Only include direct devices, ignore linked devices (those with "-Link" in name)
  const activeDevices = useMemo((): ActiveDevice[] => {
    const devices: ActiveDevice[] = [];
    
    for (const [ip, panelState] of livePanelStates.entries()) {
      if (!panelState.fullState) continue;
      
      const panelName = panelState.fullState.mqttDeviceName || 
                        panelState.fullState.hostname || 
                        ip;
      
      // Check relays that are ON (excluding linked devices)
      for (const relay of panelState.fullState.relays) {
        if (relay.state === true) {
          const relayName = relay.name || `Relay ${relay.index + 1}`;
          // Skip linked devices (contain "-Link" in name)
          if (relayName.includes('-Link')) continue;
          
          devices.push({
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
    return devices.sort((a, b) => {
      if (a.panelName !== b.panelName) return a.panelName.localeCompare(b.panelName);
      return a.name.localeCompare(b.name);
    });
  }, [livePanelStates]);

  // Collapse state for Active Devices section - starts collapsed
  const [isActiveDevicesExpanded, setIsActiveDevicesExpanded] = useState(false);

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

  // Turn off an active device (relay)
  const handleTurnOffActiveDevice = useCallback(async (device: ActiveDevice) => {
    console.log('[SmartHomeControl] Turning off active device:', device.name, device.panelIp);
    triggerHaptic('medium');
    
    const result = await sendPanelCommand(device.panelIp, 'set_relay', { 
      index: device.index, 
      state: false 
    });
    console.log('[SmartHomeControl] Turn off relay result:', result);
  }, [triggerHaptic]);

  // Turn off all active devices
  const handleTurnOffAllActive = useCallback(async () => {
    if (activeDevices.length === 0) return;
    
    console.log('[SmartHomeControl] Turning off all active devices:', activeDevices.length);
    triggerHaptic('heavy');
    
    // Turn off all in parallel
    await Promise.all(activeDevices.map(device => handleTurnOffActiveDevice(device)));
  }, [activeDevices, handleTurnOffActiveDevice, triggerHaptic]);

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
            <p className={styles.loadingSubtext}>Connecting to devices</p>
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
            Set up your profile, zones, and devices to get started
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

  if (allGroups.length === 0) {
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
            Create zones like &ldquo;Living Room&rdquo; or &ldquo;Bedroom&rdquo; to organize your devices
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
          {allGroups.map((group) => (
            <button
              key={group}
              className={`${styles.zoneTab} ${effectiveActiveGroup === group ? styles.zoneTabActive : ''}`}
              onClick={() => {
                triggerHaptic('light');
                setActiveGroup(group);
              }}
            >
              {group}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className={styles.content}>
        {/* Quick Actions */}
        {currentGroupActions.length > 0 && (
          <section className={styles.actionsSection}>
            <h3 className={styles.sectionTitle}>
              <ZapIcon className={styles.sectionIcon} />
              Quick Actions
            </h3>
            <div className={styles.cardsGrid}>
              {currentGroupActions.map((action, idx) => {
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
        {currentGroupSwitches.length > 0 && (
          <section className={styles.switchesSection}>
            <h3 className={styles.sectionTitle}>
              <LightBulbIcon on={false} className={styles.sectionIcon} />
              Devices
            </h3>
            <div className={styles.cardsGrid}>
              {currentGroupSwitches.map((sw, idx) => {
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
                        <span className={styles.cardName}>{sw.alias}</span>
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
                        <span className={styles.cardName}>{sw.alias}</span>
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
          </section>
        )}

        {/* Empty zone state */}
        {currentGroupSwitches.length === 0 && currentGroupActions.length === 0 && (
          <div className={styles.emptyZone}>
            <div className={styles.emptyZoneIcon}>📦</div>
            <p className={styles.emptyZoneText}>This zone is empty</p>
            <p className={styles.emptyZoneHint}>Tap &ldquo;Modify&rdquo; above to add devices</p>
          </div>
        )}

        {/* Active Devices Section - Shows ALL active devices across all discovered panels */}
        {activeDevices.length > 0 && (
          <section className={styles.activeDevicesSection}>
            <div 
              className={styles.activeDevicesHeader}
              onClick={() => setIsActiveDevicesExpanded(!isActiveDevicesExpanded)}
            >
              <div className={styles.activeDevicesHeaderLeft}>
                <span className={`${styles.activeDevicesToggle} ${isActiveDevicesExpanded ? styles.activeDevicesToggleExpanded : ''}`}>
                  ▶
                </span>
                <h3 className={styles.activeDevicesSectionTitle}>
                  <PowerIcon className={styles.sectionIcon} />
                  Active Devices
                  <span className={styles.activeDevicesCount}>{activeDevices.length}</span>
                </h3>
              </div>
              <button
                className={styles.turnOffAllButton}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTurnOffAllActive();
                }}
                title="Turn off all active devices"
              >
                <PowerIcon className={styles.turnOffAllIcon} />
                <span>All Off</span>
              </button>
            </div>
            
            {isActiveDevicesExpanded && (
              <div className={styles.activeDevicesList}>
                {activeDevices.map((device, idx) => (
                  <button 
                    key={`${device.panelIp}-${device.type}-${device.index}-${idx}`}
                    className={styles.activeDeviceItem}
                    onClick={() => handleTurnOffActiveDevice(device)}
                    title="Click to turn off"
                  >
                    <span className={styles.activeDeviceIcon}>💡</span>
                    <div className={styles.activeDeviceDetails}>
                      <span className={styles.activeDeviceName}>{device.name}</span>
                      <span className={styles.activeDevicePanel}>{device.panelName}</span>
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
