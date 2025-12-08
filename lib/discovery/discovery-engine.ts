/**
 * Robust Multi-Phase Discovery Engine
 * 
 * This engine uses a multi-phase approach to maximize panel detection reliability:
 * 
 * Phase 1: Quick Sweep (500ms timeout)
 *   - Fast initial scan to identify definitely-responsive hosts
 *   - High concurrency (20 parallel)
 *   - Settings fetched IMMEDIATELY for discovered panels
 *   
 * Phase 2: Standard Scan (1200ms timeout)  
 *   - Re-scan non-responsive IPs from Phase 1
 *   - Medium concurrency (15 parallel)
 *   - 1 retry
 *   
 * Phase 3: Deep Scan (2500ms timeout)
 *   - Final attempt for stubborn/slow IPs
 *   - Lower concurrency (8 parallel)
 *   - 2 retries
 *   
 * Settings are fetched incrementally as panels are discovered,
 * not in a batch at the end - this provides instant panel names!
 */

import type { DiscoveryResult, PanelSettings } from "./types";
import { startProgress, updatePhase, addResult, finishProgress, resetProgress } from "./discovery-progress";

// Phase configuration
interface PhaseConfig {
  name: string;
  timeout: number;
  concurrency: number;
  retries: number;
  baseRetryDelay: number;
}

// Phase configuration - balanced for speed and reliability
const PHASES: PhaseConfig[] = [
  { name: "quick-sweep", timeout: 500, concurrency: 20, retries: 0, baseRetryDelay: 0 },
  { name: "standard", timeout: 1200, concurrency: 15, retries: 1, baseRetryDelay: 100 },
  { name: "deep", timeout: 2500, concurrency: 8, retries: 2, baseRetryDelay: 150 },
];

const SETTINGS_TIMEOUT = 2500;  // Fetch settings quickly, don't block

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
  onEvent: DiscoveryCallback
): Promise<Map<string, DiscoveryResult>> {
  const startTime = Date.now();
  const allTargets: string[] = [];
  
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
        const settings = await fetchPanelSettings(ip);
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

    console.log(`[Discovery] Phase ${phase.name} done in ${phaseDuration}ms: found ${panelsFoundInPhase} panels, ${pendingIps.size} IPs remaining (${(phaseDuration / ipsToScan.length).toFixed(0)}ms/IP avg)`);

    onEvent({ 
      type: "phase_complete", 
      phase: phase.name,
      progress: {
        completed: allTargets.length - pendingIps.size,
        total: allTargets.length,
        panelsFound: countByStatus(results, "panel"),
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

  // Wait for any remaining settings fetches (with a timeout so we don't hang)
  if (pendingSettingsFetches.length > 0) {
    console.log(`[Discovery] Waiting for ${pendingSettingsFetches.length} settings fetches...`);
    const settingsTimeout = new Promise<void>(resolve => setTimeout(resolve, 3000));
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
  let lastResult: DiscoveryResult = { ip, status: "no-response", errorMessage: "No response" };
  
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    const result = await checkHost(ip, config.timeout);
    lastResult = result;
    
    // Success or definitive "not a panel" - return immediately
    if (result.status === "panel" || result.status === "not-panel") {
      return result;
    }
    
    // On timeout/error, retry after delay
    if (attempt < config.retries) {
      const delayMs = config.baseRetryDelay * (attempt + 1);
      await delay(delayMs);
    }
  }
  
  return lastResult;
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
}

async function fetchPanelSettings(ip: string): Promise<PanelSettingsResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SETTINGS_TIMEOUT);

  try {
    const response = await fetch(`http://${ip}/settings`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return { name: null, logging: null, longPressMs: null };
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
    
    return { name, logging, longPressMs };
  } catch {
    return { name: null, logging: null, longPressMs: null };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSettingsObject(settings: PanelSettingsResult): PanelSettings | undefined {
  const obj: PanelSettings = {};
  if (settings.logging !== null) obj.logging = settings.logging;
  if (settings.longPressMs !== null) obj.longPressMs = settings.longPressMs;
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
