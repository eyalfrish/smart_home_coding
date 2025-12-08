/**
 * Global discovery progress tracker.
 * This allows polling for progress while discovery is running.
 */

type ResultStatus = 'panel' | 'not-panel' | 'no-response' | 'error' | 'pending';

interface PartialResult {
  ip: string;
  status: ResultStatus;
  name?: string;
}

interface DiscoveryProgress {
  isRunning: boolean;
  phase: string;
  totalIps: number;
  // Track results by IP to avoid duplicates across phases
  resultsByIp: Map<string, PartialResult>;
  startTime: number;
  lastUpdate: number;
}

// Global singleton for tracking progress
const PROGRESS_KEY = Symbol.for("smart_home_discovery_progress");

interface GlobalWithProgress {
  [PROGRESS_KEY]?: DiscoveryProgress;
}

function createDefaultProgress(): DiscoveryProgress {
  return {
    isRunning: false,
    phase: '',
    totalIps: 0,
    resultsByIp: new Map(),
    startTime: 0,
    lastUpdate: 0,
  };
}

export function getProgress(): DiscoveryProgress {
  const globalObj = globalThis as GlobalWithProgress;
  if (!globalObj[PROGRESS_KEY]) {
    globalObj[PROGRESS_KEY] = createDefaultProgress();
  }
  return globalObj[PROGRESS_KEY];
}

// Get computed stats for API response
export function getProgressStats() {
  const progress = getProgress();
  
  let panelsFound = 0;
  let notPanels = 0;
  let noResponse = 0;
  let errors = 0;
  
  const partialResults: PartialResult[] = [];
  
  progress.resultsByIp.forEach((result) => {
    partialResults.push(result);
    switch (result.status) {
      case 'panel':
        panelsFound++;
        break;
      case 'not-panel':
        notPanels++;
        break;
      case 'no-response':
      case 'pending':
        noResponse++;
        break;
      case 'error':
        errors++;
        break;
    }
  });
  
  // Sort results by IP for consistent display
  partialResults.sort((a, b) => {
    const partsA = a.ip.split('.').map(Number);
    const partsB = b.ip.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
    }
    return 0;
  });
  
  return {
    isRunning: progress.isRunning,
    phase: progress.phase,
    totalIps: progress.totalIps,
    scannedCount: progress.resultsByIp.size,
    panelsFound,
    notPanels,
    noResponse,
    errors,
    partialResults,
    startTime: progress.startTime,
    lastUpdate: progress.lastUpdate,
  };
}

export function startProgress(totalIps: number): void {
  const progress = getProgress();
  progress.isRunning = true;
  progress.phase = 'starting';
  progress.totalIps = totalIps;
  progress.resultsByIp = new Map();
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
  status: ResultStatus;
  name?: string;
}): void {
  const progress = getProgress();
  
  const existing = progress.resultsByIp.get(result.ip);
  
  // Always add new IPs, or upgrade status based on priority
  // Priority: panel > not-panel > error > no-response > pending
  const statusPriority: Record<ResultStatus, number> = {
    'panel': 5,
    'not-panel': 4,
    'error': 3,
    'no-response': 2,
    'pending': 1,
  };
  
  const existingPriority = existing ? statusPriority[existing.status] : 0;
  const newPriority = statusPriority[result.status];
  
  // Update if new IP or better status
  if (!existing || newPriority > existingPriority) {
    progress.resultsByIp.set(result.ip, {
      ip: result.ip,
      status: result.status,
      name: result.name || existing?.name,
    });
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
  globalObj[PROGRESS_KEY] = createDefaultProgress();
}

