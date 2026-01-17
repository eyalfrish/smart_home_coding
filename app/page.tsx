'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import styles from "./page.module.css";
import DiscoveryDashboard from "@/components/discovery-dashboard";
import SmartHomeControl from "@/components/smart-home-control";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePanelStream } from "@/lib/hooks/use-panel-stream";
import type { FavoritesData, SmartSwitchesData } from "@/components/favorites-section";
import type { DiscoverySummary, DiscoveryResult } from "@/lib/discovery/types";

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
  
  // =============================================================================
  // Two-tier discovery state:
  // - "Default" discovery: cached results for the default profile (used by UserView)
  // - "Draft" discovery: temporary results for non-default profiles in AdminView
  // =============================================================================
  
  // Default profile discovery (persistent, used by UserView)
  const [defaultDiscoveredPanelIps, setDefaultDiscoveredPanelIps] = useState<string[]>([]);
  const [defaultDiscoverySummary, setDefaultDiscoverySummary] = useState<DiscoverySummary | null>(null);
  const [defaultDiscoveryResults, setDefaultDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [defaultDiscoveryCompleted, setDefaultDiscoveryCompleted] = useState(false);
  const [defaultProfileId, setDefaultProfileId] = useState<number | null>(null);
  
  // Current session discovery (may be draft for non-default profiles)
  const [discoveredPanelIps, setDiscoveredPanelIps] = useState<string[]>([]);
  const [discoverySummary, setDiscoverySummary] = useState<DiscoverySummary | null>(null);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryCompleted, setDiscoveryCompleted] = useState(false);
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  
  // Track which profile the current discovery belongs to
  const lastDiscoveredProfileIdRef = useRef<number | null>(null);
  
  // Refs
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
    
    // Load default profile ID from localStorage
    const storedDefaultId = localStorage.getItem(STORAGE_KEY_DEFAULT_PROFILE);
    const parsedDefaultId = storedDefaultId ? parseInt(storedDefaultId, 10) : null;
    if (parsedDefaultId && !isNaN(parsedDefaultId)) {
      setDefaultProfileId(parsedDefaultId);
    }
    
    // Determine initial mode:
    // - If a default profile is set, always start in Control mode (UserView)
    // - Otherwise, respect saved mode preference
    const hasDefaultProfile = !!storedDefaultId;
    if (hasDefaultProfile) {
      // Always start in Control mode when a default profile exists
      setMode('control');
      localStorage.setItem(STORAGE_KEY_MODE, 'control');
    } else {
      // No default profile - use saved mode or default to setup for first-time users
      const storedMode = localStorage.getItem(STORAGE_KEY_MODE) as AppMode | null;
      if (storedMode === 'setup' || !storedMode) {
        setMode('setup');
      }
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
  // Uses cached default profile discovery if available
  // =============================================================================
  
  useEffect(() => {
    if (!hasMounted || !selectedProfile || isLoadingProfile || mode !== 'control') {
      return;
    }
    
    // IMPORTANT: Skip if selectedProfile doesn't match the current default
    // This prevents a race condition where the effect runs before loadDefaultProfile completes
    if (defaultProfileId !== null && selectedProfile.id !== defaultProfileId) {
      console.log('[Home] Skipping discovery - selectedProfile', selectedProfile.id, 'does not match defaultProfileId', defaultProfileId);
      return;
    }
    
    // Check if we have cached discovery for the default profile
    if (defaultProfileId === selectedProfile.id && defaultDiscoveryCompleted && defaultDiscoveredPanelIps.length > 0) {
      console.log('[Home] Using cached default profile discovery:', defaultDiscoveredPanelIps.length, 'panels', 'with settings:', defaultDiscoveryResults.filter(r => r.settings).length);
      // Use cached discovery - no need to re-discover
      setDiscoveredPanelIps(defaultDiscoveredPanelIps);
      setDiscoverySummary(defaultDiscoverySummary);
      setDiscoveryResults([...defaultDiscoveryResults]); // Also restore full results with settings!
      setDiscoveryCompleted(true);
      lastDiscoveredProfileIdRef.current = selectedProfile.id;
      return;
    }
    
    // Skip if we've already discovered for this exact profile
    if (lastDiscoveredProfileIdRef.current === selectedProfile.id && discoveryCompleted) {
      return;
    }
    
    const ipRanges = selectedProfile.ip_ranges || [];
    if (ipRanges.length === 0) {
      // No IP ranges, mark as completed
      setDiscoveryCompleted(true);
      lastDiscoveredProfileIdRef.current = selectedProfile.id;
      // If this is the default profile, cache it
      if (defaultProfileId === selectedProfile.id) {
        setDefaultDiscoveryCompleted(true);
        setDefaultDiscoveredPanelIps([]);
      }
      return;
    }
    
    const startDiscovery = async () => {
      console.log('[Home] Starting discovery for profile:', selectedProfile.id, selectedProfile.name);
      setIsDiscovering(true);
      setDiscoveredPanelIps([]);
      setDiscoverySummary(null);
      setDiscoveryResults([]);
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
          setDiscoveryCompleted(true);
          lastDiscoveredProfileIdRef.current = selectedProfile.id;
          return;
        }
        
        const foundPanels: string[] = [];
        // Track full results with settings (keyed by IP for updates)
        const resultsMap = new Map<string, DiscoveryResult>();
        let completedStreams = 0;
        // Aggregate summary across all IP ranges
        const aggregateSummary: DiscoverySummary = {
          baseIp: requests[0]?.baseIp || '',
          start: requests[0]?.start || 0,
          end: requests[requests.length - 1]?.end || 0,
          totalChecked: 0,
          panelsFound: 0,
          noResponse: 0,
          notPanels: 0,
          errors: 0,
        };
        
        for (const req of requests) {
          const url = `/api/discover/stream?baseIp=${encodeURIComponent(req.baseIp)}&start=${req.start}&end=${req.end}`;
          const eventSource = new EventSource(url);
          discoverySourcesRef.current.push(eventSource);
          
          eventSource.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              
              // Capture panel discovery (initial result)
              if (message.type === 'result' && message.data?.status === 'panel') {
                const panelIp = message.data.ip;
                if (!foundPanels.includes(panelIp)) {
                  foundPanels.push(panelIp);
                  setDiscoveredPanelIps([...foundPanels]);
                }
                // Store initial result
                resultsMap.set(panelIp, message.data as DiscoveryResult);
              }
              
              // Capture enriched results with settings (update events)
              // These contain logging and longPressMs from panel settings fetch
              if (message.type === 'update' && message.data?.status === 'panel') {
                const panelIp = message.data.ip;
                // Update with enriched data (includes settings)
                resultsMap.set(panelIp, message.data as DiscoveryResult);
              }
              
              // Capture stats from complete message
              // Note: API uses 'totalIps' and 'nonPanels', we map them to our naming
              if (message.type === 'complete' && message.stats) {
                aggregateSummary.totalChecked += message.stats.totalIps || message.stats.totalChecked || 0;
                aggregateSummary.panelsFound += message.stats.panelsFound || 0;
                aggregateSummary.noResponse += message.stats.noResponse || 0;
                aggregateSummary.notPanels += message.stats.nonPanels || message.stats.notPanels || 0;
                aggregateSummary.errors += message.stats.errors || 0;
              }
            } catch {
              // Ignore parse errors
            }
          };
          
          const handleComplete = () => {
            eventSource.close();
            completedStreams++;
            if (completedStreams >= requests.length) {
              // Convert results map to array
              const finalResults = Array.from(resultsMap.values());
              
              setIsDiscovering(false);
              setDiscoveryCompleted(true);
              setDiscoverySummary({...aggregateSummary});
              setDiscoveryResults(finalResults);
              lastDiscoveredProfileIdRef.current = selectedProfile.id;
              
              console.log('[Home] Discovery complete, summary:', aggregateSummary, 'results with settings:', finalResults.filter(r => r.settings).length);
              
              // If this is the default profile, cache the discovery results (including full results with settings)
              if (defaultProfileId === selectedProfile.id) {
                console.log('[Home] Caching discovery for default profile:', foundPanels.length, 'panels', 'with settings:', finalResults.filter(r => r.settings).length);
                setDefaultDiscoveredPanelIps([...foundPanels]);
                setDefaultDiscoverySummary({...aggregateSummary});
                setDefaultDiscoveryResults([...finalResults]);
                setDefaultDiscoveryCompleted(true);
              }
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
  }, [hasMounted, selectedProfile, isLoadingProfile, mode, discoveryCompleted, defaultProfileId, defaultDiscoveryCompleted, defaultDiscoveredPanelIps, defaultDiscoverySummary, defaultDiscoveryResults]);

  // State for opening favorites fullscreen
  const [openFavoritesFullscreen, setOpenFavoritesFullscreen] = useState(false);
  
  // State to skip auto-discovery when coming from Control mode
  const [skipSetupAutoDiscovery, setSkipSetupAutoDiscovery] = useState(false);

  // =============================================================================
  // Mode switching
  // =============================================================================
  
  const handleSwitchToSetup = useCallback((favoritesFullscreen?: boolean) => {
    setOpenFavoritesFullscreen(favoritesFullscreen ?? false);
    // Skip auto-discovery in Setup since we already discovered in Control mode
    setSkipSetupAutoDiscovery(discoveryCompleted);
    setMode('setup');
    localStorage.setItem(STORAGE_KEY_MODE, 'setup');
    
    // Close any open discovery connections when leaving control mode
    for (const es of discoverySourcesRef.current) {
      es.close();
    }
    discoverySourcesRef.current = [];
  }, [discoveryCompleted]);

  const handleSwitchToControl = useCallback(() => {
    // Read fresh default profile ID from localStorage
    // This is important because state updates from handleProfileMadeDefault might be async
    const storedDefaultId = localStorage.getItem(STORAGE_KEY_DEFAULT_PROFILE);
    const freshDefaultProfileId = storedDefaultId ? parseInt(storedDefaultId, 10) : null;
    
    console.log('[Home] Switching to Control mode, freshDefaultProfileId:', freshDefaultProfileId, 
      'defaultDiscoveryCompleted:', defaultDiscoveryCompleted,
      'lastDiscoveredProfileId:', lastDiscoveredProfileIdRef.current);
    setOpenFavoritesFullscreen(false);
    
    // IMPORTANT: Synchronously restore default profile's discovery state BEFORE switching mode
    // This prevents a render cycle with wrong data
    // Check if the cached discovery belongs to the current default profile
    const cacheIsForDefaultProfile = defaultDiscoveryCompleted && 
      defaultDiscoveredPanelIps.length > 0 &&
      freshDefaultProfileId === defaultProfileId;
    
    if (cacheIsForDefaultProfile) {
      console.log('[Home] Restoring default profile discovery:', defaultDiscoveredPanelIps.length, 'panels', 'with settings:', defaultDiscoveryResults.filter(r => r.settings).length);
      setDiscoveredPanelIps(defaultDiscoveredPanelIps);
      setDiscoverySummary(defaultDiscoverySummary);
      setDiscoveryResults([...defaultDiscoveryResults]); // Also restore full results with settings!
      setDiscoveryCompleted(true);
      lastDiscoveredProfileIdRef.current = freshDefaultProfileId;
    } else if (freshDefaultProfileId === lastDiscoveredProfileIdRef.current && discoveryCompleted && discoveredPanelIps.length > 0) {
      // The last discovery was for the new default profile - use it directly
      console.log('[Home] Using last discovery for new default:', discoveredPanelIps.length, 'panels', 'with settings:', discoveryResults.filter(r => r.settings).length);
      // Update the default cache with current discovery
      setDefaultDiscoveredPanelIps([...discoveredPanelIps]);
      setDefaultDiscoverySummary(discoverySummary);
      setDefaultDiscoveryResults([...discoveryResults]); // Also cache full results with settings!
      setDefaultDiscoveryCompleted(true);
      setDefaultProfileId(freshDefaultProfileId);
    } else {
      // No cached discovery for the default profile - will need to re-discover
      console.log('[Home] No cached default discovery, will re-discover');
      setDiscoveredPanelIps([]);
      setDiscoverySummary(null);
      setDiscoveryResults([]);
      setDiscoveryCompleted(false);
      lastDiscoveredProfileIdRef.current = null;
    }
    
    setMode('control');
    localStorage.setItem(STORAGE_KEY_MODE, 'control');
  }, [defaultProfileId, defaultDiscoveryCompleted, defaultDiscoveredPanelIps, defaultDiscoverySummary, defaultDiscoveryResults, discoveryCompleted, discoveredPanelIps, discoverySummary, discoveryResults]);

  // Handle discovery completion from Setup mode - sync state
  const handleSetupDiscoveryComplete = useCallback((
    newDiscoveredIps: string[], 
    newSummary: DiscoverySummary, 
    forProfileId: number,
    newResults?: DiscoveryResult[]
  ) => {
    console.log('[Home] Discovery completed in Setup mode for profile:', forProfileId, 'panels:', newDiscoveredIps.length, 'summary:', newSummary, 'results with settings:', newResults?.filter(r => r.settings).length ?? 0);
    // Update shared discovery state
    setDiscoveredPanelIps(newDiscoveredIps);
    setDiscoverySummary(newSummary); // Also store the summary!
    setDiscoveryResults(newResults ?? []); // Store full results with settings!
    setDiscoveryCompleted(true);
    setIsDiscovering(false);
    lastDiscoveredProfileIdRef.current = forProfileId;
    
    // If this discovery is for the default profile, cache it
    if (forProfileId === defaultProfileId) {
      console.log('[Home] Caching discovery for default profile (from Setup):', newDiscoveredIps.length, 'panels', 'with settings:', newResults?.filter(r => r.settings).length ?? 0);
      setDefaultDiscoveredPanelIps(newDiscoveredIps);
      setDefaultDiscoverySummary(newSummary); // Also cache the summary!
      setDefaultDiscoveryResults(newResults ?? []); // Cache full results!
      setDefaultDiscoveryCompleted(true);
    }
    
    // Also reset skipSetupAutoDiscovery since we just did a new discovery
    setSkipSetupAutoDiscovery(false);
  }, [defaultProfileId]);

  // Handle when a profile is made default - copy current discovery to default cache
  const handleProfileMadeDefault = useCallback((profileId: number | null) => {
    console.log('[Home] Profile made default:', profileId);
    setDefaultProfileId(profileId);
    
    if (profileId === null) {
      // Cleared default - reset default discovery cache
      setDefaultDiscoveredPanelIps([]);
      setDefaultDiscoverySummary(null);
      setDefaultDiscoveryResults([]);
      setDefaultDiscoveryCompleted(false);
    } else if (profileId === lastDiscoveredProfileIdRef.current && discoveryCompleted) {
      // The current discovery is for this profile - copy to default cache
      console.log('[Home] Copying current discovery to default cache:', discoveredPanelIps.length, 'panels', 'with settings:', discoveryResults.filter(r => r.settings).length);
      setDefaultDiscoveredPanelIps([...discoveredPanelIps]);
      setDefaultDiscoverySummary(discoverySummary); // Also copy the summary!
      setDefaultDiscoveryResults([...discoveryResults]); // Also copy full results!
      setDefaultDiscoveryCompleted(true);
    } else {
      // Different profile - clear default cache, will discover when switching to UserView
      console.log('[Home] New default profile differs from current discovery, will discover on switch to UserView');
      setDefaultDiscoveredPanelIps([]);
      setDefaultDiscoverySummary(null);
      setDefaultDiscoveryResults([]);
      setDefaultDiscoveryCompleted(false);
    }
  }, [discoveryCompleted, discoveredPanelIps, discoverySummary, discoveryResults]);

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
        discoveryResults={discoveryResults}
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
        <DiscoveryDashboard 
          initialFavoritesFullscreen={openFavoritesFullscreen}
          onFavoritesFullscreenConsumed={() => setOpenFavoritesFullscreen(false)}
          skipAutoDiscovery={skipSetupAutoDiscovery}
          controlModeDiscoveredIps={discoveredPanelIps}
          controlModeDiscoverySummary={discoverySummary}
          controlModeDiscoveryResults={discoveryResults}
          controlModePanelStates={livePanelStates}
          onDiscoveryComplete={handleSetupDiscoveryComplete}
          onProfileMadeDefault={handleProfileMadeDefault}
        />
      </section>
    </main>
  );
}
