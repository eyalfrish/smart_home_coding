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
} from './types';

export { CURRENT_SCHEMA_VERSION } from './types';

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
} from './helpers';

