// =============================================================================
// User Profile Types
// =============================================================================

/**
 * Schema version for the profiles database.
 * Increment this when making breaking changes to the profile structure.
 * 
 * Version History:
 * - v1: Initial schema with basic profile fields
 * - v2: Added section_order for dashboard section reordering
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Valid section identifiers for the dashboard.
 * Order determines vertical display order.
 */
export type DashboardSection = 'profile' | 'ip-ranges' | 'discovery' | 'favorites';

/**
 * Sections that can be shown in fullscreen mode.
 * When set, only the profile picker and the specified section are visible.
 */
export type FullscreenSection = 'discovery' | 'favorites' | null;

/**
 * Default section order for new profiles.
 */
export const DEFAULT_SECTION_ORDER: DashboardSection[] = ['profile', 'ip-ranges', 'discovery', 'favorites'];

/**
 * A user profile for storing preferences and settings.
 */
export interface Profile {
  /** Unique identifier (auto-incremented) */
  id: number;
  
  /** Display name for the profile */
  name: string;
  
  /** IP ranges to scan for panels (e.g., ["192.168.1.1-192.168.1.254"]) */
  ip_ranges: string[];
  
  /**
   * Favorite switches/relays keyed by panel IP and relay index.
   * Example: { "192.168.1.100": { "0": true, "2": true } }
   */
  favorites: Record<string, Record<string, boolean>>;
  
  /**
   * Smart switch configurations for automation.
   * Structure TBD - placeholder for future features.
   * Example: { "morning_routine": { ... } }
   */
  smart_switches: Record<string, unknown>;
  
  /**
   * Order of dashboard sections for this profile.
   * Controls vertical arrangement of: profile picker, IP ranges, discovery, favorites.
   */
  section_order: DashboardSection[];
  
  /**
   * Section to show in fullscreen mode when profile loads.
   * When set, only the profile picker and this section are visible.
   * null = normal view (all sections visible)
   */
  fullscreen_section: FullscreenSection;
  
  /** ISO timestamp when profile was created */
  created_at: string;
  
  /** ISO timestamp when profile was last updated */
  updated_at: string;
}

/**
 * The root structure of the profiles.json file.
 */
export interface ProfilesDatabase {
  /** Schema version for migrations */
  version: number;
  
  /** ID of the default profile to auto-load on startup (null if none set) */
  defaultProfileId: number | null;
  
  /** Array of user profiles */
  profiles: Profile[];
  
  /** Auto-increment counter for profile IDs */
  next_id: number;
}

/**
 * Data required to create a new profile (without auto-generated fields).
 */
export type CreateProfileData = Pick<Profile, 'name'> & {
  ip_ranges?: string[];
  favorites?: Record<string, Record<string, boolean>>;
  smart_switches?: Record<string, unknown>;
  section_order?: DashboardSection[];
  fullscreen_section?: FullscreenSection;
};

/**
 * Data for updating an existing profile (all fields optional).
 */
export type UpdateProfileData = Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;

