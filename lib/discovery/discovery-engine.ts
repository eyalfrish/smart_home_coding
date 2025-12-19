/**
 * Robust Multi-Phase Discovery Engine
 * 
 * This engine uses a multi-phase approach to maximize panel detection:
 * 
 * Phase 1: Quick Sweep (500ms timeout)
 *   - Fast initial scan to identify definitely-responsive hosts
 *   - High concurrency (25 parallel), no retries
 *   - Settings fetched IMMEDIATELY for discovered panels
 *   
 * Phase 2: Standard Scan (1200ms timeout)  
 *   - Re-scan non-responsive IPs from Phase 1
 *   - Medium concurrency (20 parallel), no retries
 *   
 * Phase 3: Deep Scan (3500ms timeout)
 *   - Final attempt for stubborn/slow IPs
 *   - Lower concurrency (10 parallel), 1 retry
 *   
 * THOROUGH MODE (optional):
 *   User-configurable mode for difficult networks or recovering panels.
 *   Multiplies timeouts, reduces concurrency, adds retries.
 *   
 * Settings are fetched incrementally as panels are discovered.
 */

import type { DiscoveryResult, PanelSettings, RelayPairConfig, RelayPairMode, RelayMode } from "./types";
import { startProgress, updatePhase, addResult, finishProgress, resetProgress } from "./discovery-progress";

// Phase configuration
interface PhaseConfig {
  name: string;
  timeout: number;
  concurrency: number;
  retries: number;
  baseRetryDelay: number;
}

/**
 * Thorough Mode Settings - user-configurable actual values
 */
export interface ThoroughModeSettings {
  /** Timeout in milliseconds for deep phase (default: 5400ms) */
  timeout?: number;
  /** Number of parallel requests for deep phase (default: 2) */
  concurrency?: number;
  /** Number of retries for deep phase (default: 3) */
  retries?: number;
}

const PHASES_NORMAL: PhaseConfig[] = [
  { name: "quick-sweep", timeout: 500, concurrency: 25, retries: 0, baseRetryDelay: 0 },
  { name: "standard", timeout: 1200, concurrency: 20, retries: 0, baseRetryDelay: 0 },
  { name: "deep", timeout: 3500, concurrency: 10, retries: 1, baseRetryDelay: 150 },
];

// Default factors to calculate thorough defaults from normal mode
const DEFAULT_FACTORS = {
  timeoutMultiplier: 3,      // 1800 * 3 = 5400ms
  concurrencyDivisor: 8,     // 12 / 8 ≈ 2 parallel  
  extraRetries: 2,           // 1 + 2 = 3 retries
};

// Discovery options that can be customized per-scan
export interface DiscoveryOptions {
  /** Enable thorough mode for slow/recovering panels */
  thoroughMode?: boolean;
  /** Custom thorough mode settings - actual values (timeout ms, concurrency, retries) */
  thoroughSettings?: ThoroughModeSettings;
}

/** Generate thorough mode phases based on user settings or defaults */
function generateThoroughPhases(settings: ThoroughModeSettings): PhaseConfig[] {
  const normalDeep = PHASES_NORMAL[2]; // deep phase
  
  // User provides actual values; calculate defaults from normal mode if not provided
  const deepTimeout = settings.timeout ?? Math.round(normalDeep.timeout * DEFAULT_FACTORS.timeoutMultiplier);
  const deepConcurrency = settings.concurrency ?? Math.max(1, Math.round(normalDeep.concurrency / DEFAULT_FACTORS.concurrencyDivisor));
  const deepRetries = settings.retries ?? (normalDeep.retries + DEFAULT_FACTORS.extraRetries);
  
  // Scale earlier phases proportionally based on the deep phase ratios
  const timeoutRatio = deepTimeout / normalDeep.timeout;
  const concurrencyRatio = deepConcurrency / normalDeep.concurrency;
  const extraRetries = deepRetries - normalDeep.retries;
  
  return PHASES_NORMAL.map(phase => ({
    ...phase,
    timeout: Math.round(phase.timeout * timeoutRatio),
    concurrency: Math.max(1, Math.round(phase.concurrency * concurrencyRatio)),
    retries: phase.retries + extraRetries,
    baseRetryDelay: phase.baseRetryDelay + 100 * Math.max(0, extraRetries),
  }));
}

