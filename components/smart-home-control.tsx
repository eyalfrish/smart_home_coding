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

interface SmartHomeControlProps {
  profile: ProfileData | null;
  livePanelStates: Map<string, LivePanelState>;
  discoveredPanelIps: Set<string>;
  discoveryCompleted: boolean;
  isLoading: boolean;
  onSwitchToSetup: () => void;
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
    className={className}
    style={{ width: '100%', height: '100%' }}
  >
    {on ? (
      <>
        {/* Glow effect */}
        <circle cx="12" cy="9" r="8" fill="url(#lightGlow)" opacity="0.3" />
        {/* Bulb body - filled */}
        <path 
          d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" 
          fill="url(#lightFill)"
        />
        {/* Base */}
        <path d="M9 21v-1h6v1c0 .55-.45 1-1 1h-4c-.55 0-1-.45-1-1z" fill="#78716C" />
        <rect x="9" y="18" width="6" height="2" rx="0.5" fill="#A8A29E" />
        {/* Light rays */}
        <g stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" opacity="0.8">
          <line x1="12" y1="-1" x2="12" y2="-3" />
          <line x1="4" y1="9" x2="2" y2="9" />
          <line x1="22" y1="9" x2="20" y2="9" />
          <line x1="5.6" y1="3.6" x2="4.2" y2="2.2" />
          <line x1="18.4" y1="3.6" x2="19.8" y2="2.2" />
        </g>
        <defs>
          <radialGradient id="lightGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#FCD34D" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lightFill" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#FEF3C7" />
            <stop offset="50%" stopColor="#FCD34D" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
      </>
    ) : (
      <>
        {/* Bulb body - outline only */}
        <path 
          d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" 
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* Base */}
        <path d="M9 21v-1h6v1c0 .55-.45 1-1 1h-4c-.55 0-1-.45-1-1z" fill="currentColor" opacity="0.5" />
        <rect x="9" y="18" width="6" height="2" rx="0.5" fill="currentColor" opacity="0.4" />
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

  // Set first group as active when data loads
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
    if (sw.type !== 'light') return;
    triggerHaptic('medium');
    await sendPanelCommand(sw.ip, 'toggle_relay', { index: sw.index });
  }, [triggerHaptic]);

  const handleShadeAction = useCallback(async (sw: FavoriteSwitch, action: 'open' | 'close' | 'stop') => {
    if (sw.type !== 'shade' && sw.type !== 'venetian') return;
    triggerHaptic('light');
    await sendPanelCommand(sw.ip, 'curtain', { index: sw.index, action });
  }, [triggerHaptic]);

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

  // Empty state
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
            onClick={onSwitchToSetup}
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
              onClick={onSwitchToSetup}
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
            onClick={onSwitchToSetup}
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
          <button 
            className={styles.settingsButton}
            onClick={onSwitchToSetup}
            aria-label="Open setup"
          >
            <SettingsIcon className={styles.settingsIcon} />
          </button>
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
            <div className={styles.actionsGrid}>
              {currentGroupActions.map((action, idx) => {
                const isExecuting = executingActionName === action.name;
                const progress = isExecuting ? executionProgress : null;
                
                return (
                  <button
                    key={`${action.name}-${idx}`}
                    className={`${styles.actionCard} ${isExecuting ? styles.actionCardExecuting : ''}`}
                    onClick={() => isExecuting ? handleStopAction() : handleRunAction(action)}
                    disabled={executingActionName !== null && !isExecuting}
                  >
                    <div className={styles.actionIcon}>
                      {isExecuting ? (
                        <StopIcon className={styles.actionIconSvg} />
                      ) : (
                        <PlayIcon className={styles.actionIconSvg} />
                      )}
                    </div>
                    <span className={styles.actionName}>{action.name}</span>
                    {isExecuting && progress && (
                      <div className={styles.actionProgress}>
                        <div 
                          className={styles.actionProgressBar}
                          style={{ 
                            width: `${((progress.currentStage + 1) / (progress.totalStages || 1)) * 100}%` 
                          }}
                        />
                      </div>
                    )}
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
            <div className={styles.switchesGrid}>
              {currentGroupSwitches.map((sw, idx) => {
                const state = getSwitchState(sw);
                const isReachable = isSwitchReachable(sw);
                
                if (sw.type === 'light') {
                  const isOn = state.isOn === true;
                  return (
                    <button
                      key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                      className={`${styles.lightCard} ${isOn ? styles.lightCardOn : ''} ${!isReachable ? styles.cardUnreachable : ''}`}
                      onClick={() => handleLightToggle(sw)}
                      disabled={!isReachable}
                    >
                      <div className={styles.lightIconWrapper}>
                        <LightBulbIcon on={isOn} className={styles.lightIcon} />
                      </div>
                      <span className={styles.switchName}>{sw.alias}</span>
                      <span className={styles.switchStatus}>
                        {!isReachable ? 'Offline' : isOn ? 'On' : 'Off'}
                      </span>
                    </button>
                  );
                } else {
                  // Shade or Venetian
                  return (
                    <div 
                      key={`${sw.ip}-${sw.type}-${sw.index}-${idx}`}
                      className={`${styles.shadeCard} ${!isReachable ? styles.cardUnreachable : ''}`}
                    >
                      <div className={styles.shadeHeader}>
                        <div className={styles.shadeIconWrapper}>
                          <ShadeIcon state={state.curtainState} className={styles.shadeIcon} />
                        </div>
                        <div className={styles.shadeInfo}>
                          <span className={styles.switchName}>{sw.alias}</span>
                          <span className={styles.switchStatus}>
                            {!isReachable ? 'Offline' : state.curtainState || 'Unknown'}
                          </span>
                        </div>
                      </div>
                      <div className={styles.shadeControls}>
                        <button
                          className={styles.shadeButton}
                          onClick={() => handleShadeAction(sw, 'open')}
                          disabled={!isReachable}
                          aria-label="Open"
                        >
                          <ChevronUpIcon className={styles.shadeButtonIcon} />
                        </button>
                        <button
                          className={`${styles.shadeButton} ${styles.shadeButtonStop}`}
                          onClick={() => handleShadeAction(sw, 'stop')}
                          disabled={!isReachable}
                          aria-label="Stop"
                        >
                          <StopIcon className={styles.shadeButtonIcon} />
                        </button>
                        <button
                          className={styles.shadeButton}
                          onClick={() => handleShadeAction(sw, 'close')}
                          disabled={!isReachable}
                          aria-label="Close"
                        >
                          <ChevronDownIcon className={styles.shadeButtonIcon} />
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
            <p>This zone is empty</p>
            <button 
              className={styles.addDevicesButton}
              onClick={onSwitchToSetup}
            >
              Add devices
            </button>
          </div>
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
