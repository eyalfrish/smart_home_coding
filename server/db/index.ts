// =============================================================================
// Profiles Database - Public API
// =============================================================================
// 
// This module provides persistent storage for user profiles using a JSON file.
// Profiles store user preferences like IP ranges, favorites, and smart switches.
//
// Usage:
//   import { getAllProfiles, createProfile } from '@/server/db';
//
// Docker Note:
//   Mount the data directory as a volume for persistence:
//   volumes:
//     - ./data:/app/data
// =============================================================================

// Re-export types
export type {
  Profile,
  ProfilesDatabase,
  CreateProfileData,
  UpdateProfileData,
  DashboardSection,
  FullscreenSection,
} from './types';

export { CURRENT_SCHEMA_VERSION, DEFAULT_SECTION_ORDER } from './types';

// Re-export all helper functions
export {
  // Core operations
  loadProfiles,
  saveProfiles,
  
  // CRUD operations
  getAllProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  
  // Profile-specific operations
  addIpRange,
  removeIpRange,
  setFavorite,
  getFavorites,
  
  // Note: Default profile is now stored client-side in browser localStorage.
  // See profile-picker.tsx for implementation.
} from './helpers';

// =============================================================================
// Panel Cache - Public API
// =============================================================================
//
// Caches "static" information about discovered panels.
// Used to show last-known panel names when panels go offline.
// =============================================================================

// Re-export panel cache types
export type {
  CachedPanelInfo,
  PanelCacheDatabase,
  UpdateCachedPanelData,
} from './panel-cache-types';

export { PANEL_CACHE_VERSION } from './panel-cache-types';

// Re-export panel cache functions
export {
  loadPanelCache,
  savePanelCache,
  updateCachedPanel,
  updateCacheFromDiscovery,
  getCachedPanel,
  getAllCachedPanels,
  getCachedPanelsInRange,
  removeCachedPanel,
  clearPanelCache,
} from './panel-cache';
