/**
 * Global discovery progress tracker.
 * This allows polling for progress while discovery is running.
 */

interface DiscoveryProgress {
  isRunning: boolean;
  phase: string;
  totalIps: number;
  scannedCount: number;
  panelsFound: number;
  notPanels: number;
  noResponse: number;
  errors: number;
  // Partial results for early display
  partialResults: Array<{
    ip: string;
    status: 'panel' | 'not-panel' | 'no-response' | 'error' | 'pending';
    name?: string;
    responseTime?: number;
  }>;
  startTime: number;
  lastUpdate: number;
}

// Global singleton for tracking progress
const PROGRESS_KEY = Symbol.for("smart_home_discovery_progress");

interface GlobalWithProgress {
  [PROGRESS_KEY]?: DiscoveryProgress;
}

const defaultProgress: DiscoveryProgress = {
  isRunning: false,
  phase: '',
  totalIps: 0,
  scannedCount: 0,
  panelsFound: 0,
  notPanels: 0,
  noResponse: 0,
  errors: 0,
  partialResults: [],
  startTime: 0,
  lastUpdate: 0,
};

export function getProgress(): DiscoveryProgress {
  const globalObj = globalThis as GlobalWithProgress;
  if (!globalObj[PROGRESS_KEY]) {
    globalObj[PROGRESS_KEY] = { ...defaultProgress };
  }
  return globalObj[PROGRESS_KEY];
}

export function startProgress(totalIps: number): void {
  const progress = getProgress();
  progress.isRunning = true;
  progress.phase = 'starting';
  progress.totalIps = totalIps;
  progress.scannedCount = 0;
  progress.panelsFound = 0;
  progress.notPanels = 0;
  progress.noResponse = 0;
  progress.errors = 0;
  progress.partialResults = [];
  progress.startTime = Date.now();
  progress.lastUpdate = Date.now();
}

export function updatePhase(phase: string): void {
  const progress = getProgress();
  progress.phase = phase;
  progress.lastUpdate = Date.now();
}

export function addResult(result: {
  ip: string;
  status: 'panel' | 'not-panel' | 'no-response' | 'error' | 'pending';
  name?: string;
  responseTime?: number;
}): void {
  const progress = getProgress();
  
  // Update counts
  progress.scannedCount++;
  switch (result.status) {
    case 'panel':
      progress.panelsFound++;
      break;
    case 'not-panel':
      progress.notPanels++;
      break;
    case 'no-response':
    case 'pending':
      progress.noResponse++;
      break;
    case 'error':
      progress.errors++;
      break;
  }
  
  // Add to partial results (keep only panels and non-responses for display)
  // Limit to prevent memory issues
  if (progress.partialResults.length < 300) {
    progress.partialResults.push(result);
  }
  
  progress.lastUpdate = Date.now();
}

export function finishProgress(): void {
  const progress = getProgress();
  progress.isRunning = false;
  progress.phase = 'complete';
  progress.lastUpdate = Date.now();
}

export function resetProgress(): void {
  const globalObj = globalThis as GlobalWithProgress;
  globalObj[PROGRESS_KEY] = { ...defaultProgress };
}

