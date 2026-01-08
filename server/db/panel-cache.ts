import { promises as fs } from 'fs';
import path from 'path';
import {
  CachedPanelInfo,
  PanelCacheDatabase,
  UpdateCachedPanelData,
  PANEL_CACHE_VERSION,
} from './panel-cache-types';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Path to the panel cache file.
 * In Docker, this should be volume-mounted for persistence alongside profiles.json.
 */
const DATA_DIR = path.join(process.cwd(), 'data');
const CACHE_FILE = path.join(DATA_DIR, 'panel-cache.json');

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Creates an empty cache with the current schema version.
 */
function createEmptyCache(): PanelCacheDatabase {
  return {
    version: PANEL_CACHE_VERSION,
    panels: {},
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensures the data directory exists.
 */
async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`[PanelCache] Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Migrates the cache to the current schema version.
 */
function migrateCache(cache: PanelCacheDatabase): PanelCacheDatabase {
  const currentVersion = cache.version ?? 0;
  
  // Future migrations go here
  // if (currentVersion < 2) { ... }
  
  cache.version = PANEL_CACHE_VERSION;
  
  if (currentVersion !== PANEL_CACHE_VERSION && currentVersion !== 0) {
    console.log(`[PanelCache] Migrated cache from v${currentVersion} to v${PANEL_CACHE_VERSION}`);
  }
  
  return cache;
}

// =============================================================================
// Core Cache Operations
// =============================================================================

/**
 * Loads the panel cache from disk.
 * Creates an empty cache file if it doesn't exist.
 */
export async function loadPanelCache(): Promise<PanelCacheDatabase> {
  try {
    await ensureDataDir();
    
    let cache: PanelCacheDatabase;
    
    try {
      const data = await fs.readFile(CACHE_FILE, 'utf-8');
      cache = JSON.parse(data) as PanelCacheDatabase;
    } catch (readError: unknown) {
      const errorCode = (readError as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        console.log('[PanelCache] Cache file not found, creating new one...');
      } else {
        console.error('[PanelCache] Error reading cache, creating new one:', readError);
      }
      cache = createEmptyCache();
      await savePanelCache(cache);
      return cache;
    }
    
    // Run migrations if needed
    if (cache.version !== PANEL_CACHE_VERSION) {
      cache = migrateCache(cache);
      await savePanelCache(cache);
    }
    
    return cache;
    
  } catch (error) {
    console.error('[PanelCache] Fatal error loading cache:', error);
    return createEmptyCache();
  }
}

/**
 * Saves the panel cache to disk atomically.
 */
export async function savePanelCache(cache: PanelCacheDatabase): Promise<void> {
  await ensureDataDir();
  
  const tempFile = `${CACHE_FILE}.tmp`;
  cache.lastUpdated = new Date().toISOString();
  const data = JSON.stringify(cache, null, 2);
  
  try {
    await fs.writeFile(tempFile, data, 'utf-8');
    await fs.rename(tempFile, CACHE_FILE);
  } catch (error) {
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// =============================================================================
// Cache Update Operations
// =============================================================================

/**
 * Updates the cache with information from a single discovered panel.
 * If the panel already exists, updates its info and increments discovery count.
 * If the panel is new, creates a new cache entry.
 */
export async function updateCachedPanel(data: UpdateCachedPanelData): Promise<CachedPanelInfo> {
  const cache = await loadPanelCache();
  const now = new Date().toISOString();
  
  const existing = cache.panels[data.ip];
  
  if (existing) {
    // Update existing entry
    const updated: CachedPanelInfo = {
      ...existing,
      name: data.name ?? existing.name,
      firmwareVersion: data.firmwareVersion ?? existing.firmwareVersion,
      deviceId: data.deviceId ?? existing.deviceId,
      loggingEnabled: data.loggingEnabled ?? existing.loggingEnabled,
      longPressMs: data.longPressMs ?? existing.longPressMs,
      lastSeen: now,
      discoveryCount: existing.discoveryCount + 1,
    };
    cache.panels[data.ip] = updated;
    await savePanelCache(cache);
    return updated;
  } else {
    // Create new entry
    const newEntry: CachedPanelInfo = {
      ip: data.ip,
      name: data.name ?? null,
      firmwareVersion: data.firmwareVersion,
      deviceId: data.deviceId,
      loggingEnabled: data.loggingEnabled,
      longPressMs: data.longPressMs,
      firstSeen: now,
      lastSeen: now,
      discoveryCount: 1,
    };
    cache.panels[data.ip] = newEntry;
    await savePanelCache(cache);
    console.log(`[PanelCache] New panel cached: ${data.ip} (${data.name ?? 'unnamed'})`);
    return newEntry;
  }
}

/**
 * Batch update the cache from discovery results.
 * More efficient than updating one panel at a time.
 * 
 * @param panels Array of discovered panel data to cache
 */
export async function updateCacheFromDiscovery(panels: UpdateCachedPanelData[]): Promise<void> {
  if (panels.length === 0) return;
  
  const cache = await loadPanelCache();
  const now = new Date().toISOString();
  let newCount = 0;
  let updateCount = 0;
  
  for (const data of panels) {
    const existing = cache.panels[data.ip];
    
    if (existing) {
      // Update existing entry
      cache.panels[data.ip] = {
        ...existing,
        name: data.name ?? existing.name,
        firmwareVersion: data.firmwareVersion ?? existing.firmwareVersion,
        deviceId: data.deviceId ?? existing.deviceId,
        loggingEnabled: data.loggingEnabled ?? existing.loggingEnabled,
        longPressMs: data.longPressMs ?? existing.longPressMs,
        lastSeen: now,
        discoveryCount: existing.discoveryCount + 1,
      };
      updateCount++;
    } else {
      // Create new entry
      cache.panels[data.ip] = {
        ip: data.ip,
        name: data.name ?? null,
        firmwareVersion: data.firmwareVersion,
        deviceId: data.deviceId,
        loggingEnabled: data.loggingEnabled,
        longPressMs: data.longPressMs,
        firstSeen: now,
        lastSeen: now,
        discoveryCount: 1,
      };
      newCount++;
    }
  }
  
  await savePanelCache(cache);
  console.log(`[PanelCache] Updated cache: ${newCount} new, ${updateCount} updated (${Object.keys(cache.panels).length} total)`);
}

// =============================================================================
// Cache Query Operations
// =============================================================================

/**
 * Gets cached information for a specific IP.
 * Returns null if the IP is not in the cache.
 */
export async function getCachedPanel(ip: string): Promise<CachedPanelInfo | null> {
  const cache = await loadPanelCache();
  return cache.panels[ip] ?? null;
}

/**
 * Gets all cached panels.
 * Useful for displaying historical panel information.
 */
export async function getAllCachedPanels(): Promise<Record<string, CachedPanelInfo>> {
  const cache = await loadPanelCache();
  return cache.panels;
}

/**
 * Gets cached panels within a specific IP range.
 * Useful for enriching discovery results with cached data.
 * 
 * @param baseIp Base IP (e.g., "192.168.1")
 * @param start Start of range (e.g., 1)
 * @param end End of range (e.g., 254)
 */
export async function getCachedPanelsInRange(
  baseIp: string,
  start: number,
  end: number
): Promise<Record<string, CachedPanelInfo>> {
  const cache = await loadPanelCache();
  const result: Record<string, CachedPanelInfo> = {};
  
  for (let octet = start; octet <= end; octet++) {
    const ip = `${baseIp}.${octet}`;
    if (cache.panels[ip]) {
      result[ip] = cache.panels[ip];
    }
  }
  
  return result;
}

/**
 * Removes a panel from the cache.
 * Useful if a panel is known to be permanently removed from the network.
 */
export async function removeCachedPanel(ip: string): Promise<boolean> {
  const cache = await loadPanelCache();
  
  if (cache.panels[ip]) {
    const name = cache.panels[ip].name;
    delete cache.panels[ip];
    await savePanelCache(cache);
    console.log(`[PanelCache] Removed panel from cache: ${ip} (${name ?? 'unnamed'})`);
    return true;
  }
  
  return false;
}

/**
 * Clears all cached panels.
 * Use with caution - this removes all historical panel data.
 */
export async function clearPanelCache(): Promise<void> {
  const cache = createEmptyCache();
  await savePanelCache(cache);
  console.log('[PanelCache] Cache cleared');
}