const SETTINGS_TIMEOUT = 2000;  // Settings page should respond quickly

export type DiscoveryEventType = 
  | "phase_start" 
  | "phase_complete" 
  | "result" 
  | "update" 
  | "settings_batch"
  | "settings_start"
  | "settings_complete"
  | "complete"
  | "heartbeat";

export interface DiscoveryEvent {
  type: DiscoveryEventType;
  phase?: string;
  data?: DiscoveryResult | DiscoveryResult[];
  progress?: {
    completed: number;
    total: number;
    panelsFound: number;
  };
  stats?: DiscoveryStats;
}

export interface DiscoveryStats {
  totalIps: number;
  panelsFound: number;
  nonPanels: number;
  noResponse: number;
  errors: number;
  phases: {
    name: string;
    scanned: number;
    found: number;
    durationMs: number;
  }[];
  totalDurationMs: number;
}

export type DiscoveryCallback = (event: DiscoveryEvent) => void;

/**
 * Run multi-phase discovery on a range of IPs
 */
export async function runMultiPhaseDiscovery(
  baseIp: string,
  start: number,
  end: number,
  onEvent: DiscoveryCallback,
  options: DiscoveryOptions = {}
): Promise<Map<string, DiscoveryResult>> {
  const startTime = Date.now();
  const allTargets: string[] = [];
  const thoroughMode = options.thoroughMode ?? false;
  
  // Select phase configuration based on mode
  let PHASES: PhaseConfig[];
  let settingsTimeout: number;
  
  if (thoroughMode) {
    const settings: ThoroughModeSettings = options.thoroughSettings ?? {};
    PHASES = generateThoroughPhases(settings);
    // Scale settings timeout based on deep phase timeout ratio
    const normalDeepTimeout = PHASES_NORMAL[2].timeout;
    const deepTimeout = settings.timeout ?? Math.round(normalDeepTimeout * DEFAULT_FACTORS.timeoutMultiplier);
    settingsTimeout = Math.round(SETTINGS_TIMEOUT * (deepTimeout / normalDeepTimeout));
    console.log(`[Discovery] Mode: THOROUGH (timeout: ${deepTimeout}ms, concurrency: ${settings.concurrency ?? Math.round(12/DEFAULT_FACTORS.concurrencyDivisor)}, retries: ${settings.retries ?? (1+DEFAULT_FACTORS.extraRetries)})`);
  } else {
    PHASES = PHASES_NORMAL;
    settingsTimeout = SETTINGS_TIMEOUT;
    console.log(`[Discovery] Mode: normal`);
  }
  
  for (let octet = start; octet <= end; octet++) {
    allTargets.push(`${baseIp}.${octet}`);
  }

  // Initialize progress tracking for polling
  resetProgress();
  startProgress(allTargets.length);

  // Results map - the source of truth
  const results = new Map<string, DiscoveryResult>();
  const phaseStats: DiscoveryStats["phases"] = [];
  
  // Initialize all as pending
  for (const ip of allTargets) {
    results.set(ip, { ip, status: "pending" });
  }

  // Send initial heartbeat
  onEvent({ type: "heartbeat" });

  // Track which IPs still need scanning
  let pendingIps = new Set(allTargets);
  
  // Track background settings fetches - don't await them inline
  const pendingSettingsFetches: Promise<void>[] = [];
  
  // Helper to fetch settings for a discovered panel in background
  const fetchSettingsForPanel = (ip: string) => {
    const fetchPromise = (async () => {
      try {
        const settings = await fetchPanelSettings(ip, settingsTimeout);
        const existing = results.get(ip);
        if (existing && existing.status === "panel") {
          const enriched: DiscoveryResult = {
            ...existing,
            name: settings.name ?? existing.name,
            settings: buildSettingsObject(settings),
          };
          results.set(ip, enriched);
          
          // Update progress tracker with name
          addResult({
            ip: enriched.ip,
            status: "panel",
            name: enriched.name ?? undefined,
          });
          
          // Send update event with enriched data
          onEvent({
            type: "update",
            data: enriched,
            progress: {
              completed: allTargets.length - pendingIps.size,
              total: allTargets.length,
              panelsFound: countByStatus(results, "panel"),
            }
          });
        }
      } catch (e) {
        // Silently ignore settings fetch errors - panel is still discovered
        console.log(`[Settings] ${ip}: FAILED - ${(e as Error).message}`);
      }
    })();
    pendingSettingsFetches.push(fetchPromise);
  };

  // Run discovery phases
  for (const phase of PHASES) {
    if (pendingIps.size === 0) break;
    
    const phaseStartTime = Date.now();
    const ipsToScan = Array.from(pendingIps);
    
    onEvent({ 
      type: "phase_start", 
      phase: phase.name,
      progress: {
        completed: allTargets.length - pendingIps.size,
        total: allTargets.length,
        panelsFound: countByStatus(results, "panel"),
      }
    });

    // Update progress tracker
    updatePhase(phase.name);

    console.log(`[Discovery] Phase ${phase.name}: scanning ${ipsToScan.length} IPs (timeout: ${phase.timeout}ms, concurrency: ${phase.concurrency})`);

    let panelsFoundInPhase = 0;
    
    await runPhase(
      ipsToScan,
      phase,
      (ip, result) => {
        results.set(ip, result);
        
        // If we got a definitive result (panel or not-panel), remove from pending
        if (result.status === "panel" || result.status === "not-panel") {
          pendingIps.delete(ip);
          if (result.status === "panel") {
            panelsFoundInPhase++;
            // Start fetching settings immediately in background!
            fetchSettingsForPanel(ip);
          }
        }
        
        // Update progress tracker for polling
        if (result.status !== "pending") {
          addResult({
            ip: result.ip,
            status: result.status as 'panel' | 'not-panel' | 'no-response' | 'error' | 'pending',
            name: result.name ?? undefined,
          });
        }
        
        onEvent({
          type: "result",
          phase: phase.name,
          data: result,
          progress: {
            completed: allTargets.length - pendingIps.size,
            total: allTargets.length,
            panelsFound: countByStatus(results, "panel"),
          }
        });
      }
    );

    const phaseDuration = Date.now() - phaseStartTime;
    phaseStats.push({
      name: phase.name,
      scanned: ipsToScan.length,
      found: panelsFoundInPhase,
      durationMs: phaseDuration,
    });

    const totalPanelsFound = countByStatus(results, "panel");
    console.log(`[Discovery] Phase ${phase.name} done in ${phaseDuration}ms: found ${panelsFoundInPhase} panels, ${pendingIps.size} IPs remaining (${(phaseDuration / ipsToScan.length).toFixed(0)}ms/IP avg)`);

    onEvent({ 
      type: "phase_complete", 
      phase: phase.name,
      progress: {
        completed: allTargets.length - pendingIps.size,
        total: allTargets.length,
        panelsFound: totalPanelsFound,
      }
    });

  }

  // Mark remaining pending IPs as no-response
  pendingIps.forEach(ip => {
    const current = results.get(ip);
    if (current && (current.status === "pending" || current.status === "no-response")) {
      results.set(ip, { ip, status: "no-response", errorMessage: "No response after all phases" });
    }
  });

  // Wait for any remaining settings fetches (with reasonable timeout)
  // Settings include Log/LongPress which aren't available via WebSocket
  if (pendingSettingsFetches.length > 0) {
    const waitTime = Math.min(2500, Math.max(1500, pendingSettingsFetches.length * 50));
    console.log(`[Discovery] Waiting for ${pendingSettingsFetches.length} settings fetches (max ${waitTime}ms)...`);
    const settingsTimeout = new Promise<void>(resolve => setTimeout(resolve, waitTime));
    await Promise.race([
      Promise.allSettled(pendingSettingsFetches),
      settingsTimeout,
    ]);
    console.log(`[Discovery] Settings fetches complete`);
  }

  // Calculate final stats
  const panelsFound = countByStatus(results, "panel");
  const stats: DiscoveryStats = {
    totalIps: allTargets.length,
    panelsFound,
    nonPanels: countByStatus(results, "not-panel"),
    noResponse: countByStatus(results, "no-response") + countByStatus(results, "pending"),
    errors: countByStatus(results, "error"),
    phases: phaseStats,
    totalDurationMs: Date.now() - startTime,
  };

  console.log(`[Discovery] Complete! ${panelsFound} panels in ${stats.totalDurationMs}ms`);

  // Mark progress as complete
  finishProgress();

  onEvent({ 
    type: "complete", 
    stats,
    progress: {
      completed: allTargets.length,
      total: allTargets.length,
      panelsFound,
    }
  });

  return results;
}

