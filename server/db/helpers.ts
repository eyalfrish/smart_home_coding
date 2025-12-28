import { promises as fs } from 'fs';
import path from 'path';
import {
  Profile,
  ProfilesDatabase,
  CreateProfileData,
  UpdateProfileData,
  CURRENT_SCHEMA_VERSION,
} from './types';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Path to the profiles database file.
 * In Docker, this should be volume-mounted for persistence.
 */
const DATA_DIR = path.join(process.cwd(), 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Creates an empty database with the current schema version.
 */
function createEmptyDatabase(): ProfilesDatabase {
  return {
    version: CURRENT_SCHEMA_VERSION,
    defaultProfileId: null,
    profiles: [],
    next_id: 1,
  };
}

/**
 * Ensures the data directory exists.
 */
async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    // Directory doesn't exist, create it
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`[ProfilesDB] Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Migrates the database to the current schema version.
 * 
 * MIGRATION_HOOK: Update structure here for future versions.
 * 
 * When adding a new version:
 * 1. Increment CURRENT_SCHEMA_VERSION in types.ts
 * 2. Add a case here to migrate from the previous version
 * 3. Apply changes to all existing profiles
 * 
 * @param db The database to migrate
 * @returns The migrated database
 */
function migrateDatabase(db: ProfilesDatabase): ProfilesDatabase {
  let currentVersion = db.version ?? 0;
  
  // No migrations needed yet - this is v1
  // Future migrations will be added here:
  
  // MIGRATION_HOOK: Add migrations here when schema changes
  // Example for v2:
  // if (currentVersion < 2) {
  //   console.log('[ProfilesDB] Migrating from v1 to v2...');
  //   db.profiles = db.profiles.map(profile => ({
  //     ...profile,
  //     new_field: 'default_value', // Add new field with default
  //   }));
  //   currentVersion = 2;
  // }
  
  // Ensure next_id exists (added in v1, but handle old files)
  if (db.next_id === undefined) {
    db.next_id = db.profiles.length > 0 
      ? Math.max(...db.profiles.map(p => p.id)) + 1 
      : 1;
  }
  
  // Ensure defaultProfileId exists (backward compatibility)
  if (db.defaultProfileId === undefined) {
    db.defaultProfileId = null;
  }
  
  // Validate defaultProfileId - clear if the profile no longer exists
  if (db.defaultProfileId !== null) {
    const defaultExists = db.profiles.some(p => p.id === db.defaultProfileId);
    if (!defaultExists) {
      console.log(`[ProfilesDB] Default profile ${db.defaultProfileId} no longer exists, clearing.`);
      db.defaultProfileId = null;
    }
  }
  
  // Ensure all profiles have required fields with defaults
  db.profiles = db.profiles.map(profile => ({
    ...profile,
    ip_ranges: profile.ip_ranges ?? [],
    favorites: profile.favorites ?? {},
    smart_switches: profile.smart_switches ?? {},
    created_at: profile.created_at ?? new Date().toISOString(),
    updated_at: profile.updated_at ?? new Date().toISOString(),
  }));
  
  // Update version to current
  db.version = CURRENT_SCHEMA_VERSION;
  
  if (currentVersion !== CURRENT_SCHEMA_VERSION) {
    console.log(`[ProfilesDB] Migrated database from v${currentVersion} to v${CURRENT_SCHEMA_VERSION}`);
  }
  
  return db;
}

// =============================================================================
// Core Database Operations
// =============================================================================

/**
 * Loads the profiles database from disk.
 * Creates an empty database file if it doesn't exist.
 * 
 * @returns The profiles database
 */
export async function loadProfiles(): Promise<ProfilesDatabase> {
  try {
    await ensureDataDir();
    
    let db: ProfilesDatabase;
    
    try {
      const data = await fs.readFile(PROFILES_FILE, 'utf-8');
      db = JSON.parse(data) as ProfilesDatabase;
    } catch (readError: unknown) {
      // File doesn't exist or is invalid JSON - create new database
      const errorCode = (readError as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        console.log('[ProfilesDB] Database file not found, creating new one...');
      } else {
        console.error('[ProfilesDB] Error reading database, creating new one:', readError);
      }
      db = createEmptyDatabase();
      await saveProfiles(db);
      return db;
    }
    
    // Run migrations if needed
    if (db.version !== CURRENT_SCHEMA_VERSION) {
      db = migrateDatabase(db);
      await saveProfiles(db);
    }
    
    return db;
    
  } catch (error) {
    console.error('[ProfilesDB] Fatal error loading profiles:', error);
    // Return empty database to prevent crashes
    return createEmptyDatabase();
  }
}

/**
 * Saves the profiles database to disk atomically.
 * Writes to a temp file first, then renames to prevent corruption.
 * 
 * @param db The database to save
 */
export async function saveProfiles(db: ProfilesDatabase): Promise<void> {
  await ensureDataDir();
  
  const tempFile = `${PROFILES_FILE}.tmp`;
  const data = JSON.stringify(db, null, 2);
  
  try {
    // Write to temp file first
    await fs.writeFile(tempFile, data, 'utf-8');
    
    // Atomic rename (prevents corruption on crash)
    await fs.rename(tempFile, PROFILES_FILE);
    
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Gets all profiles.
 * 
 * @returns Array of all profiles
 */
export async function getAllProfiles(): Promise<Profile[]> {
  const db = await loadProfiles();
  return db.profiles;
}

/**
 * Gets a single profile by ID.
 * 
 * @param id The profile ID
 * @returns The profile or null if not found
 */
export async function getProfile(id: number): Promise<Profile | null> {
  const db = await loadProfiles();
  return db.profiles.find(p => p.id === id) ?? null;
}

/**
 * Creates a new profile.
 * 
 * @param data The profile data
 * @returns The created profile
 */
export async function createProfile(data: CreateProfileData): Promise<Profile> {
  const db = await loadProfiles();
  
  const now = new Date().toISOString();
  const profile: Profile = {
    id: db.next_id++,
    name: data.name,
    ip_ranges: data.ip_ranges ?? [],
    favorites: data.favorites ?? {},
    smart_switches: data.smart_switches ?? {},
    created_at: now,
    updated_at: now,
  };
  
  db.profiles.push(profile);
  await saveProfiles(db);
  
  console.log(`[ProfilesDB] Created profile: ${profile.name} (id: ${profile.id})`);
  return profile;
}

/**
 * Updates an existing profile.
 * 
 * @param id The profile ID
 * @param data The fields to update
 * @returns The updated profile or null if not found
 */
export async function updateProfile(id: number, data: UpdateProfileData): Promise<Profile | null> {
  const db = await loadProfiles();
  
  const index = db.profiles.findIndex(p => p.id === id);
  if (index === -1) {
    return null;
  }
  
  const existing = db.profiles[index];
  const updated: Profile = {
    ...existing,
    ...data,
    id: existing.id, // Prevent ID changes
    created_at: existing.created_at, // Preserve creation time
    updated_at: new Date().toISOString(),
  };
  
  db.profiles[index] = updated;
  await saveProfiles(db);
  
  console.log(`[ProfilesDB] Updated profile: ${updated.name} (id: ${updated.id})`);
  return updated;
}

/**
 * Deletes a profile.
 * Also clears defaultProfileId if the deleted profile was the default.
 * 
 * @param id The profile ID
 * @returns True if deleted, false if not found
 */
export async function deleteProfile(id: number): Promise<boolean> {
  const db = await loadProfiles();
  
  const index = db.profiles.findIndex(p => p.id === id);
  if (index === -1) {
    return false;
  }
  
  const deleted = db.profiles.splice(index, 1)[0];
  
  // Clear default if this profile was the default
  if (db.defaultProfileId === id) {
    db.defaultProfileId = null;
    console.log(`[ProfilesDB] Cleared default profile (deleted profile was default)`);
  }
  
  await saveProfiles(db);
  
  console.log(`[ProfilesDB] Deleted profile: ${deleted.name} (id: ${deleted.id})`);
  return true;
}

// =============================================================================
// Profile-specific Operations
// =============================================================================

/**
 * Adds an IP range to a profile.
 * 
 * @param profileId The profile ID
 * @param ipRange The IP range to add (e.g., "192.168.1.1-192.168.1.254")
 * @returns The updated profile or null if not found
 */
export async function addIpRange(profileId: number, ipRange: string): Promise<Profile | null> {
  const profile = await getProfile(profileId);
  if (!profile) return null;
  
  if (!profile.ip_ranges.includes(ipRange)) {
    profile.ip_ranges.push(ipRange);
    return updateProfile(profileId, { ip_ranges: profile.ip_ranges });
  }
  
  return profile;
}

/**
 * Removes an IP range from a profile.
 * 
 * @param profileId The profile ID
 * @param ipRange The IP range to remove
 * @returns The updated profile or null if not found
 */
export async function removeIpRange(profileId: number, ipRange: string): Promise<Profile | null> {
  const profile = await getProfile(profileId);
  if (!profile) return null;
  
  const newRanges = profile.ip_ranges.filter(r => r !== ipRange);
  return updateProfile(profileId, { ip_ranges: newRanges });
}

/**
 * Toggles a favorite for a relay on a panel.
 * 
 * @param profileId The profile ID
 * @param panelIp The panel IP address
 * @param relayIndex The relay index (as string key)
 * @param isFavorite Whether to mark as favorite
 * @returns The updated profile or null if not found
 */
export async function setFavorite(
  profileId: number,
  panelIp: string,
  relayIndex: string,
  isFavorite: boolean
): Promise<Profile | null> {
  const profile = await getProfile(profileId);
  if (!profile) return null;
  
  const favorites = { ...profile.favorites };
  
  if (!favorites[panelIp]) {
    favorites[panelIp] = {};
  }
  
  if (isFavorite) {
    favorites[panelIp][relayIndex] = true;
  } else {
    delete favorites[panelIp][relayIndex];
    // Clean up empty panel entries
    if (Object.keys(favorites[panelIp]).length === 0) {
      delete favorites[panelIp];
    }
  }
  
  return updateProfile(profileId, { favorites });
}

/**
 * Gets all favorites for a profile.
 * 
 * @param profileId The profile ID
 * @returns Map of panel IP -> relay indices that are favorited, or null if profile not found
 */
export async function getFavorites(
  profileId: number
): Promise<Record<string, Record<string, boolean>> | null> {
  const profile = await getProfile(profileId);
  return profile?.favorites ?? null;
}

// =============================================================================
// Default Profile Operations
// =============================================================================

/**
 * Gets the default profile ID.
 * 
 * @returns The default profile ID or null if none set
 */
export async function getDefaultProfileId(): Promise<number | null> {
  const db = await loadProfiles();
  return db.defaultProfileId;
}

/**
 * Sets the default profile ID.
 * 
 * @param profileId The profile ID to set as default, or null to clear
 * @returns True if successful, false if profile doesn't exist
 */
export async function setDefaultProfileId(profileId: number | null): Promise<boolean> {
  const db = await loadProfiles();
  
  // If setting a profile as default, verify it exists
  if (profileId !== null) {
    const profileExists = db.profiles.some(p => p.id === profileId);
    if (!profileExists) {
      console.log(`[ProfilesDB] Cannot set default: profile ${profileId} not found`);
      return false;
    }
  }
  
  db.defaultProfileId = profileId;
  await saveProfiles(db);
  
  if (profileId !== null) {
    console.log(`[ProfilesDB] Set default profile to: ${profileId}`);
  } else {
    console.log(`[ProfilesDB] Cleared default profile`);
  }
  
  return true;
}

