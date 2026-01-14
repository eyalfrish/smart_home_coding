'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import styles from "./page.module.css";
import DiscoveryDashboard from "@/components/discovery-dashboard";
import SmartHomeControl from "@/components/smart-home-control";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePanelStream } from "@/lib/hooks/use-panel-stream";
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
  const [discoveredPanelIps, setDiscoveredPanelIps] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryCompleted, setDiscoveryCompleted] = useState(false);
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  
  // Discovery trigger - increments to force re-discovery
  const [discoveryTrigger, setDiscoveryTrigger] = useState(0);
  
  // Refs
  const hasAutoDiscoveredRef = useRef(false);
  const discoverySourcesRef = useRef<EventSource[]>([]);
  
  // Panel streaming using the hook (for control mode)
  const shouldConnectToPanels = mode === 'control' && discoveredPanelIps.length > 0 && !!serverSessionId;
  
  const { panelStates: livePanelStates } = usePanelStream({
    ips: shouldConnectToPanels ? discoveredPanelIps : [],
    sessionId: serverSessionId || '',
    enabled: shouldConnectToPanels,
  });
  
  // Convert discovered IPs to Set for SmartHomeControl
  const discoveredPanelIpsSet = useMemo(() => new Set(discoveredPanelIps), [discoveredPanelIps]);

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
      setDiscoveredPanelIps([]);
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
        
        const foundPanels: string[] = [];
        let completedStreams = 0;
        
        for (const req of requests) {
          const url = `/api/discover/stream?baseIp=${encodeURIComponent(req.baseIp)}&start=${req.start}&end=${req.end}`;
          const eventSource = new EventSource(url);
          discoverySourcesRef.current.push(eventSource);
          
          eventSource.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              
              if (message.type === 'result' && message.data?.status === 'panel') {
                const panelIp = message.data.ip;
                if (!foundPanels.includes(panelIp)) {
                  foundPanels.push(panelIp);
                  setDiscoveredPanelIps([...foundPanels]);
                }
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
  }, [hasMounted, selectedProfile, isLoadingProfile, mode, discoveryTrigger]);

  // =============================================================================
  // Mode switching
  // =============================================================================
  
  const handleSwitchToSetup = useCallback(() => {
    setMode('setup');
    localStorage.setItem(STORAGE_KEY_MODE, 'setup');
    
    // Close any open discovery connections when leaving control mode
    for (const es of discoverySourcesRef.current) {
      es.close();
    }
    discoverySourcesRef.current = [];
  }, []);

  const handleSwitchToControl = useCallback(() => {
    // Reset all discovery state
    setDiscoveredPanelIps([]);
    setDiscoveryCompleted(false);
    setIsDiscovering(false);
    hasAutoDiscoveredRef.current = false;
    
    // Increment trigger to force re-discovery
    setDiscoveryTrigger(t => t + 1);
    
    // Then switch mode - this will trigger re-discovery
    setMode('control');
    localStorage.setItem(STORAGE_KEY_MODE, 'control');
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
        discoveredPanelIps={discoveredPanelIpsSet}
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
