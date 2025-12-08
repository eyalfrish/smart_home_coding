/**
 * Robust Multi-Phase Discovery Engine
 * 
 * This engine uses a multi-phase approach to maximize panel detection reliability:
 * 
 * Phase 1: Quick Sweep (400ms timeout)
 *   - Fast initial scan to identify definitely-responsive hosts
 *   - High concurrency (15 parallel)
 *   
 * Phase 2: Standard Scan (1500ms timeout)  
 *   - Re-scan non-responsive IPs from Phase 1
 *   - Medium concurrency (10 parallel)
 *   - 1 retry
 *   
 * Phase 3: Deep Scan (3000ms timeout)
 *   - Final attempt for stubborn/slow IPs
 *   - Lower concurrency (5 parallel)
 *   - 2 retries
 *   
 * Phase 4: Settings Enrichment (parallel)
 *   - Fetch panel names/settings in parallel batches
 *   - Uses longer timeout since panels are confirmed
 */

import type { DiscoveryResult, PanelSettings } from "./types";

// Phase configuration
interface PhaseConfig {
  name: string;
  timeout: number;
  concurrency: number;
  retries: number;
  baseRetryDelay: number;
}

// Higher concurrency for faster discovery
const PHASES: PhaseConfig[] = [
  { name: "quick-sweep", timeout: 500, concurrency: 20, retries: 0, baseRetryDelay: 0 },
  { name: "standard", timeout: 1200, concurrency: 15, retries: 1, baseRetryDelay: 100 },
  { name: "deep", timeout: 1500, concurrency: 10, retries: 1, baseRetryDelay: 100 },
];

const SETTINGS_TIMEOUT = 3000;  // Some panels are slow to serve /settings
const SETTINGS_CONCURRENCY = 25; // High concurrency since we have longer timeout

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
          }
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

  // Get confirmed panels for settings enrichment
  const confirmedPanels = Array.from(results.entries())
    .filter(([, r]) => r.status === "panel")
    .map(([ip]) => ip);

  console.log(`[Discovery] Found ${confirmedPanels.length} panels total, fetching settings...`);

  // Settings enrichment phase - fetch all in parallel, then send batch update
  if (confirmedPanels.length > 0) {
    onEvent({ type: "settings_start" });
    
    const settingsStartTime = Date.now();
    const enrichedResults = await fetchAllPanelSettings(confirmedPanels, results);
    
    // Apply all enriched results to the map
    enrichedResults.forEach((result, ip) => {
      results.set(ip, result);
    });
    
    console.log(`[Discovery] Settings fetched in ${Date.now() - settingsStartTime}ms`);
    
    // Send ONE batch update with all enriched panels
    onEvent({ 
      type: "settings_batch",
      data: Array.from(enrichedResults.values()),
    } as DiscoveryEvent);

    onEvent({ type: "settings_complete" });
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
      
      // Small stagger between requests
      await delay(15);
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

/**
 * Fetch settings for all panels in parallel and return enriched results
 */
async function fetchAllPanelSettings(
  panelIps: string[],
  results: Map<string, DiscoveryResult>
): Promise<Map<string, DiscoveryResult>> {
  const enrichedResults = new Map<string, DiscoveryResult>();
  const startTime = Date.now();
  
  console.log(`[Settings] Starting batch fetch for ${panelIps.length} panels (concurrency: ${SETTINGS_CONCURRENCY})`);
  
  // Create fetch tasks
  const fetchTasks = panelIps.map((ip) => async () => {
    const taskStart = Date.now();
    const existing = results.get(ip);
    if (!existing || existing.status !== "panel") return;

    try {
      const settings = await fetchPanelSettings(ip);
      const enriched: DiscoveryResult = {
        ...existing,
        name: settings.name ?? existing.name,
        settings: buildSettingsObject(settings),
      };
      enrichedResults.set(ip, enriched);
      console.log(`[Settings] ${ip}: ${settings.name || "no-name"} (${Date.now() - taskStart}ms)`);
    } catch (e) {
      console.log(`[Settings] ${ip}: FAILED (${Date.now() - taskStart}ms) - ${(e as Error).message}`);
      enrichedResults.set(ip, existing);
    }
  });

  // Run all tasks with concurrency limit
  let taskIndex = 0;
  const runNext = async (): Promise<void> => {
    while (taskIndex < fetchTasks.length) {
      const currentIndex = taskIndex++;
      await fetchTasks[currentIndex]();
    }
  };

  const workers = Array.from(
    { length: Math.min(SETTINGS_CONCURRENCY, fetchTasks.length) },
    () => runNext()
  );
  
  await Promise.all(workers);
  
  console.log(`[Settings] Batch complete: ${enrichedResults.size} panels in ${Date.now() - startTime}ms`);

  return enrichedResults;
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
