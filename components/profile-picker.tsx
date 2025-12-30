'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './discovery-dashboard.module.css';
import type { IpRange } from './discovery-form';
import type { FavoritesData, SmartSwitchesData } from './favorites-section';

/** Valid section identifiers for the dashboard */
export type DashboardSection = 'profile' | 'ip-ranges' | 'discovery' | 'favorites';

/** Sections that can be shown in fullscreen mode */
export type FullscreenSection = 'discovery' | 'favorites' | null;

/** Default section order */
export const DEFAULT_SECTION_ORDER: DashboardSection[] = ['profile', 'ip-ranges', 'discovery', 'favorites'];

// =============================================================================
// Types
// =============================================================================

interface ProfileSummary {
  id: number;
  name: string;
  created_at: string;
}

interface ProfilesApiResponse {
  profiles: ProfileSummary[];
}

export interface FullProfile {
  id: number;
  name: string;
  ip_ranges: string[];
  favorites: FavoritesData | Record<string, unknown>;
  smart_switches: SmartSwitchesData | Record<string, unknown>;
  section_order: DashboardSection[];
  fullscreen_section: FullscreenSection;
  created_at: string;
  updated_at: string;
}

interface ProfilePickerProps {
  /** Current form values ranges */
  currentRanges: IpRange[];
  /** Current favorites data from the dashboard */
  currentFavorites: FavoritesData | Record<string, unknown>;
  /** Current smart switches data from the dashboard */
  currentSmartSwitches: SmartSwitchesData | Record<string, unknown>;
  /** Current section order from the dashboard */
  currentSectionOrder: DashboardSection[];
  /** Current fullscreen section from the dashboard */
  currentFullscreenSection: FullscreenSection;
  /** Called when profile is selected with parsed IP ranges and full profile */
  onProfileSelect: (profileId: number, ranges: IpRange[], fullProfile: FullProfile) => void;
  /** Called after ranges are loaded to trigger discovery - receives the new ranges */
  onTriggerDiscovery: (ranges: IpRange[]) => void;
  /** Called when profile is deleted or cleared to reset to defaults */
  onProfileClear: () => void;
  /** Called to show a toast notification */
  onShowToast: (message: string, type: 'success' | 'error') => void;
  /** Whether discovery is currently running */
  isLoading: boolean;
  /** Disabled state */
  disabled?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

let rangeIdCounter = 1000; // Start high to avoid conflicts with form's counter

/**
 * Parse an IP range string like "10.88.99.1-254" or "192.168.1.100-200"
 * into an IpRange object.
 */
function parseIpRangeString(rangeStr: string): IpRange | null {
  // Expected format: "octet1.octet2.octet3.start-end"
  // Examples: "10.88.99.1-254", "192.168.1.100-200"
  const match = rangeStr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})-(\d{1,3})$/);
  
  if (!match) {
    console.warn(`[ProfilePicker] Failed to parse IP range: ${rangeStr}`);
    return null;
  }

  const [, octet1, octet2, octet3, start, end] = match;
  
  return {
    id: `profile-range-${++rangeIdCounter}-${Date.now()}`,
    octet1,
    octet2,
    octet3,
    start,
    end,
  };
}

/**
 * Convert IpRange object to string format for storage.
 */
function ipRangeToString(range: IpRange): string {
  return `${range.octet1}.${range.octet2}.${range.octet3}.${range.start}-${range.end}`;
}

// Local storage key for caching default profile
const STORAGE_KEY_DEFAULT_PROFILE = 'cubixx_default_profile_id';

// =============================================================================
// ProfilePicker Component
// =============================================================================