/**
 * Run a single discovery phase
 */
async function runPhase(
  targets: string[],
  config: PhaseConfig,
  onResult: (ip: string, result: DiscoveryResult) => void
): Promise<void> {
  const queue = [...targets];
  let queueIndex = 0;
  
  const getNext = (): string | null => {
    if (queueIndex >= queue.length) return null;
    return queue[queueIndex++];
  };

  const worker = async () => {
    while (true) {
      const ip = getNext();
      if (!ip) break;
      
      const result = await checkHostWithRetry(ip, config);
      onResult(ip, result);
      
      // Minimal stagger to avoid overwhelming network stack
      await delay(5);
    }
  };

  const workerCount = Math.min(config.concurrency, targets.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);
}

/**
 * Check a host with retry logic
 */
async function checkHostWithRetry(
  ip: string,
  config: PhaseConfig
): Promise<DiscoveryResult> {
  const startTime = Date.now();
  let lastResult: DiscoveryResult = { ip, status: "no-response", errorMessage: "No response" };
  
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    const result = await checkHost(ip, config.timeout);
    lastResult = result;
    
    // Success or definitive "not a panel" - return immediately
    if (result.status === "panel" || result.status === "not-panel") {
      return { ...result, discoveryTimeMs: Date.now() - startTime };
    }
    
    // On timeout/error, retry after short delay
    if (attempt < config.retries) {
      await delay(config.baseRetryDelay + Math.random() * 30);
    }
  }
  
  return { ...lastResult, discoveryTimeMs: Date.now() - startTime };
}

