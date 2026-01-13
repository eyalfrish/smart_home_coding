'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import styles from "./page.module.css";
import DiscoveryDashboard from "@/components/discovery-dashboard";
import SmartHomeControl from "@/components/smart-home-control";
import { ThemeToggle } from "@/components/theme-toggle";
import type { LivePanelState } from "@/lib/discovery/types";
import type { FavoritesData, SmartSwitchesData } from "@/components/favorites-section";

// =============================================================================
// Types
// =============================================================================

type AppMode = 'control' | 'setup';

interface FullProfile {
  id: number;
  name: string;
  ip_ranges: string[];
  favorites: FavoritesData | Record<string, unknown>;
  smart_switches: SmartSwitchesData | Record<string, unknown>;
}

interface ProfileSummary {
  id: number;
  name: string;
  created_at: string;
}

// Storage keys
const STORAGE_KEY_MODE = 'cubixx_app_mode';
const STORAGE_KEY_DEFAULT_PROFILE = 'cubixx_default_profile_id';

// =============================================================================
// Helpers
// =============================================================================

function parseIpRangeString(rangeStr: string): { baseIp: string; start: number; end: number } | null {
  const match = rangeStr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})-(\d{1,3})$/);
  if (!match) return null;
  const [, o1, o2, o3, start, end] = match;
  return {
    baseIp: `${o1}.${o2}.${o3}`,
    start: parseInt(start, 10),
    end: parseInt(end, 10),
  };
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function Home() {
  // Mode state
  const [mode, setMode] = useState<AppMode>('control');
  const [hasMounted, setHasMounted] = useState(false);
  
  // Profile state (for control mode)
  const [selectedProfile, setSelectedProfile] = useState<FullProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  
  // Discovery state (for control mode)
  const [discoveredPanelIps, setDiscoveredPanelIps] = useState<Set<string>>(new Set());
  const [livePanelStates, setLivePanelStates] = useState<Map<string, LivePanelState>>(new Map());
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryCompleted, setDiscoveryCompleted] = useState(false);
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  
  // Refs
  const hasAutoDiscoveredRef = useRef(false);
  const panelStreamRef = useRef<EventSource | null>(null);
  const discoverySourcesRef = useRef<EventSource[]>([]);

  // =============================================================================
  // Initialization
  // =============================================================================
  
  useEffect(() => {
    setHasMounted(true);
    
    // Load mode preference
    const storedMode = localStorage.getItem(STORAGE_KEY_MODE) as AppMode | null;
    if (storedMode === 'setup') {
      setMode('setup');
    }
    
    // Initialize server session
    const initSession = async () => {
      try {
        const res = await fetch('/api/session');
        const { sessionId } = await res.json();
        setServerSessionId(sessionId);
        
        // Reset panel registry
        await fetch('/api/panels/reset', { method: 'POST' });
      } catch (err) {
        console.error('[Home] Failed to init session:', err);
      }
    };
    
    initSession();
    
    // Cleanup on unmount
    return () => {
      if (panelStreamRef.current) {
        panelStreamRef.current.close();
      }
      for (const es of discoverySourcesRef.current) {
        es.close();
      }
    };
  }, []);

  // =============================================================================
  // Load default profile (for control mode)
  // =============================================================================
  
  useEffect(() => {
    if (!hasMounted || mode !== 'control') return;
    
    const loadDefaultProfile = async () => {
      setIsLoadingProfile(true);
      
      try {
        // Get default profile ID from localStorage
        const storedDefault = localStorage.getItem(STORAGE_KEY_DEFAULT_PROFILE);
        const defaultId = storedDefault ? parseInt(storedDefault, 10) : null;
        
        if (!defaultId) {
          setIsLoadingProfile(false);
          return;
        }
        
        // Verify profile exists
        const profilesRes = await fetch('/api/profiles');
        const profilesData = await profilesRes.json();
        const profiles = profilesData.profiles as ProfileSummary[];
        
        if (!profiles.some(p => p.id === defaultId)) {
          localStorage.removeItem(STORAGE_KEY_DEFAULT_PROFILE);
          setIsLoadingProfile(false);
          return;
        }
        
        // Load full profile
        const profileRes = await fetch(`/api/profiles/${defaultId}`);
        if (!profileRes.ok) {
          setIsLoadingProfile(false);
          return;
        }
        
        const profileData = await profileRes.json();
        setSelectedProfile(profileData.profile);
      } catch (err) {
        console.error('[Home] Failed to load profile:', err);
      } finally {
        setIsLoadingProfile(false);
      }
    };
    
    loadDefaultProfile();
  }, [hasMounted, mode]);

  // =============================================================================
  // Auto-discovery (for control mode)
  // =============================================================================
  
  useEffect(() => {
    if (!hasMounted || !selectedProfile || isLoadingProfile || mode !== 'control') {
      return;
    }
    
    if (hasAutoDiscoveredRef.current) return;
    
    const ipRanges = selectedProfile.ip_ranges || [];
    if (ipRanges.length === 0) return;
    
    hasAutoDiscoveredRef.current = true;
    
    const startDiscovery = async () => {
      setIsDiscovering(true);
      setDiscoveredPanelIps(new Set());
      setDiscoveryCompleted(false);
      
      // Close existing discovery connections
      for (const es of discoverySourcesRef.current) {
        es.close();
      }
      discoverySourcesRef.current = [];
      
      try {
        const requests = ipRanges
          .map(parseIpRangeString)
          .filter((r): r is NonNullable<typeof r> => r !== null);
        
        if (requests.length === 0) {
          setIsDiscovering(false);
          return;
        }
        
        const foundPanels = new Set<string>();
        let completedStreams = 0;
        
        for (const req of requests) {
          const url = `/api/discover/stream?baseIp=${encodeURIComponent(req.baseIp)}&start=${req.start}&end=${req.end}`;
          const eventSource = new EventSource(url);
          discoverySourcesRef.current.push(eventSource);
          
          eventSource.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              
              if (message.type === 'result' && message.data?.status === 'panel') {
                foundPanels.add(message.data.ip);
                setDiscoveredPanelIps(new Set(foundPanels));
              }
            } catch {
              // Ignore parse errors
            }
          };
          
          const handleComplete = () => {
            eventSource.close();
            completedStreams++;
            if (completedStreams >= requests.length) {
              setIsDiscovering(false);
              setDiscoveryCompleted(true);
            }
          };
          
          eventSource.onerror = handleComplete;
          eventSource.addEventListener('complete', handleComplete);
        }
      } catch (err) {
        console.error('[Home] Discovery error:', err);
        setIsDiscovering(false);
      }
    };
    
    startDiscovery();
  }, [hasMounted, selectedProfile, isLoadingProfile, mode]);

  // =============================================================================
  // Panel streaming (for control mode)
  // =============================================================================
  
  useEffect(() => {
    if (!serverSessionId || discoveredPanelIps.size === 0 || mode !== 'control') {
      return;
    }
    
    // Close existing connection
    if (panelStreamRef.current) {
      panelStreamRef.current.close();
    }
    
    const ipsParam = Array.from(discoveredPanelIps).join(',');
    const url = `/api/panels/stream?ips=${encodeURIComponent(ipsParam)}&sessionId=${serverSessionId}`;
    const eventSource = new EventSource(url);
    panelStreamRef.current = eventSource;
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'state' && data.ip) {
          setLivePanelStates((prev) => {
            const newMap = new Map(prev);
            newMap.set(data.ip, data.state);
            return newMap;
          });
        }
      } catch {
        // Ignore parse errors
      }
    };
    
    return () => {
      eventSource.close();
      panelStreamRef.current = null;
    };
  }, [serverSessionId, discoveredPanelIps, mode]);

  // =============================================================================
  // Mode switching
  // =============================================================================
  
  const handleSwitchToSetup = useCallback(() => {
    setMode('setup');
    localStorage.setItem(STORAGE_KEY_MODE, 'setup');
  }, []);

  const handleSwitchToControl = useCallback(() => {
    setMode('control');
    localStorage.setItem(STORAGE_KEY_MODE, 'control');
    // Reset auto-discovery to trigger re-fetch when switching back
    hasAutoDiscoveredRef.current = false;
  }, []);

  // =============================================================================
  // Render
  // =============================================================================
  
  // SSR/hydration guard
  if (!hasMounted) {
    return (
      <main className={styles.page}>
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
        </div>
      </main>
    );
  }

  // Control mode
  if (mode === 'control') {
    return (
      <SmartHomeControl
        profile={selectedProfile ? {
          id: selectedProfile.id,
          name: selectedProfile.name,
          favorites: selectedProfile.favorites,
          smart_switches: selectedProfile.smart_switches,
        } : null}
        livePanelStates={livePanelStates}
        discoveredPanelIps={discoveredPanelIps}
        discoveryCompleted={discoveryCompleted}
        isLoading={isDiscovering || isLoadingProfile}
        onSwitchToSetup={handleSwitchToSetup}
      />
    );
  }

  // Setup mode
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button 
            className={styles.controlModeButton}
            onClick={handleSwitchToControl}
            title="Switch to Control Mode"
          >
            ← Control
          </button>
          <h1 className={styles.appTitle}>Cubixx Setup</h1>
        </div>
        <ThemeToggle />
      </header>
      <section className={styles.content}>
        <DiscoveryDashboard />
      </section>
    </main>
  );
}