export default function ProfilePicker({
  currentRanges,
  currentFavorites,
  currentSmartSwitches,
  currentSectionOrder,
  currentFullscreenSection,
  onProfileSelect,
  onTriggerDiscovery,
  onProfileClear,
  onShowToast,
  isLoading,
  disabled = false,
}: ProfilePickerProps) {
  // State - initialize without localStorage to avoid hydration mismatch
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [defaultProfileId, setDefaultProfileId] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  
  // New profile modal state
  const [showNewProfileModal, setShowNewProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  
  // Save/delete state
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Track if we've already auto-loaded the default profile this session
  const hasAutoLoadedRef = useRef(false);

  // =============================================================================
  // Fetch profiles on mount
  // =============================================================================
  
  const fetchProfiles = useCallback(async () => {
    setIsFetching(true);
    setFetchError(null);
    
    try {
      const res = await fetch('/api/profiles');
      
      if (!res.ok) {
        throw new Error(`Failed to fetch profiles: ${res.status}`);
      }
      
      const data: ProfilesApiResponse = await res.json();
      setProfiles(data.profiles || []);
      
      // Load default profile ID from localStorage (client-side per-browser storage)
      const storedDefault = localStorage.getItem(STORAGE_KEY_DEFAULT_PROFILE);
      const localDefaultId = storedDefault ? parseInt(storedDefault, 10) : null;
      
      // Validate that the stored default profile still exists
      if (localDefaultId !== null) {
        const profileExists = (data.profiles || []).some(p => p.id === localDefaultId);
        if (profileExists) {
          setDefaultProfileId(localDefaultId);
        } else {
          // Default profile was deleted, clear localStorage
          localStorage.removeItem(STORAGE_KEY_DEFAULT_PROFILE);
          setDefaultProfileId(null);
          console.log(`[ProfilePicker] Cleared stale default profile ID: ${localDefaultId}`);
        }
      } else {
        setDefaultProfileId(null);
      }
      
      return { profiles: data.profiles || [], defaultProfileId: localDefaultId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profiles';
      console.error('[ProfilePicker] Fetch error:', message);
      setFetchError(message);
      return null;
    } finally {
      setIsFetching(false);
    }
  }, []);

  // =============================================================================
  // Load profile by ID (extracted for reuse)
  // =============================================================================
  
  const loadProfileById = useCallback(async (profileId: number) => {
    try {
      const res = await fetch(`/api/profiles/${profileId}`);
      
      if (!res.ok) {
        throw new Error(`Failed to load profile: ${res.status}`);
      }
      
      const data = await res.json();
      const profile = data.profile as FullProfile;
      
      // Parse IP ranges
      const parsedRanges: IpRange[] = [];
      for (const rangeStr of profile.ip_ranges) {
        const parsed = parseIpRangeString(rangeStr);
        if (parsed) {
          parsedRanges.push(parsed);
        }
      }
      
      // If no valid ranges, create a default one
      if (parsedRanges.length === 0) {
        parsedRanges.push({
          id: `profile-range-${++rangeIdCounter}-${Date.now()}`,
          octet1: '',
          octet2: '',
          octet3: '',
          start: '',
          end: '',
        });
      }
      
      setSelectedProfileId(profileId);
      
      // Call parent handlers with full profile data
      onProfileSelect(profileId, parsedRanges, profile);
      
      // Trigger discovery with the parsed ranges directly to avoid timing issues
      onTriggerDiscovery(parsedRanges);
      
      return true;
    } catch (err) {
      console.error('[ProfilePicker] Load profile error:', err);
      return false;
    }
  }, [onProfileSelect, onTriggerDiscovery]);

  // =============================================================================
  // Auto-load default profile on mount
  // =============================================================================
  
  // Mark as mounted to enable client-side features
  useEffect(() => {
    setHasMounted(true);
    
    // Check localStorage for cached default profile ID
    const cached = localStorage.getItem(STORAGE_KEY_DEFAULT_PROFILE);
    if (cached) {
      setIsAutoLoading(true);
    }
  }, []);

  useEffect(() => {
    if (!hasMounted) return;
    
    const initializeAndAutoLoad = async () => {
      const result = await fetchProfiles();
      
      // Auto-load default profile from localStorage if set and we haven't already done so this session
      if (result && result.defaultProfileId && !hasAutoLoadedRef.current) {
        const profileExists = result.profiles.some(p => p.id === result.defaultProfileId);
        if (profileExists) {
          console.log(`[ProfilePicker] Auto-loading default profile from localStorage: ${result.defaultProfileId}`);
          hasAutoLoadedRef.current = true;
          await loadProfileById(result.defaultProfileId);
        }
      }
      
      // Done auto-loading
      setIsAutoLoading(false);
    };
    
    initializeAndAutoLoad();
  }, [hasMounted, fetchProfiles, loadProfileById]);

  // =============================================================================
  // Handle profile selection
  // =============================================================================
  
  const handleSelectChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    
    if (value === '') {
      // "None" selected - clear profile and reset to defaults
      setSelectedProfileId(null);
      setShowDeleteConfirm(false);
      onProfileClear();
      return;
    }
    
    if (value === 'new') {
      // Show new profile modal
      setShowNewProfileModal(true);
      setNewProfileName('');
      setCreateError(null);
      return;
    }
    
    const profileId = parseInt(value, 10);
    if (isNaN(profileId)) return;
    
    setShowDeleteConfirm(false);
    await loadProfileById(profileId);
  };
  
  // =============================================================================
  // Handle setting default profile
  // =============================================================================
  
  const handleSetDefault = (profileId: number | null) => {
    // Store default profile in localStorage (per-browser/client setting)
    if (profileId) {
      localStorage.setItem(STORAGE_KEY_DEFAULT_PROFILE, String(profileId));
    } else {
      localStorage.removeItem(STORAGE_KEY_DEFAULT_PROFILE);
    }
    
    setDefaultProfileId(profileId);
    console.log(`[ProfilePicker] Set default profile to: ${profileId} (stored in browser localStorage)`);
  };
  
  // =============================================================================
  // Handle new profile creation
  // =============================================================================
  
  const handleCreateProfile = async () => {
    const trimmedName = newProfileName.trim();
    
    if (!trimmedName) {
      setCreateError('Please enter a profile name');
      return;
    }
    
    setIsCreating(true);
    setCreateError(null);
    
    try {
      // Convert current ranges to string format
      const ipRangesStrings = currentRanges
        .filter(r => r.octet1 && r.octet2 && r.octet3 && r.start && r.end)
        .map(ipRangeToString);
      
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ip_ranges: ipRangesStrings,
          favorites: currentFavorites,
          smart_switches: currentSmartSwitches,
          section_order: currentSectionOrder,
          fullscreen_section: currentFullscreenSection,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to create profile: ${res.status}`);
      }
      
      const data = await res.json();
      const newProfile = data.profile as FullProfile;
      
      // Refresh profiles list
      await fetchProfiles();
      
      // Select the new profile
      setSelectedProfileId(newProfile.id);
      
      // Parse ranges from the new profile and call onProfileSelect so dashboard knows about it
      const parsedRanges = (newProfile.ip_ranges || [])
        .map(parseIpRangeString)
        .filter((r): r is IpRange => r !== null);
      
      // Call onProfileSelect so the dashboard's selectedProfile state is updated
      onProfileSelect(newProfile.id, parsedRanges, newProfile);
      
      // Close modal
      setShowNewProfileModal(false);
      setNewProfileName('');
      
      // Show success toast
      onShowToast(`Profile "${newProfile.name}" created!`, 'success');
      
      console.log(`[ProfilePicker] Created new profile: ${newProfile.name} (ID: ${newProfile.id})`);
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create profile';
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating && newProfileName.trim()) {
      handleCreateProfile();
    }
    if (e.key === 'Escape') {
      setShowNewProfileModal(false);
    }
  };

  // =============================================================================
  // Handle save to profile
  // =============================================================================
  
  const handleSaveToProfile = async () => {
    if (selectedProfileId === null) return;
    
    setIsSaving(true);
    
    try {
      // Convert current ranges to string format
      const ipRangesStrings = currentRanges
        .filter(r => r.octet1 && r.octet2 && r.octet3 && r.start && r.end)
        .map(ipRangeToString);
      
      const res = await fetch(`/api/profiles/${selectedProfileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip_ranges: ipRangesStrings,
          favorites: currentFavorites,
          smart_switches: currentSmartSwitches,
          section_order: currentSectionOrder,
          fullscreen_section: currentFullscreenSection,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to save profile: ${res.status}`);
      }
      
      // Show success toast
      onShowToast('Profile saved!', 'success');
      
      console.log(`[ProfilePicker] Saved profile: ${selectedProfileId}`);
      
    } catch (err) {
      console.error('[ProfilePicker] Save error:', err);
      onShowToast('Failed to save profile', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // =============================================================================
  // Handle delete profile
  // =============================================================================
  
  const handleDeleteProfile = async () => {
    if (selectedProfileId === null) return;
    
    setIsDeleting(true);
    
    try {
      const res = await fetch(`/api/profiles/${selectedProfileId}`, {
        method: 'DELETE',
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to delete profile: ${res.status}`);
      }
      
      // Refresh profiles list
      await fetchProfiles();
      
      // Clear selection and reset to defaults
      setSelectedProfileId(null);
      setShowDeleteConfirm(false);
      onProfileClear();
      
      console.log(`[ProfilePicker] Deleted profile: ${selectedProfileId}`);
      
    } catch (err) {
      console.error('[ProfilePicker] Delete error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // =============================================================================
  // Render
  // =============================================================================
  
  return (
    <>
      {/* Profile Picker Section */}
      <div className={styles.profilePickerSection}>
        <div className={styles.profilePickerHeader}>
          <span className={styles.profilePickerIcon}>👤</span>
          <h3 className={styles.profilePickerTitle}>Profile</h3>
        </div>
        
        <div className={styles.profilePickerContent}>
          {!hasMounted || isFetching || isAutoLoading ? (
            <div className={styles.profilePickerLoading}>
              <span className={styles.profilePickerSpinner}>⏳</span>
              <span className={styles.desktopText}>
                {hasMounted && isAutoLoading ? 'Loading default profile...' : 'Loading profiles...'}
              </span>
              <span className={styles.mobileText}>Loading...</span>
            </div>
          ) : fetchError ? (
            <div className={styles.profilePickerError}>
              <span>⚠️ {fetchError}</span>
              <button 
                type="button"
                className={styles.profilePickerRetry}
                onClick={fetchProfiles}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className={styles.profilePickerSelectWrapper}>
              <select
                className={styles.profilePickerSelect}
                value={selectedProfileId ?? ''}
                onChange={handleSelectChange}
                disabled={disabled || isLoading || isSaving || isDeleting}
                aria-label="Select profile"
              >
                <option value="">No profile selected</option>
                {profiles.map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {profile.id === defaultProfileId ? '★ ' : ''}{profile.name}
                  </option>
                ))}
                <option value="new">➕ New Profile...</option>
              </select>
              
              {/* Save button - shown when a profile is selected */}
              {selectedProfileId !== null && (
                <button
                  type="button"
                  className={styles.profileSaveButton}
                  onClick={handleSaveToProfile}
                  disabled={isSaving || isLoading || isDeleting}
                  title="Save current settings to this profile"
                >
                  {isSaving ? '...' : '💾'}
                </button>
              )}
              
              {/* Set as Default button - shown when a profile is selected */}
              {selectedProfileId !== null && (
                <button
                  type="button"
                  className={`${styles.profileDefaultButton} ${selectedProfileId === defaultProfileId ? styles.profileDefaultButtonActive : ''}`}
                  onClick={() => handleSetDefault(selectedProfileId === defaultProfileId ? null : selectedProfileId)}
                  disabled={isLoading || isSaving || isDeleting}
                  title={selectedProfileId === defaultProfileId ? 'Remove as default (browser)' : 'Set as default profile (browser)'}
                >
                  {selectedProfileId === defaultProfileId ? '★' : '☆'}
                </button>
              )}
              
              {/* Delete button - shown when a profile is selected */}
              {selectedProfileId !== null && !showDeleteConfirm && (
                <button
                  type="button"
                  className={styles.profileDeleteButton}
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isLoading || isSaving || isDeleting}
                  title="Delete this profile"
                >
                  🗑️
                </button>
              )}
            </div>
          )}
          
          {/* Delete confirmation */}
          {showDeleteConfirm && selectedProfileId !== null && (
            <div className={styles.profileDeleteConfirm}>
              <span>Delete this profile?</span>
              <button
                type="button"
                className={styles.profileDeleteConfirmYes}
                onClick={handleDeleteProfile}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Yes'}
              </button>
              <button
                type="button"
                className={styles.profileDeleteConfirmNo}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {/* New Profile Modal */}
      {showNewProfileModal && (
        <div 
          className={styles.modalOverlay}
          onClick={() => setShowNewProfileModal(false)}
        >
          <div 
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleModalKeyDown}
          >
            <h3>Create New Profile</h3>
            <p>
              This will save your current IP ranges, groups, and switches to a new profile.
            </p>
            
            <div className={styles.modalForm}>
              <div className={styles.modalField}>
                <label htmlFor="profile-name">Profile Name</label>
                <input
                  id="profile-name"
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="e.g., Home, Office, Lab..."
                  autoFocus
                  disabled={isCreating}
                />
              </div>
              
              {createError && (
                <div className={styles.profilePickerModalError}>
                  ⚠️ {createError}
                </div>
              )}
            </div>
            
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalButtonSecondary}
                onClick={() => setShowNewProfileModal(false)}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalButtonPrimary}
                onClick={handleCreateProfile}
                disabled={isCreating || !newProfileName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