/**
 * Check a single host for panel presence
 */
async function checkHost(ip: string, timeout: number): Promise<DiscoveryResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const url = `http://${ip}/`;

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 200) {
      // Got a response - clear timeout to allow body transfer to complete
      clearTimeout(timeoutId);
      
      const html = await response.text();
      const isPanel = isPanelHtml(html);
      
      return {
        ip,
        status: isPanel ? "panel" : "not-panel",
        httpStatus: response.status,
        errorMessage: isPanel ? undefined : "Not a Cubixx panel",
        panelHtml: isPanel ? html : undefined,
      };
    }

    return {
      ip,
      status: "error",
      httpStatus: response.status,
      errorMessage: `HTTP ${response.status}`,
    };
  } catch (error) {
    const err = error as Error;
    if (err.name === "AbortError") {
      return { ip, status: "no-response", errorMessage: "Timeout" };
    }
    // Network errors (ECONNREFUSED, EHOSTUNREACH, etc) = no response
    return { ip, status: "no-response", errorMessage: err.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

interface PanelSettingsResult {
  name: string | null;
  logging: boolean | null;
  longPressMs: number | null;
  relayPairs: RelayPairConfig[] | null;
}

async function fetchPanelSettings(ip: string, timeoutMs: number = SETTINGS_TIMEOUT): Promise<PanelSettingsResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://${ip}/settings`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return { name: null, logging: null, longPressMs: null, relayPairs: null };
    }

    const html = await response.text();
    
    // Hostname: <input type="text" id="hostn" name="hostn" value="Entrance1">
    const nameMatch = html.match(/id=["']hostn["'][^>]*value=["']([^"']*)["']/i);
    const name = nameMatch ? nameMatch[1].trim() || null : null;
    
    // Logging: <select id="file_logging">
    let logging: boolean | null = null;
    const loggingSelectMatch = html.match(/<select[^>]*id=["']file_logging["'][^>]*>[\s\S]*?<\/select>/i);
    if (loggingSelectMatch) {
      const enabledSelected = /<option[^>]*value=["']1["'][^>]*selected/i.test(loggingSelectMatch[0]);
      const disabledSelected = /<option[^>]*value=["']0["'][^>]*selected/i.test(loggingSelectMatch[0]);
      if (enabledSelected) logging = true;
      else if (disabledSelected) logging = false;
    }
    
    // Long press duration
    const longPressMatch = html.match(/id=["']long_press_duration["'][^>]*value=["'](\d+)["']/i);
    const longPressMs = longPressMatch ? parseInt(longPressMatch[1], 10) : null;
    
    // Parse relay pair configurations
    const relayPairs = parseRelayPairConfigs(html);
    
    return { name, logging, longPressMs, relayPairs };
  } catch {
    return { name: null, logging: null, longPressMs: null, relayPairs: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse relay pair configurations from the settings page HTML.
 * 
 * Structure (3 pairs):
 * - mode0, mode1, mode2: Pair mode selects (0=Normal, 1=Curtain, 2=Venetian)
 * - relay_mode0..5: Individual relay modes (0=Switch, 1=Momentary, 2=Disabled)
 */
function parseRelayPairConfigs(html: string): RelayPairConfig[] | null {
  const pairs: RelayPairConfig[] = [];
  
  // Helper to get selected value from a select element
  const getSelectedValue = (selectHtml: string): string | null => {
    // Match option with 'selected' attribute
    const selectedMatch = selectHtml.match(/<option[^>]*value=["'](\d+)["'][^>]*selected/i);
    if (selectedMatch) return selectedMatch[1];
    // Also try: selected comes before value
    const selectedMatch2 = selectHtml.match(/<option[^>]*selected[^>]*value=["'](\d+)["']/i);
    if (selectedMatch2) return selectedMatch2[1];
    return null;
  };
  
  // Parse 3 relay pairs (indices 0, 1, 2)
  for (let pairIndex = 0; pairIndex < 3; pairIndex++) {
    // Find pair mode select: <select id='mode0' name='mode0'>
    const pairModeRegex = new RegExp(
      `<select[^>]*(?:id|name)=["']mode${pairIndex}["'][^>]*>[\\s\\S]*?<\\/select>`,
      'i'
    );
    const pairModeMatch = html.match(pairModeRegex);
    
    if (!pairModeMatch) {
      // If we can't find pair mode config, settings page might be older format
      continue;
    }
    
    const pairModeValue = getSelectedValue(pairModeMatch[0]);
    let pairMode: RelayPairMode = "normal";
    if (pairModeValue === "1") pairMode = "curtain";
    else if (pairModeValue === "2") pairMode = "venetian";
    
    // Parse individual relay modes for both relays in the pair
    // Relay indices: pair 0 -> relays 0,1; pair 1 -> relays 2,3; pair 2 -> relays 4,5
    const relayModes: [RelayMode, RelayMode] = ["disabled", "disabled"];
    
    for (let i = 0; i < 2; i++) {
      const relayIndex = pairIndex * 2 + i;
      const relayModeRegex = new RegExp(
        `<select[^>]*name=["']relay_mode${relayIndex}["'][^>]*>[\\s\\S]*?<\\/select>`,
        'i'
      );
      const relayModeMatch = html.match(relayModeRegex);
      
      if (relayModeMatch) {
        const relayModeValue = getSelectedValue(relayModeMatch[0]);
        if (relayModeValue === "0") relayModes[i] = "switch";
        else if (relayModeValue === "1") relayModes[i] = "momentary";
        else relayModes[i] = "disabled";
      }
    }
    
    pairs.push({
      pairIndex,
      pairMode,
      relayModes,
    });
  }
  
  return pairs.length > 0 ? pairs : null;
}

function buildSettingsObject(settings: PanelSettingsResult): PanelSettings | undefined {
  const obj: PanelSettings = {};
  if (settings.logging !== null) obj.logging = settings.logging;
  if (settings.longPressMs !== null) obj.longPressMs = settings.longPressMs;
  if (settings.relayPairs !== null) obj.relayPairs = settings.relayPairs;
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function isPanelHtml(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes("cubixx") || lower.includes("cubixx controller");
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function countByStatus(results: Map<string, DiscoveryResult>, status: string): number {
  return Array.from(results.values()).filter(r => r.status === status).length;
}
