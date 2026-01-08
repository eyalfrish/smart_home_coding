// =============================================================================
// Panel Cache Types
// =============================================================================
//
// This module defines types for caching discovered panel information.
// The cache persists "static" panel info (name, settings) so that even when
// a panel is offline, we can display its last-known identity.
//
// Use case: When an IP that was previously a panel stops responding,
// show its cached name instead of just "—" to help identify which panel is offline.
// =============================================================================

/**
 * Schema version for the panel cache.
 * Increment when making breaking changes to the cache structure.
 * 
 * Version History:
 * - v1: Initial schema with basic cached panel fields
 */
export const PANEL_CACHE_VERSION = 1;

/**
 * Cached information about a discovered panel.
 * Stores "static" data that doesn't change frequently.
 */
export interface CachedPanelInfo {
  /** The IP address of the panel */
  ip: string;
  
  /** Panel hostname/name (from settings or WebSocket) */
  name: string | null;
  
  /** Firmware version at last discovery */
  firmwareVersion?: string | null;
  
  /** Device ID if available */
  deviceId?: string | null;
  
  /** ISO timestamp of first discovery */
  firstSeen: string;
  
  /** ISO timestamp of most recent successful discovery */
  lastSeen: string;
  
  /** Total number of times this panel was discovered */
  discoveryCount: number;
  
  /** Whether logging was enabled at last discovery */
  loggingEnabled?: boolean;
  
  /** Long press duration at last discovery (ms) */
  longPressMs?: number;
}

/**
 * The root structure of the panel-cache.json file.
 */
export interface PanelCacheDatabase {
  /** Schema version for migrations */
  version: number;
  
  /** Map of IP address to cached panel info */
  panels: Record<string, CachedPanelInfo>;
  
  /** ISO timestamp when cache was last updated */
  lastUpdated: string;
}

/**
 * Data for updating a cached panel (from discovery results).
 */
export interface UpdateCachedPanelData {
  ip: string;
  name?: string | null;
  firmwareVersion?: string | null;
  deviceId?: string | null;
  loggingEnabled?: boolean;
  longPressMs?: number;
}
